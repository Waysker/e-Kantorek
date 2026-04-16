import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type IssueSeverity = "warning" | "error";

type SyncIssue = {
  severity: IssueSeverity;
  code: string;
  message: string;
  row_number?: number;
  column_ref?: string;
  details?: Record<string, unknown>;
};

type EventColumn = {
  index: number;
  columnRef: string;
  header: string;
  eventId: string;
  title: string;
  eventDate: string | null;
};

type SheetSource = {
  sheetId: string;
  gid: string;
  sourceRef: string;
  label?: string;
};

type ResolvedSources = {
  sources: SheetSource[];
  mode: "request_sources" | "env_sources_json" | "auto_discovered" | "single_source";
  errorMessage?: string;
};

type ParsedEventDate =
  | {
    status: "ok";
    isoDate: string;
    year: number;
    normalizedFromSwap?: boolean;
  }
  | {
    status: "needs_month";
    year: number;
    day: number;
  }
  | {
    status: "needs_year";
    day: number;
    month: number;
  }
  | {
    status: "invalid";
    reason: "invalid_date_token";
    suggestion?: string;
  }
  | {
    status: "missing";
    reason: "missing_date_token";
  };

type MemberRecord = {
  member_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  instrument: string;
  is_active: boolean;
  source_row_number: number;
  source_updated_at: string;
};

type EventRecord = {
  event_id: string;
  title: string;
  event_date: string;
  source_column: string;
  source_header: string;
  source_sheet_id: string;
  source_gid: string;
  source_updated_at: string;
};

type AttendanceEntryRecord = {
  member_id: string;
  event_id: string;
  attendance_ratio: number;
  source_raw_value: string;
  source_updated_at: string;
};

type SheetMemberRowRecord = {
  member_id: string;
  source_sheet_id: string;
  source_gid: string;
  source_row_number: number;
  source_updated_at: string;
};

