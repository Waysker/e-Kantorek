#!/usr/bin/env node

import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const functionsRoot = path.join(appRoot, "supabase", "functions");
const denoBin = process.env.DENO_BIN || "deno";

function printHelp() {
  console.log(`Usage:
  npm run edge:check
  node ./scripts/edge-functions-check.mjs

What it does:
  - finds every app/supabase/functions/**/*.ts file
  - runs deno check across the full set
  - exits non-zero if any file fails type checking

Environment:
  DENO_BIN   Optional override for the Deno executable name/path
`);
}

async function listTypeScriptFiles(rootDir) {
  const files = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".ts")) {
        files.push(absolutePath);
      }
    }
  }

  await walk(rootDir);
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function toAppRelativeUnixPath(absolutePath) {
  return path.relative(appRoot, absolutePath).split(path.sep).join("/");
}

function fail(message) {
  console.error(`edge:check: ${message}`);
  process.exit(1);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

try {
  const files = await listTypeScriptFiles(functionsRoot);

  if (files.length === 0) {
    console.log("edge:check: no TypeScript files found under supabase/functions.");
    process.exit(0);
  }

  console.log(`edge:check: checking ${files.length} TypeScript file(s) with Deno`);
  for (const file of files) {
    console.log(`edge:check: • ${toAppRelativeUnixPath(file)}`);
  }

  const checkArgs = ["check", ...files.map(toAppRelativeUnixPath)];
  const result = spawnSync(denoBin, checkArgs, {
    cwd: appRoot,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      fail(
        `could not find "${denoBin}" on PATH. Install Deno or set DENO_BIN to the executable path.`
      );
    }

    fail(`failed to start Deno: ${result.error.message}`);
  }

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    fail(`Deno type check failed with exit code ${result.status}.`);
  }

  console.log(`edge:check: passed for ${files.length} file(s).`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
