import * as XLSX from "xlsx";

const FIRST_EVENT_COLUMN_INDEX = 4; // E
const FIRST_MEMBER_ROW_INDEX = 1; // Excel row 2

const INSTRUMENT_ALIASES: Record<string, string> = {
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
  trąbki: "Trąbki",
  eufonia: "Eufonia",
  puzony: "Puzony",
  bas: "Bas",
  tuba: "Tuba",
};

export type AttendanceWorkbookMember = {
  id: string;
  lp: number | null;
  firstName: string;
  lastName: string;
  fullName: string;
  instrument: string | null;
};

export type AttendanceWorkbookEvent = {
  id: string;
  sheetName: string;
  column: string;
  label: string;
  dateIso: string | null;
};

export type AttendanceWorkbookScore = {
  memberId: string;
  eventId: string;
  points: number;
};

export type AttendanceWorkbookPayload = {
  version: 1;
  metadata: {
    generatedAt: string;
    sourceFileName: string;
    sourceType: "attendance_workbook";
  };
  members: AttendanceWorkbookMember[];
  events: AttendanceWorkbookEvent[];
  scores: AttendanceWorkbookScore[];
  summary: {
    sheetCount: number;
    memberCount: number;
    eventCount: number;
    scoreCount: number;
    instrumentCount: number;
    totalPoints: number;
  };
};

type ParsedHeader = {
  label: string;
  dateIso: string | null;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function normalizeInstrumentLabel(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }

  const key = stripDiacritics(normalized).toLowerCase();
  return INSTRUMENT_ALIASES[key] ?? normalized;
}

function normalizeMemberKey(fullName: string) {
  return stripDiacritics(normalizeWhitespace(fullName)).toLowerCase();
}

function slugify(value: string) {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toIsoDate(parts: { year: number; month: number; day: number }) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function parseIsoDateFromLabel(label: string) {
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

function parseDateFromExcelSerial(serial: number) {
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

function parseHeaderValue(value: unknown): ParsedHeader | null {
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
    if (dateIso) {
      return {
        label: dateIso,
        dateIso,
      };
    }

    return null;
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

function parseNumericScore(value: unknown) {
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

function toCellValue(sheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number) {
  const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
  return sheet[cellAddress]?.v ?? null;
}

function toColumnName(columnIndex: number) {
  return XLSX.utils.encode_col(columnIndex);
}

export function parseAttendanceWorkbook(
  source: ArrayBuffer | Uint8Array,
  sourceFileName: string,
): AttendanceWorkbookPayload {
  const workbook = XLSX.read(source, {
    type: source instanceof ArrayBuffer ? "array" : "buffer",
    raw: true,
    cellDates: true,
  });

  const membersByKey = new Map<string, AttendanceWorkbookMember>();
  const events: AttendanceWorkbookEvent[] = [];
  const scores: AttendanceWorkbookScore[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) {
      continue;
    }

    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const eventsByColumnIndex = new Map<number, AttendanceWorkbookEvent>();

    for (let columnIndex = FIRST_EVENT_COLUMN_INDEX; columnIndex <= range.e.c; columnIndex += 1) {
      const header = parseHeaderValue(toCellValue(sheet, 0, columnIndex));
      if (!header) {
        continue;
      }

      const event: AttendanceWorkbookEvent = {
        id: `${slugify(sheetName)}-${toColumnName(columnIndex).toLowerCase()}`,
        sheetName,
        column: toColumnName(columnIndex),
        label: header.label,
        dateIso: header.dateIso,
      };

      events.push(event);
      eventsByColumnIndex.set(columnIndex, event);
    }

    let currentInstrument: string | null = null;

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

      const existingMember = membersByKey.get(memberKey);
      if (!existingMember) {
        const member: AttendanceWorkbookMember = {
          id: `attendance-member-${slugify(fullName)}`,
          lp,
          firstName,
          lastName,
          fullName,
          instrument: currentInstrument,
        };
        membersByKey.set(memberKey, member);
      } else if (!existingMember.instrument && currentInstrument) {
        existingMember.instrument = currentInstrument;
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
  const totalPoints = scores.reduce((sum, entry) => sum + entry.points, 0);
  const instrumentCount = new Set(
    members.map((member) => member.instrument).filter(Boolean),
  ).size;

  return {
    version: 1,
    metadata: {
      generatedAt: new Date().toISOString(),
      sourceFileName,
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
}

export function buildOverridesFromAttendancePayload(payload: AttendanceWorkbookPayload) {
  const byFullName: Record<string, string> = {};

  for (const member of payload.members) {
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
