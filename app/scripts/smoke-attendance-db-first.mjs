import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");
const ENV_PATHS = [
  path.join(APP_ROOT, ".env.local"),
  path.join(APP_ROOT, ".env"),
];

async function loadEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const splitIndex = trimmed.indexOf("=");
      if (splitIndex <= 0) {
        continue;
      }
      const key = trimmed.slice(0, splitIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }
      let value = trimmed.slice(splitIndex + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

async function loadEnv() {
  for (const envPath of ENV_PATHS) {
    await loadEnvFile(envPath);
  }
}

function normalizeWhitespace(value) {
  return String(value ?? "").trim();
}

function parseBooleanEnv(name, defaultValue) {
  const raw = normalizeWhitespace(process.env[name] ?? "");
  if (!raw) {
    return defaultValue;
  }
  const lowered = raw.toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(lowered)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(lowered)) {
    return false;
  }
  return defaultValue;
}

function normalizeRole(rawRole) {
  const normalized = normalizeWhitespace(rawRole).toLowerCase();
  if (normalized === "admin") return "admin";
  if (
    normalized === "section" ||
    normalized === "leader" ||
    normalized === "lider" ||
    normalized === "sekcyjne" ||
    normalized === "sekcyjny" ||
    normalized === "sekcyjna" ||
    normalized === "sekcyjni"
  ) {
    return "section";
  }
  if (normalized === "board" || normalized === "zarzad" || normalized === "zarząd") {
    return "board";
  }
  return "member";
}

function assertEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
}

function deriveAttendanceWriteFunctionUrl(supabaseUrl) {
  const base = new URL(supabaseUrl);
  const hostParts = base.hostname.split(".");
  const projectRef = hostParts[0];
  if (!projectRef) {
    throw new Error("Could not derive project ref from SUPABASE_URL.");
  }
  return `https://${projectRef}.functions.supabase.co/attendance_write_sheet_first`;
}

async function callAttendanceWrite({
  functionUrl,
  jwt,
  eventId,
  memberId,
  attendanceRatio,
  requestNote,
}) {
  const response = await fetch(functionUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "enqueue_batch",
      eventId,
      source: "smoke-db-first-eventid-only",
      requestNote,
      changes: [{ memberId, attendanceRatio }],
    }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const details = payload && typeof payload === "object" ? JSON.stringify(payload) : String(payload);
    throw new Error(`attendance_write_sheet_first failed (${response.status}): ${details}`);
  }

  return payload;
}

async function loadTargetRow(client, explicitEventId, explicitMemberId, allowAutoTarget) {
  if (explicitEventId && explicitMemberId) {
    const { data, error } = await client
      .from("attendance_entries")
      .select("member_id,event_id,attendance_ratio")
      .eq("event_id", explicitEventId)
      .eq("member_id", explicitMemberId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to load explicit attendance target: ${error.message}`);
    }
    if (!data) {
      throw new Error(
        `Explicit target has no existing attendance row: event_id=${explicitEventId}, member_id=${explicitMemberId}`,
      );
    }
    return data;
  }

  if (!allowAutoTarget) {
    throw new Error(
      "Safe mode enabled: set SMOKE_EVENT_ID and SMOKE_MEMBER_ID (or explicitly allow fallback with SMOKE_ALLOW_AUTO_TARGET=true).",
    );
  }

  const { data, error } = await client
    .from("attendance_entries")
    .select("member_id,event_id,attendance_ratio,updated_at")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to load attendance target row: ${error.message}`);
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("No attendance entries found to run smoke test against.");
  }
  return data[0];
}

