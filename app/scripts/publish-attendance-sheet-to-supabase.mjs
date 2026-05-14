import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  fileExists,
  parseAttendanceWorkbookFromFile,
  resolveAttendanceSourcePath,
} from "./lib/attendance-workbook-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");
const ATTENDANCE_TABLE = "attendance_sheet_cache";
const ENV_PATHS = [
  path.join(APP_ROOT, ".env.local"),
  path.join(APP_ROOT, ".env"),
];

function resolveAttendanceKey() {
  return process.env.ORAGH_ATTENDANCE_KEY?.trim() ?? process.env.ORAGH_SNAPSHOT_KEY?.trim() ?? "forum";
}

function isMissingTableError(error) {
  const message = `${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return (
    message.includes("pgrst205") ||
    message.includes("could not find the table") ||
    message.includes("does not exist")
  );
}

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

async function main() {
  await loadEnv();

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ??
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL and server key (SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY) environment variables.",
    );
  }

  const sourcePath = resolveAttendanceSourcePath(APP_ROOT);
  if (!(await fileExists(sourcePath))) {
    console.log(
      `Attendance workbook was not found at ${sourcePath}. Skipping attendance publish step.`,
    );
    return;
  }

  const { payload } = await parseAttendanceWorkbookFromFile(sourcePath);
  const attendanceKey = resolveAttendanceKey();
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { error } = await client.from(ATTENDANCE_TABLE).upsert(
    {
      attendance_key: attendanceKey,
      payload,
      generated_at: payload.metadata.generatedAt,
    },
    { onConflict: "attendance_key" },
  );

  if (error) {
    if (isMissingTableError(error)) {
      console.warn(
        `Supabase table '${ATTENDANCE_TABLE}' is not available yet. Apply migration 006 and rerun attendance publish.`,
      );
      return;
    }

    throw new Error(`Supabase attendance upsert failed: ${error.message}`);
  }

  console.log(
    `Published attendance workbook '${attendanceKey}' to Supabase from ${sourcePath} (${payload.summary.memberCount} members, ${payload.summary.eventCount} events, ${payload.summary.scoreCount} scores).`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
