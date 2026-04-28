import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type ProfileRow = {
  id: string;
  full_name: string | null;
  role: string | null;
};

type AttendanceEntryRow = {
  event_id: string;
  member_id: string;
  attendance_ratio: number;
};

class HttpError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

const SMOKE_AUTH_TOKEN = Deno.env.get("SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN");
const SMOKE_TEST_EMAIL =
  normalizeWhitespace(Deno.env.get("SMOKE_ATTENDANCE_TEST_EMAIL") ?? "") ||
  normalizeWhitespace(Deno.env.get("SMOKE_TEST_EMAIL") ?? "");
const SMOKE_TEST_PASSWORD =
  normalizeWhitespace(Deno.env.get("SMOKE_ATTENDANCE_TEST_PASSWORD") ?? "") ||
  normalizeWhitespace(Deno.env.get("SMOKE_TEST_PASSWORD") ?? "");
const SMOKE_EVENT_ID =
  normalizeWhitespace(Deno.env.get("SMOKE_ATTENDANCE_EVENT_ID") ?? "") ||
  normalizeWhitespace(Deno.env.get("SMOKE_EVENT_ID") ?? "");
const SMOKE_MEMBER_ID =
  normalizeWhitespace(Deno.env.get("SMOKE_ATTENDANCE_MEMBER_ID") ?? "") ||
  normalizeWhitespace(Deno.env.get("SMOKE_MEMBER_ID") ?? "");
const DEFAULT_REQUIRE_EXPORT_TRIGGER_OK = parseBooleanEnv(
  Deno.env.get("SMOKE_ATTENDANCE_REQUIRE_EXPORT_TRIGGER_OK"),
  false,
);
const ATTENDANCE_WRITE_FUNCTION_URL =
  normalizeWhitespace(Deno.env.get("SMOKE_ATTENDANCE_WRITE_FUNCTION_URL") ?? "") ||
  normalizeWhitespace(Deno.env.get("EXPO_PUBLIC_ATTENDANCE_WRITE_FUNCTION_URL") ?? "");