async function readCurrentRatio(client, eventId, memberId) {
  const { data, error } = await client
    .from("attendance_entries")
    .select("attendance_ratio")
    .eq("event_id", eventId)
    .eq("member_id", memberId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to read attendance ratio: ${error.message}`);
  }
  if (!data) {
    throw new Error(`Attendance row disappeared: event_id=${eventId}, member_id=${memberId}`);
  }
  const ratio = Number(data.attendance_ratio);
  if (!Number.isFinite(ratio)) {
    throw new Error(`Invalid attendance_ratio in DB: ${data.attendance_ratio}`);
  }
  return ratio;
}

async function main() {
  await loadEnv();

  const supabaseUrl = normalizeWhitespace(process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "");
  const publishableKey = normalizeWhitespace(
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.SUPABASE_PUBLISHABLE_KEY ??
      process.env.SUPABASE_ANON_KEY ??
      "",
  );
  const smokeEmail = normalizeWhitespace(process.env.SMOKE_TEST_EMAIL ?? "");
  const smokePassword = normalizeWhitespace(process.env.SMOKE_TEST_PASSWORD ?? "");
  const explicitEventId = normalizeWhitespace(process.env.SMOKE_EVENT_ID ?? "");
  const explicitMemberId = normalizeWhitespace(process.env.SMOKE_MEMBER_ID ?? "");
  const allowAutoTarget = parseBooleanEnv("SMOKE_ALLOW_AUTO_TARGET", false);
  const functionUrl =
    normalizeWhitespace(process.env.EXPO_PUBLIC_ATTENDANCE_WRITE_FUNCTION_URL ?? "") ||
    deriveAttendanceWriteFunctionUrl(supabaseUrl);
  const requireExportTriggerOk = parseBooleanEnv("SMOKE_REQUIRE_EXPORT_TRIGGER_OK", false);

  assertEnv("EXPO_PUBLIC_SUPABASE_URL or SUPABASE_URL", supabaseUrl);
  assertEnv(
    "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or EXPO_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY)",
    publishableKey,
  );
  assertEnv("SMOKE_TEST_EMAIL", smokeEmail);
  assertEnv("SMOKE_TEST_PASSWORD", smokePassword);
  if (!allowAutoTarget) {
    assertEnv("SMOKE_EVENT_ID", explicitEventId);
    assertEnv("SMOKE_MEMBER_ID", explicitMemberId);
  }

  const client = createClient(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
    email: smokeEmail,
    password: smokePassword,
  });
  if (signInError || !signInData?.session?.access_token || !signInData.user?.id) {
    throw new Error(`signInWithPassword failed: ${signInError?.message ?? "missing session"}`);
  }

  const jwt = signInData.session.access_token;
  const userId = signInData.user.id;
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("full_name,role")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) {
    throw new Error(`Failed to load profile for signed-in user: ${profileError.message}`);
  }
  const normalizedRole = normalizeRole(profile?.role ?? "");
  if (!["section", "board", "admin"].includes(normalizedRole)) {
    throw new Error(
      `Smoke test user must be section/board/admin. Current role=${normalizedRole} (${profile?.full_name ?? userId}).`,
    );
  }

  const target = await loadTargetRow(client, explicitEventId, explicitMemberId, allowAutoTarget);
  const eventId = target.event_id;
  const memberId = target.member_id;
  const originalRatio = Number(target.attendance_ratio);
  if (!Number.isFinite(originalRatio)) {
    throw new Error(`Invalid original attendance_ratio: ${target.attendance_ratio}`);
  }
  const temporaryRatio = originalRatio >= 0.99 ? 0.5 : 1;

  console.log("[smoke] function_url:", functionUrl);
  console.log("[smoke] actor:", profile?.full_name ?? userId, `(${normalizedRole})`);
  console.log("[smoke] target:", { eventId, memberId, originalRatio, temporaryRatio });

  let restoreAttempted = false;
  try {
    const firstPayload = await callAttendanceWrite({
      functionUrl,
      jwt,
      eventId,
      memberId,
      attendanceRatio: temporaryRatio,
      requestNote: `smoke-db-first-step1:${new Date().toISOString()}`,
    });

    if (firstPayload?.mode !== "db_first" || firstPayload?.status !== "applied") {
      throw new Error(
        `Expected db_first applied response, got mode=${String(firstPayload?.mode)} status=${String(firstPayload?.status)}`,
      );
    }

    if (requireExportTriggerOk) {
      const exportOk = firstPayload?.export_trigger?.ok === true;
      if (!exportOk) {
        throw new Error(
          `Expected export_trigger.ok=true, got: ${JSON.stringify(firstPayload?.export_trigger ?? null)}`,
        );
      }
    }

    const afterFirstRatio = await readCurrentRatio(client, eventId, memberId);
    if (Math.abs(afterFirstRatio - temporaryRatio) > 0.0001) {
      throw new Error(`After step1 expected ratio=${temporaryRatio}, got ratio=${afterFirstRatio}`);
    }

    restoreAttempted = true;
    const restorePayload = await callAttendanceWrite({
      functionUrl,
      jwt,
      eventId,
      memberId,
      attendanceRatio: originalRatio,
      requestNote: `smoke-db-first-restore:${new Date().toISOString()}`,
    });

    if (restorePayload?.mode !== "db_first" || restorePayload?.status !== "applied") {
      throw new Error(
        `Restore write failed: mode=${String(restorePayload?.mode)} status=${String(restorePayload?.status)}`,
      );
    }

    const finalRatio = await readCurrentRatio(client, eventId, memberId);
    if (Math.abs(finalRatio - originalRatio) > 0.0001) {
      throw new Error(`After restore expected ratio=${originalRatio}, got ratio=${finalRatio}`);
    }

    console.log("[smoke] PASS: db_first eventId-only write + restore completed.");
  } catch (error) {
    if (!restoreAttempted) {
      try {
        await callAttendanceWrite({
          functionUrl,
          jwt,
          eventId,
          memberId,
          attendanceRatio: originalRatio,
          requestNote: `smoke-db-first-auto-restore:${new Date().toISOString()}`,
        });
      } catch {
        // Best effort rollback attempt.
      }
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
