import { writeFile } from "node:fs/promises";
import https from "node:https";
import process from "node:process";

function printHelp() {
  console.log(`
Usage:
  node ./scripts/attendance-sheet-preflight.mjs --sheet-id <id> --gid <gid> [--out <path>] [--strict]
  node ./scripts/attendance-sheet-preflight.mjs --csv <path> [--out <path>] [--strict]

Options:
  --sheet-id <id>   Google Sheet id
  --gid <gid>       Google Sheet tab gid
  --csv <path>      Local CSV input (alternative to --sheet-id/--gid)
  --out <path>      Optional JSON output path
  --strict          Exit with code 1 when validation errors are found
  --help            Show this help

Attendance value interpretation:
  1      => 100%
  0.75   => 75%
  0,5    => 50%
  75     => 75% (accepted with warning)
  75%    => 75%
  (empty)=> no declaration
`);
}

function parseArgs(argv) {
  const args = {
    strict: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help") {
      args.help = true;
      continue;
    }
    if (token === "--strict") {
      args.strict = true;
      continue;
    }
    if (token === "--sheet-id") {
      args.sheetId = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--gid") {
      args.gid = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--csv") {
      args.csvPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--out") {
      args.outPath = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (args.help) {
    return args;
  }

  if (!args.csvPath && !(args.sheetId && args.gid)) {
    throw new Error("Provide either --csv or both --sheet-id and --gid.");
  }

  if (args.csvPath && (args.sheetId || args.gid)) {
    throw new Error("Use either --csv or --sheet-id/--gid, not both.");
  }

  return args;
}

function getUrl(url, redirects = 4) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "attendance-sheet-preflight",
          Accept: "text/csv,text/plain,*/*",
        },
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;

        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          response.headers.location &&
          redirects > 0
        ) {
          resolve(getUrl(response.headers.location, redirects - 1));
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`Request failed with status ${statusCode} for ${url}`));
          return;
        }

        let payload = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          payload += chunk;
        });
        response.on("end", () => resolve(payload));
      },
    );

    request.on("error", (error) => reject(error));
  });
}

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];

    if (inQuotes) {
      if (char === '"') {
        if (csvText[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    field += char;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isBlank(value) {
  return normalizeWhitespace(value).length === 0;
}

function toColumnLabel(columnIndexZeroBased) {
  let number = columnIndexZeroBased + 1;
  let result = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

function createIssue(code, message, details = {}) {
  return {
    code,
    message,
    ...details,
  };
}

function slugify(value) {
  return normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildIsoDate(year, month, day) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function inferEventDate(headerLabel) {
  const header = normalizeWhitespace(headerLabel);
  const isoMatch = header.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const middle = Number(isoMatch[2]);
    const trailing = Number(isoMatch[3]);
    const isoDate = buildIsoDate(year, middle, trailing);
    if (isoDate) {
      return {
        status: "ok",
        isoDate,
        year,
        inferredYear: false,
        hadDateToken: true,
      };
    }

    const suggested = middle > 12 && trailing <= 12 ? buildIsoDate(year, trailing, middle) : null;
    return {
      status: "invalid",
      reason: "invalid_iso_date_token",
      token: isoMatch[0],
      suggestedIsoDate: suggested,
      hadDateToken: true,
    };
  }

  const dayMonthMatch = header.match(/(^|[^\d])(\d{1,2})[./-](\d{1,2})([^\d]|$)/);
  if (dayMonthMatch) {
    return {
      status: "needs_year",
      day: Number(dayMonthMatch[2]),
      month: Number(dayMonthMatch[3]),
      hadDateToken: true,
    };
  }

  return {
    status: "missing",
    hadDateToken: false,
  };
}

function eventLabelFromHeader(header) {
  const compact = normalizeWhitespace(header)
    .replace(/(\d{4}[./-]\d{1,2}[./-]\d{1,2})/g, "")
    .replace(/(^|[^\d])(\d{1,2})[./-](\d{1,2})([^\d]|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return compact || normalizeWhitespace(header);
}

function parseAttendanceValue(rawValue) {
  const rawTrimmed = normalizeWhitespace(rawValue);
  if (!rawTrimmed) {
    return { kind: "empty" };
  }

  const normalized = rawTrimmed.replace(/\s+/g, "").replace(",", ".");
  let ratio;
  let warningCode = null;

  if (normalized.endsWith("%")) {
    const numericPart = normalized.slice(0, -1);
    const number = Number(numericPart);
    if (!Number.isFinite(number)) {
      return { kind: "error", reason: "not_a_number", raw: rawTrimmed };
    }
    ratio = number / 100;
  } else {
    const number = Number(normalized);
    if (!Number.isFinite(number)) {
      return { kind: "error", reason: "not_a_number", raw: rawTrimmed };
    }

    if (number > 1 && number <= 100) {
      ratio = number / 100;
      warningCode = "interpreted_as_percent";
    } else {
      ratio = number;
    }
  }

  if (ratio < 0 || ratio > 1) {
    return {
      kind: "error",
      reason: "out_of_range",
      raw: rawTrimmed,
      parsedRatio: ratio,
    };
  }

  const roundedRatio = Math.round(ratio * 10000) / 10000;
  const percent = Math.round(roundedRatio * 10000) / 100;

  return {
    kind: "value",
    raw: rawTrimmed,
    ratio: roundedRatio,
    percent,
    warningCode,
  };
}

function mode(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let bestValue = null;
  let bestCount = -1;
  for (const [value, count] of counts.entries()) {
    if (count > bestCount) {
      bestCount = count;
      bestValue = value;
    }
  }
  return bestValue;
}

function buildContract(rows, sourceInfo) {
  if (rows.length === 0) {
    return {
      report: null,
      errors: [createIssue("empty_csv", "CSV input has no rows.")],
      warnings: [],
    };
  }

  const header = rows[0];
  const errors = [];
  const warnings = [];

  const expectedPrefix = ["", "L.p.", "Nazwisko", "Imię"];
  for (let index = 0; index < expectedPrefix.length; index += 1) {
    const expected = expectedPrefix[index];
    const actual = normalizeWhitespace(header[index] ?? "");
    if (expected && actual !== expected) {
      warnings.push(
        createIssue(
          "unexpected_header_prefix",
          `Expected header ${toColumnLabel(index)} to be "${expected}" but got "${actual}".`,
          {
            column: toColumnLabel(index),
            expected,
            actual,
          },
        ),
      );
    }
  }

  const rawEventColumns = [];
  for (let col = 4; col < header.length; col += 1) {
    const rawHeader = normalizeWhitespace(header[col] ?? "");
    if (!rawHeader) {
      continue;
    }
    rawEventColumns.push({
      columnIndex: col,
      header: rawHeader,
      parsedDate: inferEventDate(rawHeader),
    });
  }

  if (rawEventColumns.length === 0) {
    errors.push(
      createIssue(
        "no_event_columns",
        "No event columns were found (expected non-empty headers from column E onward).",
      ),
    );
  }

  const explicitYears = rawEventColumns
    .filter((item) => item.parsedDate.status === "ok")
    .map((item) => item.parsedDate.year);
  const dominantYear = explicitYears.length > 0 ? mode(explicitYears) : null;

  const usedEventIds = new Set();
  const events = rawEventColumns.map((rawItem, position) => {
    const parsed = rawItem.parsedDate;
    let isoDate = null;
    let inferredYear = false;

    if (parsed.status === "ok") {
      isoDate = parsed.isoDate;
    } else if (parsed.status === "needs_year") {
      if (dominantYear == null) {
        errors.push(
          createIssue(
            "missing_event_year",
            `Event date in ${toColumnLabel(rawItem.columnIndex)} has no year and dominant year cannot be inferred.`,
            {
              column: toColumnLabel(rawItem.columnIndex),
              header: rawItem.header,
            },
          ),
        );
      } else {
        const inferred = buildIsoDate(dominantYear, parsed.month, parsed.day);
        if (!inferred) {
          errors.push(
            createIssue(
              "invalid_event_day_month",
              `Event date token in ${toColumnLabel(rawItem.columnIndex)} is invalid.`,
              {
                column: toColumnLabel(rawItem.columnIndex),
                header: rawItem.header,
                day: parsed.day,
                month: parsed.month,
              },
            ),
          );
        } else {
          isoDate = inferred;
          inferredYear = true;
          warnings.push(
            createIssue(
              "event_year_inferred",
              `Inferred year ${dominantYear} for event header in ${toColumnLabel(rawItem.columnIndex)}.`,
              {
                column: toColumnLabel(rawItem.columnIndex),
                header: rawItem.header,
                inferredYear: dominantYear,
              },
            ),
          );
        }
      }
    } else if (parsed.status === "invalid") {
      errors.push(
        createIssue(
          "invalid_event_date_token",
          `Invalid date token "${parsed.token}" in ${toColumnLabel(rawItem.columnIndex)}.`,
          {
            column: toColumnLabel(rawItem.columnIndex),
            header: rawItem.header,
            token: parsed.token,
            suggestedIsoDate: parsed.suggestedIsoDate,
          },
        ),
      );
    } else {
      warnings.push(
        createIssue(
          "event_without_date",
          `No date token found in ${toColumnLabel(rawItem.columnIndex)}.`,
          {
            column: toColumnLabel(rawItem.columnIndex),
            header: rawItem.header,
          },
        ),
      );
    }

    const label = eventLabelFromHeader(rawItem.header);
    const baseId =
      (isoDate ? `${isoDate}-${slugify(label)}` : slugify(rawItem.header)) ||
      `event-${position + 1}`;
    let eventId = baseId;
    let suffix = 2;
    while (usedEventIds.has(eventId)) {
      eventId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedEventIds.add(eventId);

    return {
      id: eventId,
      columnIndex: rawItem.columnIndex,
      column: toColumnLabel(rawItem.columnIndex),
      sourceHeader: rawItem.header,
      label,
      isoDate,
      inferredYear,
    };
  });

  const participants = [];
  const participantKeys = new Set();
  let currentSection = "";
  let attendanceCellsFilled = 0;
  let attendanceCellsEmpty = 0;
  let attendanceRowsWithAnyValue = 0;

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const sectionCell = normalizeWhitespace(row[0] ?? "");
    if (sectionCell) {
      currentSection = sectionCell;
    }

    const positionRaw = normalizeWhitespace(row[1] ?? "");
    const lastName = normalizeWhitespace(row[2] ?? "");
    const firstName = normalizeWhitespace(row[3] ?? "");

    if (!lastName && !firstName) {
      continue;
    }

    if (!lastName || !firstName) {
      errors.push(
        createIssue(
          "incomplete_name",
          `Incomplete name in row ${rowIndex + 1}.`,
          {
            row: rowIndex + 1,
            rowRef: `${rowIndex + 1}`,
            lastName,
            firstName,
          },
        ),
      );
    }

    if (!currentSection) {
      warnings.push(
        createIssue(
          "missing_section_context",
          `No instrument section set before row ${rowIndex + 1}; using "Unknown".`,
          {
            row: rowIndex + 1,
          },
        ),
      );
    }

    const participantKey = `${lastName.toLowerCase()}|${firstName.toLowerCase()}|${currentSection.toLowerCase()}`;
    if (participantKeys.has(participantKey)) {
      warnings.push(
        createIssue(
          "duplicate_participant_key",
          `Duplicate participant key in row ${rowIndex + 1}: ${lastName} ${firstName}.`,
          {
            row: rowIndex + 1,
            fullName: `${firstName} ${lastName}`.trim(),
            section: currentSection || "Unknown",
          },
        ),
      );
    } else {
      participantKeys.add(participantKey);
    }

    const attendance = {};
    let rowHasAnyValue = false;

    for (const event of events) {
      const parsedValue = parseAttendanceValue(row[event.columnIndex] ?? "");
      if (parsedValue.kind === "empty") {
        attendance[event.id] = null;
        attendanceCellsEmpty += 1;
        continue;
      }

      if (parsedValue.kind === "error") {
        errors.push(
          createIssue(
            "invalid_attendance_value",
            `Invalid attendance value "${normalizeWhitespace(row[event.columnIndex] ?? "")}" at ${event.column}${rowIndex + 1}.`,
            {
              row: rowIndex + 1,
              column: event.column,
              eventId: event.id,
              reason: parsedValue.reason,
              value: normalizeWhitespace(row[event.columnIndex] ?? ""),
              parsedRatio: parsedValue.parsedRatio,
            },
          ),
        );
        attendance[event.id] = null;
        attendanceCellsEmpty += 1;
        continue;
      }

      if (parsedValue.warningCode === "interpreted_as_percent") {
        warnings.push(
          createIssue(
            "attendance_interpreted_as_percent",
            `Interpreted value "${parsedValue.raw}" as percentage at ${event.column}${rowIndex + 1}.`,
            {
              row: rowIndex + 1,
              column: event.column,
              eventId: event.id,
              value: parsedValue.raw,
            },
          ),
        );
      }

      attendance[event.id] = {
        raw: parsedValue.raw,
        ratio: parsedValue.ratio,
        percent: parsedValue.percent,
      };
      rowHasAnyValue = true;
      attendanceCellsFilled += 1;
    }

    if (rowHasAnyValue) {
      attendanceRowsWithAnyValue += 1;
    }

    participants.push({
      row: rowIndex + 1,
      position: positionRaw || null,
      instrumentSection: currentSection || "Unknown",
      firstName: firstName || null,
      lastName: lastName || null,
      fullName: `${firstName} ${lastName}`.trim(),
      attendance,
    });
  }

  if (participants.length === 0) {
    errors.push(createIssue("no_participants", "No participant rows were parsed."));
  }

  const report = {
    schemaVersion: "attendance-sheet-v1",
    generatedAt: new Date().toISOString(),
    source: sourceInfo,
    contract: {
      baseColumns: {
        instrumentSection: "A",
        listPosition: "B",
        lastName: "C",
        firstName: "D",
      },
      attendanceSemantics: {
        ratioRange: [0, 1],
        percentInterpretation: true,
        emptyValue: "no_declaration",
      },
    },
    stats: {
      totalRows: Math.max(rows.length - 1, 0),
      participants: participants.length,
      events: events.length,
      attendanceCellsFilled,
      attendanceCellsEmpty,
      attendanceRowsWithAnyValue,
      dominantYear,
    },
    events,
    participants,
    errors,
    warnings,
  };

  return { report, errors, warnings };
}

async function loadCsvText(args) {
  if (args.csvPath) {
    const { readFile } = await import("node:fs/promises");
    const csvText = await readFile(args.csvPath, "utf8");
    return {
      csvText,
      sourceInfo: {
        type: "csv_file",
        path: args.csvPath,
      },
    };
  }

  const url = `https://docs.google.com/spreadsheets/d/${args.sheetId}/gviz/tq?tqx=out:csv&gid=${args.gid}`;
  const csvText = await getUrl(url);
  return {
    csvText,
    sourceInfo: {
      type: "google_sheet_csv_export",
      sheetId: args.sheetId,
      gid: args.gid,
      csvExportUrl: url,
    },
  };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printHelp();
    process.exitCode = 2;
    return;
  }

  if (args.help) {
    printHelp();
    return;
  }

  const { csvText, sourceInfo } = await loadCsvText(args);
  const rows = parseCsv(csvText);
  const { report, errors, warnings } = buildContract(rows, sourceInfo);

  if (!report) {
    console.error("Failed to build report.");
    process.exitCode = 1;
    return;
  }

  if (args.outPath) {
    await writeFile(args.outPath, JSON.stringify(report, null, 2), "utf8");
    console.log(`Wrote report to ${args.outPath}`);
  }

  console.log("");
  console.log("Attendance Sheet Preflight");
  console.log("--------------------------");
  console.log(`Participants: ${report.stats.participants}`);
  console.log(`Events: ${report.stats.events}`);
  console.log(`Filled attendance cells: ${report.stats.attendanceCellsFilled}`);
  console.log(`Warnings: ${warnings.length}`);
  console.log(`Errors: ${errors.length}`);

  if (warnings.length > 0) {
    console.log("");
    console.log("Top warnings:");
    warnings.slice(0, 12).forEach((warning, index) => {
      console.log(`${index + 1}. [${warning.code}] ${warning.message}`);
    });
    if (warnings.length > 12) {
      console.log(`... and ${warnings.length - 12} more warnings.`);
    }
  }

  if (errors.length > 0) {
    console.log("");
    console.log("Top errors:");
    errors.slice(0, 12).forEach((error, index) => {
      console.log(`${index + 1}. [${error.code}] ${error.message}`);
    });
    if (errors.length > 12) {
      console.log(`... and ${errors.length - 12} more errors.`);
    }
  }

  if (args.strict && errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