type PreflightResult = {
  issues: SyncIssue[];
  events: EventColumn[];
  members: MemberRecord[];
  attendanceEntries: AttendanceEntryRecord[];
  stats: {
    participants: number;
    events: number;
    attendanceCellsFilled: number;
    attendanceCellsEmpty: number;
  };
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
const DEFAULT_SHEET_ID = Deno.env.get("ATTENDANCE_SHEET_ID");
const DEFAULT_SHEET_GID = Deno.env.get("ATTENDANCE_SHEET_GID");
const DEFAULT_SHEET_SOURCES_JSON = Deno.env.get("ATTENDANCE_SHEET_SOURCES_JSON");
const GOOGLE_SHEETS_API_KEY = Deno.env.get("GOOGLE_SHEETS_API_KEY");
const AUTO_DISCOVER_SOURCES = (Deno.env.get("ATTENDANCE_SHEET_AUTO_DISCOVER_SOURCES") ?? "false").toLowerCase() !==
  "false";
const INCLUDE_HIDDEN_DISCOVERED_SHEETS =
  (Deno.env.get("ATTENDANCE_SHEET_DISCOVER_INCLUDE_HIDDEN") ?? "false").toLowerCase() === "true";
const FUNCTION_AUTH_TOKEN = Deno.env.get("SHEET_SYNC_FUNCTION_AUTH_TOKEN");
const DRY_RUN_ONLY = (Deno.env.get("SHEET_SYNC_DRY_RUN_ONLY") ?? "true").toLowerCase() !== "false";
const DEFAULT_DRY_RUN = (Deno.env.get("SHEET_SYNC_DEFAULT_DRY_RUN") ?? "true").toLowerCase() !== "false";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function normalizeWhitespace(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string): string {
  return normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toColumnRef(indexZeroBased: number): string {
  let n = indexZeroBased + 1;
  let label = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function modeNumber(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let bestValue: number | null = null;
  let bestCount = -1;
  for (const [value, count] of counts.entries()) {
    if (count > bestCount) {
      bestCount = count;
      bestValue = value;
    }
  }

  return bestValue;
}

function buildIsoDate(year: number, month: number, day: number): string | null {
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

function inferSeasonYear(baseYear: number, month: number): number {
  return month <= 6 ? baseYear + 1 : baseYear;
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
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

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function parseIsoDateToken(header: string): ParsedEventDate {
  const normalized = normalizeWhitespace(header);
  const match = normalized.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (!match) {
    const yearDayMatch = normalized.match(/(\d{4})[./-](\d{1,2})(?![./-]\d)/);
    if (yearDayMatch) {
      return {
        status: "needs_month",
        year: Number(yearDayMatch[1]),
        day: Number(yearDayMatch[2]),
      };
    }

    const dayMonthMatch = normalized.match(/(^|[^\d])(\d{1,2})[./-](\d{1,2})([^\d]|$)/);
    if (dayMonthMatch) {
      return {
        status: "needs_year",
        day: Number(dayMonthMatch[2]),
        month: Number(dayMonthMatch[3]),
      };
    }

    return { status: "missing", reason: "missing_date_token" };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const isoDate = buildIsoDate(year, month, day);

  if (isoDate) {
    return {
      status: "ok",
      isoDate,
      year,
    };
  }

  const suggestionMonth = day;
  const suggestionDay = month;
  const suggestion = buildIsoDate(year, suggestionMonth, suggestionDay);
  if (suggestion) {
    return {
      status: "ok",
      isoDate: suggestion,
      year,
      normalizedFromSwap: true,
    };
  }

  return {
    status: "invalid",
    reason: "invalid_date_token",
    suggestion: undefined,
  };
}

function parseSheetSource(candidate: unknown): SheetSource | null {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const sheetId = normalizeWhitespace(record.sheetId ?? record.sheet_id ?? "");
  const gid = normalizeWhitespace(record.gid ?? record.sheetGid ?? record.sheet_gid ?? "");
  const label = normalizeWhitespace(record.label ?? record.name ?? "");

  if (!sheetId || !gid || !/^\d+$/.test(gid)) {
    return null;
  }

  return {
    sheetId,
    gid,
    sourceRef: `${sheetId}:${gid}`,
    label: label || undefined,
  };
}

async function discoverSheetSourcesViaApi(sheetId: string, apiKey: string): Promise<SheetSource[]> {
  const metadataUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`);
  metadataUrl.searchParams.set("fields", "sheets(properties(sheetId,title,index,hidden))");
  metadataUrl.searchParams.set("key", apiKey);

  const response = await fetch(metadataUrl.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Google Sheets metadata fetch failed with status ${response.status}.`);
  }

  const payload = await response.json() as {
    sheets?: Array<{
      properties?: {
        sheetId?: number;
        title?: string;
        index?: number;
        hidden?: boolean;
      };
    }>;
  };

  const candidates = payload.sheets ?? [];
  const sources = candidates
    .map((sheet) => {
      const props = sheet.properties ?? {};
      if (typeof props.sheetId !== "number") {
        return null;
      }
      if (!INCLUDE_HIDDEN_DISCOVERED_SHEETS && props.hidden) {
        return null;
      }
      return {
        sheetId,
        gid: String(props.sheetId),
        sourceRef: `${sheetId}:${String(props.sheetId)}`,
        label: normalizeWhitespace(props.title ?? "") || undefined,
        sortIndex: typeof props.index === "number" ? props.index : Number.MAX_SAFE_INTEGER,
      };
    })
    .filter((item): item is SheetSource & { sortIndex: number } => item !== null)
    .sort((a, b) => a.sortIndex - b.sortIndex)
    .map(({ sortIndex: _sortIndex, ...source }) => source);

  return sources;
}

async function discoverSheetSourcesViaHtmlView(sheetId: string): Promise<SheetSource[]> {
  const htmlViewUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`;
  const response = await fetch(htmlViewUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Google Sheets htmlview fetch failed with status ${response.status}.`);
  }

  const html = await response.text();
  const decodeHtml = (value: string): string =>
    value
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  const stripTags = (value: string): string => value.replace(/<[^>]*>/g, " ");

  const labelsByGid = new Map<string, string>();
  const anchorRegex = /<a[^>]+href="[^"]*gid=(\d+)[^"]*"[^>]*>(.*?)<\/a>/gims;
  for (const match of html.matchAll(anchorRegex)) {
    const gid = match[1];
    const label = normalizeWhitespace(decodeHtml(stripTags(match[2] ?? "")));
    if (!gid || !label) {
      continue;
    }
    if (!labelsByGid.has(gid)) {
      labelsByGid.set(gid, label);
    }
  }

  const gidMatches = html.matchAll(/[?&#]gid=(\d+)/g);
  const gidSet = new Set<string>();
  for (const match of gidMatches) {
    if (match[1]) {
      gidSet.add(match[1]);
    }
  }

  const gids = Array.from(gidSet);
  return gids.map((gid) => ({
    sheetId,
    gid,
    sourceRef: `${sheetId}:${gid}`,
    label: labelsByGid.get(gid),
  }));
}

async function discoverSheetSources(sheetId: string): Promise<SheetSource[]> {
  if (GOOGLE_SHEETS_API_KEY) {
    return await discoverSheetSourcesViaApi(sheetId, GOOGLE_SHEETS_API_KEY);
  }
  return await discoverSheetSourcesViaHtmlView(sheetId);
}

async function resolveSheetSources(body: Record<string, unknown>): Promise<ResolvedSources> {
  const deduped = new Map<string, SheetSource>();
  const addSource = (source: SheetSource) => {
    if (!deduped.has(source.sourceRef)) {
      deduped.set(source.sourceRef, source);
    }
  };

  if (Array.isArray(body.sources)) {
    for (const sourceCandidate of body.sources) {
      const source = parseSheetSource(sourceCandidate);
      if (source) {
        addSource(source);
      }
    }
    if (deduped.size === 0) {
      return {
        sources: [],
        mode: "request_sources",
        errorMessage: "Request body contains `sources`, but none had both sheetId and gid.",
      };
    }
    return { sources: Array.from(deduped.values()), mode: "request_sources" };
  }

  if (DEFAULT_SHEET_SOURCES_JSON) {
    let parsedSources: unknown;
    try {
      parsedSources = JSON.parse(DEFAULT_SHEET_SOURCES_JSON);
    } catch {
      return {
        sources: [],
        mode: "env_sources_json",
        errorMessage: "ATTENDANCE_SHEET_SOURCES_JSON is not valid JSON.",
      };
    }

    if (!Array.isArray(parsedSources)) {
      return {
        sources: [],
        mode: "env_sources_json",
        errorMessage: "ATTENDANCE_SHEET_SOURCES_JSON must be a JSON array.",
      };
    }

    for (const sourceCandidate of parsedSources) {
      const source = parseSheetSource(sourceCandidate);
      if (source) {
        addSource(source);
      }
    }

    if (deduped.size === 0) {
      return {
        sources: [],
        mode: "env_sources_json",
        errorMessage: "ATTENDANCE_SHEET_SOURCES_JSON does not contain valid sources.",
      };
    }
    return { sources: Array.from(deduped.values()), mode: "env_sources_json" };
  }

  const fallbackSheetId = normalizeWhitespace(body.sheetId ?? DEFAULT_SHEET_ID ?? "");
  const fallbackGid = normalizeWhitespace(body.gid ?? DEFAULT_SHEET_GID ?? "");
  const bodyDiscoverSources = typeof body.discoverSources === "boolean" ? body.discoverSources : undefined;
  const shouldAutoDiscover = bodyDiscoverSources ?? AUTO_DISCOVER_SOURCES;

  if (!fallbackSheetId) {
    return {
      sources: [],
      mode: "single_source",
      errorMessage:
        "Provide `sources` or sheetId in request body, or ATTENDANCE_SHEET_ID env.",
    };
  }

  if (shouldAutoDiscover) {
    try {
      const discoveredSources = await discoverSheetSources(fallbackSheetId);
      if (discoveredSources.length === 0) {
        return {
          sources: [],
          mode: "auto_discovered",
          errorMessage: `No sheets discovered for ${fallbackSheetId}.`,
        };
      }
      return {
        sources: discoveredSources,
        mode: "auto_discovered",
      };
    } catch (error) {
      return {
        sources: [],
        mode: "auto_discovered",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (!fallbackGid || !/^\d+$/.test(fallbackGid)) {
    return {
      sources: [],
      mode: "single_source",
      errorMessage:
        "Provide numeric gid in request body/env when auto-discovery is disabled.",
    };
  }

  return {
    sources: [{
      sheetId: fallbackSheetId,
      gid: fallbackGid,
      sourceRef: `${fallbackSheetId}:${fallbackGid}`,
    }],
    mode: "single_source",
  };
}

function parseAttendanceRatio(rawValue: string): { ratio: number | null; error?: string } {
  const trimmed = normalizeWhitespace(rawValue);
  if (!trimmed) {
    return { ratio: null };
  }

  const normalized = trimmed.replace(/\s+/g, "").replace(",", ".");
  const asPercent = normalized.endsWith("%");
  const number = Number(asPercent ? normalized.slice(0, -1) : normalized);

  if (!Number.isFinite(number)) {
    return { ratio: null, error: "not_a_number" };
  }

  let ratio = asPercent ? number / 100 : number;
  if (!asPercent && number > 1 && number <= 100) {
    ratio = number / 100;
  }

  if (ratio < 0 || ratio > 1) {
    return { ratio: null, error: "out_of_range" };
  }

  return { ratio: Math.round(ratio * 10000) / 10000 };
}

function eventTitleFromHeader(header: string): string {
  const normalized = normalizeWhitespace(header)
    .replace(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/g, "")
    .replace(/(\d{4})[./-](\d{1,2})(?![./-]\d)/g, "")
    .replace(/(^|[^\d])(\d{1,2})[./-](\d{1,2})([^\d]|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || normalizeWhitespace(header);
}

function looksLikeAttendanceLayout(rows: string[][]): boolean {
  const header = rows[0] ?? [];
  const lastNameHeader = normalizeWhitespace(header[2] ?? "").toLowerCase();
  const firstNameHeader = normalizeWhitespace(header[3] ?? "").toLowerCase();
  return lastNameHeader.includes("nazw") && firstNameHeader.includes("imi");
}

function extractExplicitYearsFromRows(rows: string[][]): number[] {
  const header = rows[0] ?? [];
  const years: number[] = [];

  for (let col = 4; col < header.length; col += 1) {
    const rawHeader = normalizeWhitespace(header[col] ?? "");
    if (!rawHeader) {
      continue;
    }
    const parsed = parseIsoDateToken(rawHeader);
    if (parsed.status === "ok") {
      years.push(parsed.year);
    }
  }

  return years;
}

function parseMonthHintFromLabel(label: string | undefined): number | null {
  const normalized = normalizeWhitespace(label ?? "").toLowerCase();
  if (!normalized) {
    return null;
  }

  const numericMatch = normalized.match(/(^|[^\d])(1[0-2]|0?[1-9])([^\d]|$)/);
  if (numericMatch) {
    return Number(numericMatch[2]);
  }

  const monthByKeyword: Array<{ month: number; keywords: string[] }> = [
    { month: 1, keywords: ["styczen", "stycznia", "jan", "january"] },
    { month: 2, keywords: ["luty", "lutego", "feb", "february"] },
    { month: 3, keywords: ["marzec", "marca", "mar", "march"] },
    { month: 4, keywords: ["kwiecien", "kwietnia", "apr", "april"] },
    { month: 5, keywords: ["maj", "maja", "may"] },
    { month: 6, keywords: ["czerwiec", "czerwca", "jun", "june"] },
    { month: 7, keywords: ["lipiec", "lipca", "jul", "july"] },
    { month: 8, keywords: ["sierpien", "sierpnia", "aug", "august"] },
    { month: 9, keywords: ["wrzesien", "wrzesnia", "sep", "september"] },
    { month: 10, keywords: ["pazdziernik", "pazdziernika", "oct", "october"] },
    { month: 11, keywords: ["listopad", "listopada", "nov", "november"] },
    { month: 12, keywords: ["grudzien", "grudnia", "dec", "december"] },
  ];

  for (const monthEntry of monthByKeyword) {
    for (const keyword of monthEntry.keywords) {
      if (normalized.includes(keyword)) {
        return monthEntry.month;
      }
    }
  }

  return null;
}

function buildPreflight(
  rows: string[][],
  options?: {
    globalDominantYear?: number | null;
    sourceMonthHint?: number | null;
  },
): PreflightResult {
  const issues: SyncIssue[] = [];
  const header = rows[0] ?? [];

  const expectedPrefix = ["", "L.p.", "Nazwisko", "Imię"];
  for (let i = 0; i < expectedPrefix.length; i += 1) {
    const expected = expectedPrefix[i];
    if (!expected) {
      continue;
    }
    const actual = normalizeWhitespace(header[i] ?? "");
    if (actual !== expected) {
      issues.push({
        severity: "warning",
        code: "unexpected_header_prefix",
        message: `Expected ${toColumnRef(i)} header "${expected}" but got "${actual}".`,
        column_ref: toColumnRef(i),
      });
    }
  }

  const rawEventColumns: Array<{
    index: number;
    columnRef: string;
    header: string;
    parsed: ParsedEventDate;
  }> = [];
  for (let col = 4; col < header.length; col += 1) {
    const rawHeader = normalizeWhitespace(header[col] ?? "");
    if (!rawHeader) {
      continue;
    }
    rawEventColumns.push({
      index: col,
      columnRef: toColumnRef(col),
      header: rawHeader,
      parsed: parseIsoDateToken(rawHeader),
    });
  }

  const dominantYear = modeNumber(
    rawEventColumns
      .filter((item) => item.parsed.status === "ok")
      .map((item) => (item.parsed as Extract<ParsedEventDate, { status: "ok" }>).year),
  );
  const dominantMonth = modeNumber(
    rawEventColumns
      .filter((item) => item.parsed.status === "ok")
      .map((item) => Number((item.parsed as Extract<ParsedEventDate, { status: "ok" }>).isoDate.slice(5, 7))),
  );

  const events: EventColumn[] = [];
  const usedEventIds = new Set<string>();

  for (const rawColumn of rawEventColumns) {
    let eventDate: string | null = null;

    if (rawColumn.parsed.status === "ok") {
      eventDate = rawColumn.parsed.isoDate;
      if (rawColumn.parsed.normalizedFromSwap) {
        issues.push({
          severity: "warning",
          code: "event_date_token_swapped_day_month",
          message: `Normalized date token in ${rawColumn.columnRef} (${rawColumn.header}) from YYYY-DD-MM to YYYY-MM-DD.`,
          column_ref: rawColumn.columnRef,
          details: { normalized_iso_date: eventDate },
        });
      }
    } else if (rawColumn.parsed.status === "needs_month") {
      const inferredMonth = options?.sourceMonthHint ?? dominantMonth;
      if (inferredMonth == null) {
        if (rawColumn.parsed.day >= 1 && rawColumn.parsed.day <= 12) {
          const interpretedDate = buildIsoDate(rawColumn.parsed.year, rawColumn.parsed.day, 1);
          if (interpretedDate) {
            eventDate = interpretedDate;
            issues.push({
              severity: "warning",
              code: "event_month_interpreted_from_yyyy_mm_token",
              message:
                `Interpreted ${rawColumn.columnRef} (${rawColumn.header}) as YYYY-MM token; defaulted day to 01.`,
              column_ref: rawColumn.columnRef,
              details: {
                inferred_month: rawColumn.parsed.day,
                defaulted_day: 1,
                inferred_iso_date: interpretedDate,
              },
            });
          } else {
            issues.push({
              severity: "warning",
              code: "missing_month_hint",
              message:
                `Date token in ${rawColumn.columnRef} (${rawColumn.header}) is YYYY-DD and month could not be inferred from tab/header context.`,
              column_ref: rawColumn.columnRef,
            });
          }
        } else {
          issues.push({
            severity: "warning",
            code: "missing_month_hint",
            message:
              `Date token in ${rawColumn.columnRef} (${rawColumn.header}) is YYYY-DD and month could not be inferred from tab/header context.`,
            column_ref: rawColumn.columnRef,
          });
        }
      } else {
        const inferredDate = buildIsoDate(rawColumn.parsed.year, inferredMonth, rawColumn.parsed.day);
        if (!inferredDate) {
          issues.push({
            severity: "error",
            code: "invalid_date_token",
            message:
              `Invalid YYYY-DD token in ${rawColumn.columnRef} (${rawColumn.header}) after month inference (${inferredMonth}).`,
            column_ref: rawColumn.columnRef,
          });
        } else {
          eventDate = inferredDate;
          issues.push({
            severity: "warning",
            code: "event_month_inferred",
            message:
              `Inferred month ${inferredMonth} for YYYY-DD token in ${rawColumn.columnRef} (${rawColumn.header}).`,
            column_ref: rawColumn.columnRef,
            details: {
              inferred_month: inferredMonth,
              inferred_iso_date: inferredDate,
              source_month_hint: options?.sourceMonthHint ?? null,
              dominant_month: dominantMonth,
            },
          });
        }
      }
    } else if (rawColumn.parsed.status === "needs_year") {
      if (dominantYear == null) {
        if (options?.globalDominantYear != null) {
          const inferredGlobalYear = inferSeasonYear(options.globalDominantYear, rawColumn.parsed.month);
          const inferredDate = buildIsoDate(inferredGlobalYear, rawColumn.parsed.month, rawColumn.parsed.day);
          if (!inferredDate) {
            issues.push({
              severity: "error",
              code: "missing_event_year",
              message:
                `Event date in ${rawColumn.columnRef} has no year and global dominant year produced invalid date (${rawColumn.header}).`,
              column_ref: rawColumn.columnRef,
            });
          } else {
            eventDate = inferredDate;
            issues.push({
              severity: "warning",
              code: "event_year_inferred_global",
              message:
                `Inferred year ${inferredGlobalYear} (global season hint ${options.globalDominantYear}) for date token in ${rawColumn.columnRef} (${rawColumn.header}).`,
              column_ref: rawColumn.columnRef,
              details: {
                global_dominant_year: options.globalDominantYear,
                inferred_year: inferredGlobalYear,
                inferred_iso_date: inferredDate,
              },
            });
          }
        } else {
          issues.push({
            severity: "error",
            code: "missing_event_year",
            message:
              `Event date in ${rawColumn.columnRef} has no year and dominant year cannot be inferred (${rawColumn.header}).`,
            column_ref: rawColumn.columnRef,
          });
        }
      } else {
        const inferredDate = buildIsoDate(dominantYear, rawColumn.parsed.month, rawColumn.parsed.day);
        if (!inferredDate) {
          issues.push({
            severity: "error",
            code: "invalid_date_token",
            message: `Invalid date token in ${rawColumn.columnRef} (${rawColumn.header}).`,
            column_ref: rawColumn.columnRef,
          });
        } else {
          eventDate = inferredDate;
          issues.push({
            severity: "warning",
            code: "event_year_inferred",
            message: `Inferred year ${dominantYear} for date token in ${rawColumn.columnRef} (${rawColumn.header}).`,
            column_ref: rawColumn.columnRef,
            details: { inferred_year: dominantYear, inferred_iso_date: inferredDate },
          });
        }
      }
    } else if (rawColumn.parsed.status === "invalid") {
      issues.push({
        severity: "error",
        code: rawColumn.parsed.reason,
        message: `Invalid date token in ${rawColumn.columnRef} (${rawColumn.header}).`,
        column_ref: rawColumn.columnRef,
        details: rawColumn.parsed.suggestion ? { suggested_iso_date: rawColumn.parsed.suggestion } : {},
      });
    } else {
      issues.push({
        severity: "warning",
        code: rawColumn.parsed.reason,
        message: `Invalid or missing date token in ${rawColumn.columnRef} (${rawColumn.header}).`,
        column_ref: rawColumn.columnRef,
      });
    }

    const title = eventTitleFromHeader(rawColumn.header);
    const baseId = eventDate
      ? `evt-${eventDate}-${slugify(title || rawColumn.columnRef)}`
      : `evt-${rawColumn.columnRef}-${slugify(title || "event")}`;

    let eventId = baseId || `evt-${rawColumn.columnRef}`;
    let suffix = 2;
    while (usedEventIds.has(eventId)) {
      eventId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedEventIds.add(eventId);

    events.push({
      index: rawColumn.index,
      columnRef: rawColumn.columnRef,
      header: rawColumn.header,
      eventId,
      title: title || rawColumn.header,
      eventDate,
    });
  }

  const members: MemberRecord[] = [];
  const attendanceEntries: AttendanceEntryRecord[] = [];
  const usedMemberIds = new Set<string>();

  let participants = 0;
  let attendanceCellsFilled = 0;
  let attendanceCellsEmpty = 0;
  let currentInstrument = "";

  const syncTimestamp = new Date().toISOString();

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const sectionCell = normalizeWhitespace(row[0] ?? "");
    if (sectionCell) {
      currentInstrument = sectionCell;
    }

    const positionRaw = normalizeWhitespace(row[1] ?? "");
    const lastName = normalizeWhitespace(row[2] ?? "");
    const firstName = normalizeWhitespace(row[3] ?? "");

    if (!lastName && !firstName) {
      continue;
    }
    participants += 1;

    if (!lastName || !firstName) {
      issues.push({
        severity: "error",
        code: "incomplete_name",
        message: `Incomplete participant name in row ${rowIndex + 1}.`,
        row_number: rowIndex + 1,
      });
    }

    if (!currentInstrument) {
      issues.push({
        severity: "warning",
        code: "missing_section_context",
        message: `Missing instrument section context in row ${rowIndex + 1}.`,
        row_number: rowIndex + 1,
      });
    }

    const instrument = currentInstrument || "Unknown";
    const memberBaseId = `member-${slugify(`${lastName}-${firstName}-${instrument}`) || `row-${rowIndex + 1}`}`;
    let memberId = memberBaseId;
    if (usedMemberIds.has(memberId)) {
      const fallback = normalizeWhitespace(positionRaw) || String(rowIndex + 1);
      memberId = `${memberBaseId}-${slugify(fallback) || "dup"}`;
      issues.push({
        severity: "warning",
        code: "duplicate_member_identifier",
        message: `Duplicate member identity in row ${rowIndex + 1}; added disambiguation suffix.`,
        row_number: rowIndex + 1,
      });
    }
    usedMemberIds.add(memberId);

    members.push({
      member_id: memberId,
      first_name: firstName || "Unknown",
      last_name: lastName || "Unknown",
      full_name: normalizeWhitespace(`${firstName} ${lastName}`) || "Unknown",
      instrument,
      is_active: true,
      source_row_number: rowIndex + 1,
      source_updated_at: syncTimestamp,
    });

    for (const event of events) {
      const value = row[event.index] ?? "";
      const parsed = parseAttendanceRatio(value);
      if (parsed.ratio == null) {
        if (normalizeWhitespace(value)) {
          issues.push({
            severity: "error",
            code: "invalid_attendance_value",
            message: `Invalid attendance value "${normalizeWhitespace(value)}" at ${event.columnRef}${rowIndex + 1}.`,
            row_number: rowIndex + 1,
            column_ref: event.columnRef,
            details: parsed.error ? { reason: parsed.error } : {},
          });
        } else {
          attendanceCellsEmpty += 1;
        }
        continue;
      }

      attendanceCellsFilled += 1;
      attendanceEntries.push({
        member_id: memberId,
        event_id: event.eventId,
        attendance_ratio: parsed.ratio,
        source_raw_value: normalizeWhitespace(value),
        source_updated_at: syncTimestamp,
      });
    }
  }

  return {
    issues,
    events,
    members,
    attendanceEntries,
    stats: {
      participants,
      events: events.length,
      attendanceCellsFilled,
      attendanceCellsEmpty,
    },
  };
}

async function insertIssues(
  supabaseAdmin: ReturnType<typeof createClient>,
  runId: string,
  issues: SyncIssue[],
): Promise<void> {
  if (issues.length === 0) {
    return;
  }

  const payload = issues.slice(0, 2000).map((issue) => ({
    run_id: runId,
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    row_number: issue.row_number ?? null,
    column_ref: issue.column_ref ?? null,
    details: issue.details ?? {},
  }));

  const { error } = await supabaseAdmin.from("sync_issues").insert(payload);
  if (error) {
    throw new Error(`Failed to insert sync_issues: ${error.message}`);
  }
}

async function upsertInBatches(
  supabaseAdmin: ReturnType<typeof createClient>,
  tableName: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  batchSize = 500,
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  for (let start = 0; start < rows.length; start += batchSize) {
    const chunk = rows.slice(start, start + batchSize);
    const { error } = await supabaseAdmin
      .from(tableName)
      .upsert(chunk, { onConflict, ignoreDuplicates: false });

    if (error) {
      throw new Error(`Upsert failed for ${tableName}: ${error.message}`);
    }
  }
}

function toPostgrestInList(values: string[]): string {
  return `(${values.map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",")})`;
}

async function pruneStaleAttendanceEntries(
  supabaseAdmin: ReturnType<typeof createClient>,
  eventIds: string[],
  attendanceEntries: AttendanceEntryRecord[],
): Promise<number> {
  if (eventIds.length === 0) {
    return 0;
  }

  const memberIdsByEvent = new Map<string, Set<string>>();
  for (const entry of attendanceEntries) {
    if (!memberIdsByEvent.has(entry.event_id)) {
      memberIdsByEvent.set(entry.event_id, new Set<string>());
    }
    memberIdsByEvent.get(entry.event_id)?.add(entry.member_id);
  }

  let prunedCount = 0;
  for (const eventId of eventIds) {
    const memberIds = Array.from(memberIdsByEvent.get(eventId) ?? []);

    if (memberIds.length === 0) {
      const { data, error } = await supabaseAdmin
        .from("attendance_entries")
        .delete()
        .eq("event_id", eventId)
        .select("member_id");
      if (error) {
        throw new Error(`Prune failed for event ${eventId}: ${error.message}`);
      }
      prunedCount += data?.length ?? 0;
      continue;
    }

    const { data, error } = await supabaseAdmin
      .from("attendance_entries")
      .delete()
      .eq("event_id", eventId)
      .not("member_id", "in", toPostgrestInList(memberIds))
      .select("member_id");
    if (error) {
      throw new Error(`Prune failed for event ${eventId}: ${error.message}`);
    }
    prunedCount += data?.length ?? 0;
  }

  return prunedCount;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(
      { error: "missing_supabase_env", message: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required." },
      500,
    );
  }

  if (FUNCTION_AUTH_TOKEN) {
    const authorization = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${FUNCTION_AUTH_TOKEN}`;
    if (authorization !== expected) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const requestedDryRun = typeof body.dryRun === "boolean" ? body.dryRun : undefined;
  const dryRun = DRY_RUN_ONLY ? true : requestedDryRun ?? DEFAULT_DRY_RUN;
  const trigger = normalizeWhitespace(body.trigger ?? "manual") || "manual";

  const { sources, mode: sourceResolutionMode, errorMessage: sourceResolutionError } = await resolveSheetSources(body);
  if (sourceResolutionError) {
    return jsonResponse(
      {
        error: "missing_sheet_source",
        message: sourceResolutionError,
      },
      400,
    );
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const sourceRef = sources.length === 1 ? sources[0].sourceRef : `multi:${sources.length}`;
  const { data: runStart, error: runStartError } = await supabaseAdmin
    .from("sync_runs")
    .insert({
      pipeline_name: "sheet_to_supabase_sync",
      status: "running",
      dry_run: dryRun,
      source_kind: "google_sheet_csv",
      source_ref: sourceRef,
      summary: {
        trigger,
        dry_run_requested: requestedDryRun ?? null,
        dry_run_effective: dryRun,
        source_resolution_mode: sourceResolutionMode,
        sources_count: sources.length,
        sources: sources.map((source) => ({
          source_ref: source.sourceRef,
          sheet_id: source.sheetId,
          gid: source.gid,
          label: source.label ?? null,
        })),
      },
    })
    .select("id")
    .single();

  if (runStartError || !runStart?.id) {
    return jsonResponse(
      {
        error: "run_start_failed",
        message: runStartError?.message ?? "Failed to start sync run.",
      },
      500,
    );
  }

  const runId = runStart.id as string;
  const csvUrls = sources.map((source) =>
    `https://docs.google.com/spreadsheets/d/${source.sheetId}/gviz/tq?tqx=out:csv&gid=${source.gid}`
  );

  try {
    const mergedIssues: SyncIssue[] = [];
    const mergedEventsMap = new Map<string, EventColumn>();
    const mergedEventSourceMap = new Map<string, { sheetId: string; gid: string }>();
    const mergedMembersMap = new Map<string, MemberRecord>();
    const mergedSheetMemberRowsMap = new Map<string, SheetMemberRowRecord>();
    const mergedAttendanceMap = new Map<string, AttendanceEntryRecord>();
    const fetchedSourceRows: Array<{ source: SheetSource; csvUrl: string; rows: string[][] }> = [];
    const explicitYearsAcrossSources: number[] = [];
    let totalAttendanceCellsEmpty = 0;
    let processedAttendanceSources = 0;
    let skippedNonAttendanceSources = 0;

    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      const csvUrl = csvUrls[index];
      const response = await fetch(csvUrl, {
        headers: {
          Accept: "text/csv,text/plain,*/*",
        },
      });

      if (!response.ok) {
        throw new Error(`[${source.sourceRef}] Sheet fetch failed with status ${response.status}`);
      }

      const csvText = await response.text();
      const rows = parseCsv(csvText);
      if (rows.length === 0) {
        throw new Error(`[${source.sourceRef}] Fetched sheet is empty.`);
      }
      fetchedSourceRows.push({ source, csvUrl, rows });
      explicitYearsAcrossSources.push(...extractExplicitYearsFromRows(rows));
    }

    const globalDominantYear = modeNumber(explicitYearsAcrossSources);

    for (const { source, csvUrl, rows } of fetchedSourceRows) {
      if (!looksLikeAttendanceLayout(rows)) {
        skippedNonAttendanceSources += 1;
        mergedIssues.push({
          severity: "warning",
          code: "source_skipped_non_attendance_layout",
          message: `Skipped source ${source.sourceRef} because header does not look like attendance layout.`,
          details: {
            source_ref: source.sourceRef,
            sheet_id: source.sheetId,
            gid: source.gid,
            label: source.label ?? null,
            csv_url: csvUrl,
          },
        });
        continue;
      }

      processedAttendanceSources += 1;
      const preflight = buildPreflight(rows, {
        globalDominantYear,
        sourceMonthHint: parseMonthHintFromLabel(source.label),
      });
      totalAttendanceCellsEmpty += preflight.stats.attendanceCellsEmpty;

      for (const issue of preflight.issues) {
        mergedIssues.push({
          ...issue,
          details: {
            ...(issue.details ?? {}),
            source_ref: source.sourceRef,
            sheet_id: source.sheetId,
            gid: source.gid,
            csv_url: csvUrl,
          },
        });
      }

      for (const member of preflight.members) {
        mergedMembersMap.set(member.member_id, member);
        mergedSheetMemberRowsMap.set(
          `${member.member_id}::${source.sheetId}::${source.gid}`,
          {
            member_id: member.member_id,
            source_sheet_id: source.sheetId,
            source_gid: source.gid,
            source_row_number: member.source_row_number,
            source_updated_at: member.source_updated_at,
          },
        );
      }

      for (const event of preflight.events) {
        const existing = mergedEventsMap.get(event.eventId);
        if (!existing || (!existing.eventDate && event.eventDate)) {
          mergedEventsMap.set(event.eventId, event);
          mergedEventSourceMap.set(event.eventId, { sheetId: source.sheetId, gid: source.gid });
        } else if (!mergedEventSourceMap.has(event.eventId)) {
          mergedEventSourceMap.set(event.eventId, { sheetId: source.sheetId, gid: source.gid });
        }
      }

      for (const entry of preflight.attendanceEntries) {
        mergedAttendanceMap.set(`${entry.member_id}::${entry.event_id}`, entry);
      }
    }

    const mergedPreflight: PreflightResult = {
      issues: mergedIssues,
      events: Array.from(mergedEventsMap.values()),
      members: Array.from(mergedMembersMap.values()),
      attendanceEntries: Array.from(mergedAttendanceMap.values()),
      stats: {
        participants: mergedMembersMap.size,
        events: mergedEventsMap.size,
        attendanceCellsFilled: mergedAttendanceMap.size,
        attendanceCellsEmpty: totalAttendanceCellsEmpty,
      },
    };

    if (processedAttendanceSources === 0) {
      mergedPreflight.issues.push({
        severity: "error",
        code: "no_attendance_sources_processed",
        message: "No attendance-like sources were processed after discovery/filtering.",
      });
    }

    await insertIssues(supabaseAdmin, runId, mergedPreflight.issues);

    const errorsCount = mergedPreflight.issues.filter((issue) => issue.severity === "error").length;
    const warningsCount = mergedPreflight.issues.filter((issue) => issue.severity === "warning").length;

    let finalStatus: "failed" | "dry_run" | "success" = "dry_run";

    const summary: Record<string, unknown> = {
      trigger,
      source_resolution_mode: sourceResolutionMode,
      sources_count: sources.length,
      attendance_sources_processed: processedAttendanceSources,
      sources_skipped_non_attendance_layout: skippedNonAttendanceSources,
      global_dominant_year: globalDominantYear,
      source_refs: sources.map((source) => source.sourceRef),
      source_labels: sources.map((source) => source.label ?? source.sourceRef),
      dry_run_effective: dryRun,
      participants: mergedPreflight.stats.participants,
      events: mergedPreflight.stats.events,
      attendance_cells_filled: mergedPreflight.stats.attendanceCellsFilled,
      attendance_cells_empty: mergedPreflight.stats.attendanceCellsEmpty,
      errors_count: errorsCount,
      warnings_count: warningsCount,
      members_upsert_candidates: mergedPreflight.members.length,
      events_upsert_candidates: mergedPreflight.events.length,
      attendance_upsert_candidates: mergedPreflight.attendanceEntries.length,
      sheet_member_rows_upsert_candidates: mergedSheetMemberRowsMap.size,
    };
    if (sources.length === 1) {
      summary.csv_url = csvUrls[0];
    } else {
      summary.csv_urls = csvUrls;
    }

    if (errorsCount > 0) {
      finalStatus = "failed";
    } else if (dryRun) {
      finalStatus = "dry_run";
    } else {
      const validEvents = mergedPreflight.events
        .filter((event) => event.eventDate)
        .map((event) => ({
          source: mergedEventSourceMap.get(event.eventId),
          event,
        }))
        .filter((item): item is { source: { sheetId: string; gid: string }; event: EventColumn } => !!item.source)
        .map((item) => ({
          event_id: item.event.eventId,
          title: item.event.title,
          event_date: item.event.eventDate as string,
          source_column: item.event.columnRef,
          source_header: item.event.header,
          source_sheet_id: item.source.sheetId,
          source_gid: item.source.gid,
          source_updated_at: new Date().toISOString(),
        })) as EventRecord[];

      const validEventIds = new Set(validEvents.map((event) => event.event_id));
      const validAttendanceEntries = mergedPreflight.attendanceEntries.filter((entry) =>
        validEventIds.has(entry.event_id)
      );

      await upsertInBatches(
        supabaseAdmin,
        "members",
        mergedPreflight.members as unknown as Record<string, unknown>[],
        "member_id",
      );
      await upsertInBatches(
        supabaseAdmin,
        "events",
        validEvents as unknown as Record<string, unknown>[],
        "event_id",
      );
      await upsertInBatches(
        supabaseAdmin,
        "sheet_member_rows",
        Array.from(mergedSheetMemberRowsMap.values()) as unknown as Record<string, unknown>[],
        "member_id,source_sheet_id,source_gid",
      );
      await upsertInBatches(
        supabaseAdmin,
        "attendance_entries",
        validAttendanceEntries as unknown as Record<string, unknown>[],
        "member_id,event_id",
      );
      const prunedAttendanceEntries = await pruneStaleAttendanceEntries(
        supabaseAdmin,
        validEvents.map((event) => event.event_id),
        validAttendanceEntries,
      );

      await supabaseAdmin.from("change_journal").insert({
        entity_type: "sync_run",
        entity_id: runId,
        action: "sheet_to_supabase_upsert",
        actor: "sheet_to_supabase_sync",
        payload: {
          members_upserted: mergedPreflight.members.length,
          events_upserted: validEvents.length,
          sheet_member_rows_upserted: mergedSheetMemberRowsMap.size,
          attendance_entries_upserted: validAttendanceEntries.length,
          attendance_entries_pruned: prunedAttendanceEntries,
          source_ref: sourceRef,
          source_refs: sources.map((source) => source.sourceRef),
        },
      });

      finalStatus = "success";
      summary.members_upserted = mergedPreflight.members.length;
      summary.events_upserted = validEvents.length;
      summary.sheet_member_rows_upserted = mergedSheetMemberRowsMap.size;
      summary.attendance_entries_upserted = validAttendanceEntries.length;
      summary.attendance_entries_skipped_due_to_invalid_events =
        mergedPreflight.attendanceEntries.length - validAttendanceEntries.length;
      summary.attendance_entries_pruned = prunedAttendanceEntries;
      summary.stale_rows_not_pruned = false;
    }

    const { error: runFinishError } = await supabaseAdmin
      .from("sync_runs")
      .update({
        status: finalStatus,
        finished_at: new Date().toISOString(),
        summary,
        error_message: null,
      })
      .eq("id", runId);

    if (runFinishError) {
      throw new Error(`Failed to finalize run: ${runFinishError.message}`);
    }

    return jsonResponse(
      {
        run_id: runId,
        status: finalStatus,
        dry_run: dryRun,
        summary,
      },
      finalStatus === "failed" ? 422 : 200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await supabaseAdmin
      .from("sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: message,
      })
      .eq("id", runId);

    return jsonResponse(
      {
        run_id: runId,
        status: "failed",
        error: message,
      },
      500,
    );
  }
});
