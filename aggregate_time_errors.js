#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const TARGET_MIN = 3;
const TARGET_MAX = 10;
const TARGETS = Array.from(
  { length: TARGET_MAX - TARGET_MIN + 1 },
  (_, i) => TARGET_MIN + i,
);

function parseArgs() {
  const [, , inputDirArg, outputFileArg] = process.argv;
  const inputDir = inputDirArg ? path.resolve(inputDirArg) : process.cwd();
  const outputFile = outputFileArg
    ? path.resolve(outputFileArg)
    : path.join(inputDir, "wyniki_google_sheets.csv");
  return { inputDir, outputFile };
}

function readCsvRows(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];

    if (ch === '"') {
      if (inQuotes && raw[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && raw[i + 1] === "\n") {
        i += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function parseNumber(value) {
  if (value === undefined || value === null) {
    return NaN;
  }
  const normalized = String(value).trim().replace(",", ".");
  if (normalized === "") {
    return NaN;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function targetBucket(value) {
  if (!isFiniteNumber(value)) {
    return null;
  }
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) <= 1e-6 && rounded >= TARGET_MIN && rounded <= TARGET_MAX) {
    return rounded;
  }
  return null;
}

function mean(values) {
  if (values.length === 0) {
    return null;
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

function formatMaybe(value) {
  if (value === null || !Number.isFinite(value)) {
    return "";
  }
  return value.toFixed(10);
}

function findAllIndexes(headers, name) {
  const result = [];
  for (let i = 0; i < headers.length; i += 1) {
    if (headers[i] === name) {
      result.push(i);
    }
  }
  return result;
}

function firstNonEmptyFromIndexes(row, indexes) {
  for (const idx of indexes) {
    const value = row[idx];
    if (value !== undefined) {
      const text = String(value).trim();
      if (text !== "") {
        return text;
      }
    }
  }
  return "";
}

function processFile(filePath) {
  const rows = readCsvRows(filePath);
  if (rows.length < 2) {
    return null;
  }

  const headers = rows[0].map((h) => String(h).trim());
  const dataRows = rows.slice(1).filter((r) => r.length > 0);

  const holdIdx = headers.indexOf("hold_time");
  const circleIdx = headers.indexOf("circle_duration");
  if (holdIdx < 0 || circleIdx < 0) {
    return null;
  }

  const idIdx = headers.indexOf("participant");
  const groupIndexes = findAllIndexes(headers, "grupa");

  let id = "";
  let grupa = "";

  const pairs = [];
  let normalScore = 0;
  let swappedScore = 0;

  for (const row of dataRows) {
    if (id === "" && idIdx >= 0) {
      const maybeId = String(row[idIdx] ?? "").trim();
      if (maybeId !== "") {
        id = maybeId;
      }
    }

    if (grupa === "" && groupIndexes.length > 0) {
      const maybeGroup = firstNonEmptyFromIndexes(row, groupIndexes);
      if (maybeGroup !== "") {
        grupa = maybeGroup;
      }
    }

    const hold = parseNumber(row[holdIdx]);
    const circle = parseNumber(row[circleIdx]);
    if (!isFiniteNumber(hold) || !isFiniteNumber(circle)) {
      continue;
    }

    pairs.push({ hold, circle });

    if (targetBucket(hold) !== null) {
      normalScore += 1;
    }
    if (targetBucket(circle) !== null) {
      swappedScore += 1;
    }
  }

  if (pairs.length === 0) {
    return null;
  }

  const swapped = swappedScore > normalScore;
  const perTargetValues = new Map(TARGETS.map((t) => [t, []]));

  for (const p of pairs) {
    const targetValue = swapped ? p.circle : p.hold;
    const measuredValue = swapped ? p.hold : p.circle;
    const bucket = targetBucket(targetValue);
    if (bucket === null) {
      continue;
    }
    perTargetValues.get(bucket).push(measuredValue);
  }

  if (!id) {
    id = path.basename(filePath, path.extname(filePath));
  }

  const result = {
    ID: id,
    Grupa: grupa,
  };

  for (const target of TARGETS) {
    const values = perTargetValues.get(target);
    const relValues = values.map((v) => v / target);
    const absValues = values.map((v) => Math.abs(v - target));
    result[`${target}_s_wzg`] = formatMaybe(mean(relValues));
    result[`${target}_s_bez`] = formatMaybe(mean(absValues));
  }

  return result;
}

function toCsv(records) {
  const headers = [
    "ID",
    "Grupa",
    ...TARGETS.map((t) => `${t}_s_wzg`),
    ...TARGETS.map((t) => `${t}_s_bez`),
  ];

  const lines = [headers.join(",")];
  for (const record of records) {
    const values = headers.map((h) => {
      const value = record[h] ?? "";
      const text = String(value);
      if (text.includes(",") || text.includes('"') || text.includes("\n")) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    });
    lines.push(values.join(","));
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const { inputDir, outputFile } = parseArgs();
  if (!fs.existsSync(inputDir)) {
    throw new Error(`Folder nie istnieje: ${inputDir}`);
  }

  const outputBase = path.basename(outputFile).toLowerCase();
  const csvFiles = fs
    .readdirSync(inputDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase().endsWith(".csv"))
    .filter((name) => name.toLowerCase() !== outputBase)
    .map((name) => path.join(inputDir, name));

  if (csvFiles.length === 0) {
    throw new Error(`Brak plików CSV w folderze: ${inputDir}`);
  }

  const records = [];
  for (const filePath of csvFiles) {
    const record = processFile(filePath);
    if (record) {
      records.push(record);
    }
  }

  if (records.length === 0) {
    throw new Error("Nie udało się przetworzyć żadnego pliku CSV (brak wymaganych kolumn lub danych).");
  }

  records.sort((a, b) => String(a.ID).localeCompare(String(b.ID), "pl"));
  const out = toCsv(records);
  fs.writeFileSync(outputFile, out, "utf8");

  // eslint-disable-next-line no-console
  console.log(`Przetworzono plików: ${records.length}`);
  // eslint-disable-next-line no-console
  console.log(`Wynik zapisany do: ${outputFile}`);
}

main();