function normalizeWhitespace(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBooleanEnv(rawValue: string | undefined, fallback: boolean): boolean {
  const normalized = normalizeWhitespace(rawValue ?? "").toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseBooleanInput(rawValue: unknown, fallback: boolean): boolean {
  return parseBooleanEnv(normalizeWhitespace(rawValue), fallback);
}

function parseBearerToken(headerValue: string | null): string | null {
  const normalized = normalizeWhitespace(headerValue ?? "");
  if (!normalized) {
    return null;
  }
  const match = normalized.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizeRole(rawRole: string | null): "member" | "section" | "board" | "admin" {
  const normalized = normalizeWhitespace(rawRole ?? "").toLowerCase();
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

function deriveAttendanceWriteFunctionUrl(supabaseUrl: string): string {
  const base = new URL(supabaseUrl);
  const projectRef = base.hostname.split(".")[0] ?? "";
  if (!projectRef) {
    throw new HttpError(500, "invalid_supabase_url", "Could not derive project ref from SUPABASE_URL.");
  }
  return `https://${projectRef}.functions.supabase.co/attendance_write_sheet_first`;
}

function parseNumericRatio(rawValue: unknown): number | null {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (parsed < 0 || parsed > 1) {
    return null;
  }
  return Number(parsed.toFixed(4));
}

async function callAttendanceWrite(params: {
  functionUrl: string;
  jwt: string;
  eventId: string;
  memberId: string;
  attendanceRatio: number;
  requestNote: string;
  runTag: string;
}): Promise<Record<string, unknown>> {
  const response = await fetch(params.functionUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "enqueue_batch",
      eventId: params.eventId,
      source: "smoke_attendance_db_first",
      requestNote: params.requestNote,
      changes: [{
        memberId: params.memberId,
        attendanceRatio: params.attendanceRatio,
      }],
      smokeRunTag: params.runTag,
    }),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new HttpError(
      502,
      "attendance_write_call_failed",
      `attendance_write_sheet_first failed (${response.status}).`,
      {
        response_status: response.status,
        response_payload: payload,
      },
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new HttpError(502, "attendance_write_invalid_payload", "attendance_write_sheet_first returned invalid JSON payload.");
  }

  return payload as Record<string, unknown>;
}

async function loadProfile(
  supabaseAdmin: ReturnType<typeof createClient>,
  profileId: string,
): Promise<ProfileRow> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id,full_name,role")
    .eq("id", profileId)
    .maybeSingle<ProfileRow>();
  if (error) {
    throw new HttpError(500, "profile_load_failed", error.message);
  }
  if (!data) {
    throw new HttpError(404, "profile_not_found", `Profile not found for id=${profileId}.`);
  }
  return data;
}

async function loadAttendanceRow(
  supabaseAdmin: ReturnType<typeof createClient>,
  eventId: string,
  memberId: string,
): Promise<AttendanceEntryRow> {
  const { data, error } = await supabaseAdmin
    .from("attendance_entries")
    .select("event_id,member_id,attendance_ratio")
    .eq("event_id", eventId)
    .eq("member_id", memberId)
    .maybeSingle<AttendanceEntryRow>();
  if (error) {
    throw new HttpError(500, "attendance_row_load_failed", error.message);
  }
  if (!data) {
    throw new HttpError(
      404,
      "attendance_row_not_found",
      `Attendance row not found for event_id=${eventId} and member_id=${memberId}.`,
    );
  }
  if (!Number.isFinite(Number(data.attendance_ratio))) {
    throw new HttpError(500, "attendance_row_invalid_ratio", "Attendance row has invalid attendance_ratio value.");
  }
  return data;
}

function almostEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.0001;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new HttpError(500, "missing_supabase_env", "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
    }
    if (!SUPABASE_ANON_KEY) {
      throw new HttpError(500, "missing_anon_key_env", "SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY) is required.");
    }
    if (!SMOKE_TEST_EMAIL || !SMOKE_TEST_PASSWORD) {
      throw new HttpError(
        500,
        "missing_smoke_user_credentials",
        "SMOKE_ATTENDANCE_TEST_EMAIL and SMOKE_ATTENDANCE_TEST_PASSWORD are required.",
      );
    }
    if (!SMOKE_EVENT_ID || !SMOKE_MEMBER_ID) {
      throw new HttpError(
        500,
        "missing_smoke_target",
        "SMOKE_ATTENDANCE_EVENT_ID and SMOKE_ATTENDANCE_MEMBER_ID are required.",
      );
    }

    if (SMOKE_AUTH_TOKEN) {
      const token = parseBearerToken(request.headers.get("authorization"));
      if (token !== SMOKE_AUTH_TOKEN) {
        throw new HttpError(401, "unauthorized", "Invalid bearer token.");
      }
    }

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const requireExportTriggerOk = parseBooleanInput(
      body.requireExportTriggerOk ?? body.require_export_trigger_ok,
      DEFAULT_REQUIRE_EXPORT_TRIGGER_OK,
    );
    const overrideTemporaryRatio = parseNumericRatio(
      body.temporaryRatio ?? body.temporary_ratio ?? body.testRatio ?? body.test_ratio,
    );
    const runTag = `smoke_attendance_db_first:${crypto.randomUUID()}`;

    const attendanceWriteUrl = ATTENDANCE_WRITE_FUNCTION_URL || deriveAttendanceWriteFunctionUrl(SUPABASE_URL);
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: signInData, error: signInError } = await supabaseAuth.auth.signInWithPassword({
      email: SMOKE_TEST_EMAIL,
      password: SMOKE_TEST_PASSWORD,
    });
    if (signInError || !signInData.session?.access_token || !signInData.user?.id) {
      throw new HttpError(
        401,
        "smoke_sign_in_failed",
        `Smoke user sign-in failed: ${signInError?.message ?? "missing_session"}.`,
      );
    }

    const jwt = signInData.session.access_token;
    const profile = await loadProfile(supabaseAdmin, signInData.user.id);
    const role = normalizeRole(profile.role);
    if (!["section", "board", "admin"].includes(role)) {
      throw new HttpError(
        403,
        "smoke_user_not_manager",
        `Smoke user role must be section/board/admin, got ${role}.`,
      );
    }

    const initialRow = await loadAttendanceRow(supabaseAdmin, SMOKE_EVENT_ID, SMOKE_MEMBER_ID);
    const originalRatio = Number(initialRow.attendance_ratio);
    const temporaryRatio = overrideTemporaryRatio ?? (almostEqual(originalRatio, 1) ? 0.5 : 1);
    if (almostEqual(temporaryRatio, originalRatio)) {
      throw new HttpError(422, "invalid_temporary_ratio", "temporaryRatio must differ from current attendance ratio.");
    }

    let restoreAttempted = false;
    try {
      const firstPayload = await callAttendanceWrite({
        functionUrl: attendanceWriteUrl,
        jwt,
        eventId: SMOKE_EVENT_ID,
        memberId: SMOKE_MEMBER_ID,
        attendanceRatio: temporaryRatio,
        requestNote: `${runTag}:step1`,
        runTag,
      });

      if (firstPayload.mode !== "db_first" || firstPayload.status !== "applied") {
        throw new HttpError(
          502,
          "unexpected_write_response",
          `Expected mode=db_first/status=applied, got mode=${String(firstPayload.mode)} status=${String(firstPayload.status)}.`,
          { first_payload: firstPayload },
        );
      }

      if (requireExportTriggerOk) {
        const exportTrigger = firstPayload.export_trigger as Record<string, unknown> | null | undefined;
        const exportOk = exportTrigger?.ok === true;
        if (!exportOk) {
          throw new HttpError(
            502,
            "export_trigger_not_ok",
            "Expected export_trigger.ok=true for smoke run.",
            { export_trigger: exportTrigger ?? null },
          );
        }
      }

      const afterFirstRow = await loadAttendanceRow(supabaseAdmin, SMOKE_EVENT_ID, SMOKE_MEMBER_ID);
      const afterFirstRatio = Number(afterFirstRow.attendance_ratio);
      if (!almostEqual(afterFirstRatio, temporaryRatio)) {
        throw new HttpError(
          500,
          "smoke_first_step_ratio_mismatch",
          `After step1 expected ratio=${temporaryRatio}, got ratio=${afterFirstRatio}.`,
        );
      }

      restoreAttempted = true;
      const restorePayload = await callAttendanceWrite({
        functionUrl: attendanceWriteUrl,
        jwt,
        eventId: SMOKE_EVENT_ID,
        memberId: SMOKE_MEMBER_ID,
        attendanceRatio: originalRatio,
        requestNote: `${runTag}:restore`,
        runTag,
      });

      if (restorePayload.mode !== "db_first" || restorePayload.status !== "applied") {
        throw new HttpError(
          502,
          "unexpected_restore_response",
          `Expected restore mode=db_first/status=applied, got mode=${String(restorePayload.mode)} status=${String(restorePayload.status)}.`,
          { restore_payload: restorePayload },
        );
      }

      const finalRow = await loadAttendanceRow(supabaseAdmin, SMOKE_EVENT_ID, SMOKE_MEMBER_ID);
      const finalRatio = Number(finalRow.attendance_ratio);
      if (!almostEqual(finalRatio, originalRatio)) {
        throw new HttpError(
          500,
          "smoke_restore_ratio_mismatch",
          `After restore expected ratio=${originalRatio}, got ratio=${finalRatio}.`,
        );
      }

      return jsonResponse({
        status: "ok",
        smoke_run_tag: runTag,
        mode: "db_first",
        event_id: SMOKE_EVENT_ID,
        member_id: SMOKE_MEMBER_ID,
        actor_profile_id: profile.id,
        actor_full_name: profile.full_name,
        actor_role: role,
        original_ratio: originalRatio,
        temporary_ratio: temporaryRatio,
        require_export_trigger_ok: requireExportTriggerOk,
      });
    } catch (error) {
      if (!restoreAttempted) {
        try {
          await callAttendanceWrite({
            functionUrl: attendanceWriteUrl,
            jwt,
            eventId: SMOKE_EVENT_ID,
            memberId: SMOKE_MEMBER_ID,
            attendanceRatio: originalRatio,
            requestNote: `${runTag}:best_effort_restore`,
            runTag,
          });
        } catch {
          // Best effort rollback only.
        }
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({
        error: error.code,
        message: error.message,
        details: error.details ?? null,
      }, error.status);
    }

    return jsonResponse({
      error: "internal_error",
      message: sanitizeErrorMessage(error),
    }, 500);
  }
});
