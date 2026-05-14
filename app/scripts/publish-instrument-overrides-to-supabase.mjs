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
const DEFAULT_OVERRIDES_PATH = path.join(APP_ROOT, "forum-sync.instrument-overrides.json");
const FORUM_OVERRIDES_TABLE = "forum_instrument_overrides";
const ENV_PATHS = [
  path.join(APP_ROOT, ".env.local"),
  path.join(APP_ROOT, ".env"),
];

function toObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeOverridesShape(value) {
  const parsed = toObject(value);
  return {
    byUid: toObject(parsed.byUid),
    byFullName: toObject(parsed.byFullName),
    byUsername: toObject(parsed.byUsername),
  };
}

function countOverrideEntries(overrides) {
  return (
    Object.keys(overrides.byUid).length +
    Object.keys(overrides.byFullName).length +
    Object.keys(overrides.byUsername).length
  );
}

function resolveOverridesKey() {
  return process.env.ORAGH_INSTRUMENT_OVERRIDES_KEY?.trim() ?? process.env.ORAGH_SNAPSHOT_KEY?.trim() ?? "forum";
}

function isMissingOverridesTableError(error) {
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

async function readOverridesPayload() {
  const rawEnvOverrides = process.env.ORAGH_FORUM_INSTRUMENT_OVERRIDES_JSON;
  if (typeof rawEnvOverrides === "string" && rawEnvOverrides.trim().length > 0) {
    try {
      return {
        source: "env:ORAGH_FORUM_INSTRUMENT_OVERRIDES_JSON",
        overrides: normalizeOverridesShape(JSON.parse(rawEnvOverrides)),
      };
    } catch {
      throw new Error(
        "ORAGH_FORUM_INSTRUMENT_OVERRIDES_JSON is not valid JSON. Expected { byUid, byFullName, byUsername }.",
      );
    }
  }

  const attendanceWorkbookPath = resolveAttendanceSourcePath(APP_ROOT);
  if (await fileExists(attendanceWorkbookPath)) {
    try {
      const parsed = await parseAttendanceWorkbookFromFile(attendanceWorkbookPath);
      return {
        source: attendanceWorkbookPath,
        overrides: normalizeOverridesShape(parsed.overrides),
      };
    } catch (error) {
      console.warn(
        `Could not parse attendance workbook at ${attendanceWorkbookPath}. Falling back to JSON overrides. (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
  }

  const configuredPath = process.env.ORAGH_FORUM_INSTRUMENT_OVERRIDES_PATH?.trim();
  const sourcePath = configuredPath
    ? (path.isAbsolute(configuredPath) ? configuredPath : path.resolve(APP_ROOT, configuredPath))
    : DEFAULT_OVERRIDES_PATH;

  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`Overrides source file not found: ${sourcePath}`);
    }
    throw error;
  }

  return {
    source: sourcePath,
    overrides: normalizeOverridesShape(parsed),
  };
}

async function main() {
  await loadEnv();

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ??
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const overridesKey = resolveOverridesKey();
  const forcePublish = process.env.FORUM_SYNC_FORCE_OVERRIDE_PUBLISH === "1";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL and server key (SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY) environment variables.",
    );
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: existingRow, error: readError } = await client
    .from(FORUM_OVERRIDES_TABLE)
    .select("overrides_key")
    .eq("overrides_key", overridesKey)
    .maybeSingle();

  if (readError) {
    if (isMissingOverridesTableError(readError)) {
      console.warn(
        `Supabase table '${FORUM_OVERRIDES_TABLE}' is not available yet. Apply migration 005 and rerun overrides publish.`,
      );
      return;
    }

    throw new Error(`Supabase overrides read failed: ${readError.message}`);
  }

  if (existingRow && !forcePublish) {
    console.log(
      `Supabase overrides key '${overridesKey}' already exists. Skipping publish to avoid overriding DB state.`,
    );
    console.log("Set FORUM_SYNC_FORCE_OVERRIDE_PUBLISH=1 to overwrite the existing row.");
    return;
  }

  const { source, overrides } = await readOverridesPayload();

  const { error: writeError } = await client.from(FORUM_OVERRIDES_TABLE).upsert(
    {
      overrides_key: overridesKey,
      payload: overrides,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "overrides_key" },
  );

  if (writeError) {
    if (isMissingOverridesTableError(writeError)) {
      console.warn(
        `Supabase table '${FORUM_OVERRIDES_TABLE}' is not available yet. Apply migration 005 and rerun overrides publish.`,
      );
      return;
    }

    throw new Error(`Supabase overrides upsert failed: ${writeError.message}`);
  }

  console.log(
    `Published instrument overrides '${overridesKey}' to Supabase from ${source} (${countOverrideEntries(overrides)} entries).`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
