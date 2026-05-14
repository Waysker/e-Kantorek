import { promises as fs } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const FIRST_EVENT_COLUMN_INDEX = 4; // E
const FIRST_MEMBER_ROW_INDEX = 1; // Excel row 2

const INSTRUMENT_ALIASES = {
  fagot: "Fagoty",
  fagoty: "Fagoty",
  gitary: "Gitara",
  gitara: "Gitara",
  perkusja: "Perkusja",
  flety: "Flety",
  oboje: "Oboje",
  klarnety: "Klarnety",
  saksofony: "Saksofony",
  waltornie: "Waltornie",
  trabki: "Trąbki",
  "trąbki": "Trąbki",
  eufonia: "Eufonia",
  puzony: "Puzony",
  bas: "Bas",
  tuba: "Tuba",
};

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function stripDiacritics(value) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function normalizeInstrumentLabel(value) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }
  const key = stripDiacritics(normalized).toLowerCase();
  return INSTRUMENT_ALIASES[key] ?? normalized;
}

function normalizeMemberKey(fullName) {
  return stripDiacritics(normalizeWhitespace(fullName)).toLowerCase();
}

function slugify(value) {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toIsoDate(parts) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function parseIsoDateFromLabel(label) {
  const normalized = normalizeWhitespace(label);

  const yyyyMmDd = /(\d{4})[-.](\d{2})[-.](\d{2})/.exec(normalized);
  if (yyyyMmDd) {
    return toIsoDate({
      year: Number.parseInt(yyyyMmDd[1], 10),
      month: Number.parseInt(yyyyMmDd[2], 10),
      day: Number.parseInt(yyyyMmDd[3], 10),
    });
  }

  const ddMmYyyy = /(\d{2})\.(\d{2})\.(\d{4})/.exec(normalized);
  if (ddMmYyyy) {
    return toIsoDate({
      year: Number.parseInt(ddMmYyyy[3], 10),
      month: Number.parseInt(ddMmYyyy[2], 10),
      day: Number.parseInt(ddMmYyyy[1], 10),
    });
  }

  return null;
}

function parseDateFromExcelSerial(serial) {
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed || !parsed.y || !parsed.m || !parsed.d) {
    return null;
  }

  return toIsoDate({
    year: parsed.y,
    month: parsed.m,
    day: parsed.d,
  });
}

function parseHeaderValue(value) {
  if (typeof value === "string") {
    const label = normalizeWhitespace(value);
    if (!label) {
      return null;
    }

    return {
      label,
      dateIso: parseIsoDateFromLabel(label),
    };
  }

  if (typeof value === "number") {
    const dateIso = parseDateFromExcelSerial(value);
    if (!dateIso) {
      return null;
    }

    return {
      label: dateIso,
      dateIso,
    };
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const dateIso = toIsoDate({
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
    });

    return {
      label: dateIso,
      dateIso,
    };
  }

  return null;
}

function parseNumericScore(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(",", ".");
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toCellValue(sheet, rowIndex, columnIndex) {
  const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
  return sheet[address]?.v ?? null;
}

function toColumnName(columnIndex) {
  return XLSX.utils.encode_col(columnIndex);
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function resolveAttendanceSourcePath(appRoot) {
  const configuredPath = process.env.ORAGH_ATTENDANCE_SOURCE_PATH?.trim();
  if (configuredPath) {
    return path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(appRoot, configuredPath);
  }

  return path.resolve(appRoot, "..", "Copy of Obecności 25'-26'.xlsx");
}

export async function parseAttendanceWorkbookFromFile(filePath) {
  const buffer = await fs.readFile(filePath);
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    raw: true,
    cellDates: true,
  });

  const membersByKey = new Map();
  const events = [];
  const scores = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) {
      continue;
    }

    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const eventsByColumnIndex = new Map();

    for (
      let columnIndex = FIRST_EVENT_COLUMN_INDEX;
      columnIndex <= range.e.c;
      columnIndex += 1
    ) {
      const header = parseHeaderValue(toCellValue(sheet, 0, columnIndex));
      if (!header) {
        continue;
      }

      const event = {
        id: `${slugify(sheetName)}-${toColumnName(columnIndex).toLowerCase()}`,
        sheetName,
        column: toColumnName(columnIndex),
        label: header.label,
        dateIso: header.dateIso,
      };

      events.push(event);
      eventsByColumnIndex.set(columnIndex, event);
    }

    let currentInstrument = null;

    for (let rowIndex = FIRST_MEMBER_ROW_INDEX; rowIndex <= range.e.r; rowIndex += 1) {
      const instrument = toCellValue(sheet, rowIndex, 0);
      if (typeof instrument === "string" && normalizeWhitespace(instrument)) {
        currentInstrument = normalizeInstrumentLabel(instrument);
      }

      const lastNameRaw = toCellValue(sheet, rowIndex, 2);
      const firstNameRaw = toCellValue(sheet, rowIndex, 3);
      const lastName = typeof lastNameRaw === "string" ? normalizeWhitespace(lastNameRaw) : "";
      const firstName = typeof firstNameRaw === "string" ? normalizeWhitespace(firstNameRaw) : "";

      if (!lastName && !firstName) {
        continue;
      }

      const fullName = normalizeWhitespace(`${firstName} ${lastName}`);
      if (!fullName) {
        continue;
      }

      const memberKey = normalizeMemberKey(fullName);
      const lpRaw = toCellValue(sheet, rowIndex, 1);
      const lp = typeof lpRaw === "number" && Number.isFinite(lpRaw) ? lpRaw : null;

      const existing = membersByKey.get(memberKey);
      if (!existing) {
        membersByKey.set(memberKey, {
          id: `attendance-member-${slugify(fullName)}`,
          lp,
          firstName,
          lastName,
          fullName,
          instrument: currentInstrument,
        });
      } else if (!existing.instrument && currentInstrument) {
        existing.instrument = currentInstrument;
      }

      const memberId = membersByKey.get(memberKey)?.id ?? `attendance-member-${slugify(fullName)}`;

      for (const [columnIndex, event] of eventsByColumnIndex.entries()) {
        const score = parseNumericScore(toCellValue(sheet, rowIndex, columnIndex));
        if (score === null || score === 0) {
          continue;
        }

        scores.push({
          memberId,
          eventId: event.id,
          points: score,
        });
      }
    }
  }

  const members = Array.from(membersByKey.values()).sort((left, right) =>
    left.fullName.localeCompare(right.fullName, "pl"),
  );
  const instrumentCount = new Set(members.map((member) => member.instrument).filter(Boolean)).size;
  const totalPoints = scores.reduce((sum, entry) => sum + entry.points, 0);

  const payload = {
    version: 1,
    metadata: {
      generatedAt: new Date().toISOString(),
      sourceFileName: path.basename(filePath),
      sourceType: "attendance_workbook",
    },
    members,
    events,
    scores,
    summary: {
      sheetCount: workbook.SheetNames.length,
      memberCount: members.length,
      eventCount: events.length,
      scoreCount: scores.length,
      instrumentCount,
      totalPoints,
    },
  };

  return {
    payload,
    overrides: buildOverridesFromAttendancePayload(payload),
  };
}

export function buildOverridesFromAttendancePayload(payload) {
  const byFullName = {};

  for (const member of payload.members ?? []) {
    if (!member.instrument) {
      continue;
    }
    byFullName[member.fullName] = member.instrument;
  }

  return {
    byUid: {},
    byFullName,
    byUsername: {},
  };
}
