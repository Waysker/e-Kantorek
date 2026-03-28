import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(APP_ROOT, ".cache", "forum-sync");
const SNAPSHOT_JSON_PATH = path.join(CACHE_DIR, "snapshot.json");
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

async function readSnapshot() {
  const raw = await fs.readFile(SNAPSHOT_JSON_PATH, "utf8");
  return JSON.parse(raw);
}

async function main() {
  await loadEnv();

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const snapshotKey = process.env.ORAGH_SNAPSHOT_KEY ?? "forum";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL and server key (SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY) environment variables.",
    );
  }

  const snapshot = await readSnapshot();
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { error } = await client.from("forum_snapshot_cache").upsert(
    {
      snapshot_key: snapshotKey,
      payload: snapshot,
      generated_at: snapshot.metadata?.generatedAt ?? new Date().toISOString(),
    },
    { onConflict: "snapshot_key" },
  );

  if (error) {
    throw new Error(`Supabase upsert failed: ${error.message}`);
  }

  console.log(
    `Published snapshot '${snapshotKey}' to Supabase (${snapshot.events?.length ?? 0} events).`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
