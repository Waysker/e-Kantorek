#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function printHelp() {
  console.log(`Usage:
  npm run attendance:export:csv -- [options]

Options:
  --project-ref <ref>        Supabase project ref (alternative to --functions-base-url)
  --functions-base-url <url> Full functions base URL, e.g. https://<ref>.functions.supabase.co
  --token <token>            Bearer token for attendance_csv_export
  --source-sheet-id <id>     Source sheet id (defaults to ATTENDANCE_SHEET_ID env in function runtime)
  --month <YYYY-MM>          Optional month filter (tab-major month)
  --gid <gid>                Optional source gid filter (repeatable)
  --out-dir <dir>            Output directory (default: .cache/attendance-csv-export)
  --include-inactive <bool>  Include inactive members (default: true)

Env fallbacks:
  SUPABASE_PROJECT_REF
  ATTENDANCE_CSV_EXPORT_FUNCTION_AUTH_TOKEN
  ATTENDANCE_CSV_EXPORT_AUTH_TOKEN
  DB_TO_SHEET_EXPORT_AUTH_TOKEN
  DB_TO_SHEET_EXPORT_TOKEN
`);
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseBoolean(value, fallback) {
  const normalized = normalizeWhitespace(value).toLowerCase();
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

function parseArgs(argv) {
  const result = {
    projectRef: "",
    functionsBaseUrl: "",
    token: "",
    sourceSheetId: "",
    month: "",
    gids: [],
    outDir: ".cache/attendance-csv-export",
    includeInactiveMembers: true,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      result.help = true;
      continue;
    }

    if (token === "--project-ref") {
      result.projectRef = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (token === "--functions-base-url") {
      result.functionsBaseUrl = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (token === "--token") {
      result.token = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (token === "--source-sheet-id") {
      result.sourceSheetId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (token === "--month") {
      result.month = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (token === "--gid") {
      const gid = argv[index + 1] ?? "";
      if (normalizeWhitespace(gid)) {
        result.gids.push(gid);
      }
      index += 1;
      continue;
    }

    if (token === "--out-dir") {
      result.outDir = argv[index + 1] ?? result.outDir;
      index += 1;
      continue;
    }

    if (token === "--include-inactive") {
      result.includeInactiveMembers = parseBoolean(argv[index + 1], true);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const projectRef = normalizeWhitespace(args.projectRef || process.env.SUPABASE_PROJECT_REF || "");
  const functionsBaseUrl = normalizeWhitespace(
    args.functionsBaseUrl || (projectRef ? `https://${projectRef}.functions.supabase.co` : ""),
  );

  if (!functionsBaseUrl) {
    throw new Error("Provide --project-ref or --functions-base-url.");
  }

  const authToken = normalizeWhitespace(
    args.token ||
      process.env.ATTENDANCE_CSV_EXPORT_FUNCTION_AUTH_TOKEN ||
      process.env.ATTENDANCE_CSV_EXPORT_AUTH_TOKEN ||
      process.env.DB_TO_SHEET_EXPORT_AUTH_TOKEN ||
      process.env.DB_TO_SHEET_EXPORT_TOKEN ||
      "",
  );

  if (!authToken) {
    throw new Error(
      "Missing auth token. Provide --token or set ATTENDANCE_CSV_EXPORT_FUNCTION_AUTH_TOKEN / ATTENDANCE_CSV_EXPORT_AUTH_TOKEN / DB_TO_SHEET_EXPORT_AUTH_TOKEN.",
    );
  }

  const payload = {
    sourceSheetId: normalizeWhitespace(args.sourceSheetId) || undefined,
    month: normalizeWhitespace(args.month) || undefined,
    sourceGids: args.gids,
    includeInactiveMembers: Boolean(args.includeInactiveMembers),
  };

  const response = await fetch(`${functionsBaseUrl}/attendance_csv_export`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`attendance_csv_export failed (${response.status}): ${responseText.slice(0, 1000)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error(`attendance_csv_export returned invalid JSON: ${responseText.slice(0, 1000)}`);
  }

  if (parsed?.status !== "ok") {
    throw new Error(`attendance_csv_export returned status=${parsed?.status ?? "unknown"}`);
  }

  const exports = Array.isArray(parsed.exports) ? parsed.exports : [];
  if (exports.length === 0) {
    console.log("No CSV exports returned.");
    return;
  }

  const outDir = path.resolve(process.cwd(), args.outDir);
  await mkdir(outDir, { recursive: true });

  for (const item of exports) {
    const fileName = normalizeWhitespace(item.file_name || "attendance-export.csv");
    const csvText = typeof item.csv === "string" ? item.csv : "";
    const filePath = path.join(outDir, fileName);
    await writeFile(filePath, csvText, "utf8");
    console.log(`wrote ${filePath}`);
  }

  console.log(`Done. Exported ${exports.length} CSV file(s) to ${outDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
