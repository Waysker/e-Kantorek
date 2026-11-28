// Runs the attendance smoke test (Edge Function smoke_attendance_db_first) on the
// self-hosted Supabase. The function writes only to its own hidden fixture event,
// skips the copy-sheet export and cleans up (docs/reference/attendance-model.md).
//
// Needs SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and
// SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN, from the environment or app/.env(.local).
// Optional: SMOKE_CHECK_SYNC_CONTRACT=false to skip the sheet-sync dry run.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadEnvFile(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  for (const line of raw.split(/\r?\n/)) {
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
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

await loadEnvFile(path.join(APP_ROOT, ".env.local"));
await loadEnvFile(path.join(APP_ROOT, ".env"));

const supabaseUrl = (process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
const token = (process.env.SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN || "").trim();
const checkSyncContract = !/^(0|false|no|off)$/i.test((process.env.SMOKE_CHECK_SYNC_CONTRACT || "true").trim());

if (!supabaseUrl || !token) {
  console.error("Set SUPABASE_URL and SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN.");
  process.exit(1);
}

const response = await fetch(`${supabaseUrl}/functions/v1/smoke_attendance_db_first`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ checkSyncContract }),
});

const text = await response.text();
let payload = null;
try {
  payload = JSON.parse(text);
} catch {
  payload = null;
}

console.log(payload ? JSON.stringify(payload, null, 2) : text);
if (!response.ok || payload?.status !== "ok") {
  console.error(`Smoke failed (HTTP ${response.status}).`);
  process.exit(1);
}
console.log("Smoke ok.");
