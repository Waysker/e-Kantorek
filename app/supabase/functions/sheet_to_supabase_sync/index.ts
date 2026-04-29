import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type SupabaseAdminClient = SupabaseClient<any, "public", any>;

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
    normalizedFromSwapReason?: "invalid_month_day" | "ambiguous_day_month_preference";
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

type EventDateOverride = {
  sourceRef: string;
  columnRef: string;
  eventDate: string;
  title?: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
const DEFAULT_SHEET_ID = Deno.env.get("ATTENDANCE_SHEET_ID");
const DEFAULT_SHEET_GID = Deno.env.get("ATTENDANCE_SHEET_GID");
const DEFAULT_SHEET_SOURCES_JSON = Deno.env.get("ATTENDANCE_SHEET_SOURCES_JSON");
const EVENT_DATE_OVERRIDES_BY_SOURCE = parseEventDateOverrides(
  Deno.env.get("ATTENDANCE_EVENT_DATE_OVERRIDES_JSON"),
);
const GOOGLE_SHEETS_API_KEY = Deno.env.get("GOOGLE_SHEETS_API_KEY");
const AUTO_DISCOVER_SOURCES = (Deno.env.get("ATTENDANCE_SHEET_AUTO_DISCOVER_SOURCES") ?? "false").toLowerCase() !==
  "false";
const INCLUDE_HIDDEN_DISCOVERED_SHEETS =
  (Deno.env.get("ATTENDANCE_SHEET_DISCOVER_INCLUDE_HIDDEN") ?? "false").toLowerCase() === "true";
const FUNCTION_AUTH_TOKEN = Deno.env.get("SHEET_SYNC_FUNCTION_AUTH_TOKEN");
const DRY_RUN_ONLY = (Deno.env.get("SHEET_SYNC_DRY_RUN_ONLY") ?? "true").toLowerCase() !== "false";
const DEFAULT_DRY_RUN = (Deno.env.get("SHEET_SYNC_DEFAULT_DRY_RUN") ?? "true").toLowerCase() !== "false";
const CANONICAL_INSTRUMENT_LABEL_BY_KEY: Record<string, string> = {
  flet: "Flety",
  flety: "Flety",
  oboj: "Oboje",
  oboje: "Oboje",
  klarnet: "Klarnety",
  klarnety: "Klarnety",
  fagot: "Fagoty",
  fagoty: "Fagoty",
  saksofon: "Saksofony",
  saksofony: "Saksofony",
  waltornia: "Waltornie",
  waltornie: "Waltornie",
  trabka: "Trąbki",
  trabki: "Trąbki",
  puzon: "Puzony",
  puzony: "Puzony",
  tuba: "Tuby",
  tuby: "Tuby",
  eufonia: "Eufonia",
  eufonie: "Eufonia",
  perkusja: "Perkusja",
  gitara: "Gitary",
  gitary: "Gitary",
  bas: "Gitary",
  basy: "Gitary",
};

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

function parseNonNegativeIntegerInput(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (!/^\d+$/.test(trimmed)) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function normalizeInstrumentKey(value: unknown): string {
  return normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function canonicalizeInstrumentLabel(
  value: unknown,
  fallbackLabel = "Unknown",
): string {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return fallbackLabel;
  }

  return CANONICAL_INSTRUMENT_LABEL_BY_KEY[normalizeInstrumentKey(normalized)] ?? normalized;
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

function parseIsoDateLiteral(value: unknown): string | null {
  const normalized = normalizeWhitespace(value);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return buildIsoDate(year, month, day);
}

function parseEventDateOverrides(raw: unknown): Map<string, Map<string, EventDateOverride>> {
  const result = new Map<string, Map<string, EventDateOverride>>();
  if (!raw) {
    return result;
  }

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return result;
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return result;
    }
  }

  if (!Array.isArray(parsed)) {
    return result;
  }

  for (const candidate of parsed) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const record = candidate as Record<string, unknown>;

    let sourceRef = normalizeWhitespace(record.sourceRef ?? record.source_ref ?? "");
    if (!sourceRef) {
      const sheetId = normalizeWhitespace(record.sheetId ?? record.sheet_id ?? "");
      const gid = normalizeWhitespace(record.gid ?? record.sheetGid ?? record.sheet_gid ?? "");
      if (sheetId && /^\d+$/.test(gid)) {
        sourceRef = `${sheetId}:${gid}`;
      }
    }
    if (!sourceRef || !sourceRef.includes(":")) {
      continue;
    }

    const columnRef = normalizeWhitespace(record.columnRef ?? record.column_ref ?? "").toUpperCase();
    if (!/^[A-Z]+$/.test(columnRef)) {
      continue;
    }

    const eventDate = parseIsoDateLiteral(record.eventDate ?? record.event_date ?? "");
    if (!eventDate) {
      continue;
    }

    const title = normalizeWhitespace(record.title ?? "");
    const override: EventDateOverride = {
      sourceRef,
      columnRef,
      eventDate,
      title: title || undefined,
    };

    const byColumn = result.get(sourceRef) ?? new Map<string, EventDateOverride>();
    byColumn.set(columnRef, override);
    result.set(sourceRef, byColumn);
  }

  return result;
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
  return parseIsoDateTokenWithOptions(header, { preferSwapForAmbiguous: false });
}

function parseIsoDateTokenWithOptions(
  header: string,
  options: { preferSwapForAmbiguous: boolean },
): ParsedEventDate {
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
  const directDate = buildIsoDate(year, month, day);
  const swappedDate = buildIsoDate(year, day, month);

  if (directDate && swappedDate) {
    if (options.preferSwapForAmbiguous) {
      return {
        status: "ok",
        isoDate: swappedDate,
        year,
        normalizedFromSwap: true,
        normalizedFromSwapReason: "ambiguous_day_month_preference",
      };
    }
    return {
      status: "ok",
      isoDate: directDate,
      year,
    };
  }

  if (directDate) {
    return {
      status: "ok",
      isoDate: directDate,
      year,
    };
  }

  if (swappedDate) {
    return {
      status: "ok",
      isoDate: swappedDate,
      year,
      normalizedFromSwap: true,
      normalizedFromSwapReason: "invalid_month_day",
    };
  }

  return {
    status: "invalid",
    reason: "invalid_date_token",
    suggestion: undefined,
  };
}

function detectPreferSwapForAmbiguousDateTokens(headers: string[]): {
  preferSwapForAmbiguous: boolean;
  swapOnlyCount: number;
  directOnlyCount: number;
} {
  let swapOnlyCount = 0;
  let directOnlyCount = 0;

  for (const header of headers) {
    const normalized = normalizeWhitespace(header);
    if (!normalized) {
      continue;
    }
    const match = normalized.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
    if (!match) {
      continue;
    }

    const year = Number(match[1]);
    const first = Number(match[2]);
    const second = Number(match[3]);
    const directDate = buildIsoDate(year, first, second);
    const swappedDate = buildIsoDate(year, second, first);

    if (!directDate && swappedDate) {
      swapOnlyCount += 1;
    } else if (directDate && !swappedDate) {
      directOnlyCount += 1;
    }
  }

  return {
    preferSwapForAmbiguous: swapOnlyCount > 0 && directOnlyCount === 0,
    swapOnlyCount,
    directOnlyCount,
  };
}

function dayFromIsoDate(isoDate: string): number {
  return Number(isoDate.slice(8, 10));
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
  const sortableSources: Array<SheetSource & { sortIndex: number }> = [];
  for (const sheet of candidates) {
    const props = sheet.properties ?? {};
    if (typeof props.sheetId !== "number") {
      continue;
    }
    if (!INCLUDE_HIDDEN_DISCOVERED_SHEETS && props.hidden) {
      continue;
    }
    sortableSources.push({
      sheetId,
      gid: String(props.sheetId),
      sourceRef: `${sheetId}:${String(props.sheetId)}`,
      label: normalizeWhitespace(props.title ?? "") || undefined,
      sortIndex: typeof props.index === "number" ? props.index : Number.MAX_SAFE_INTEGER,
    });
  }

  const sources = sortableSources
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
    eventDateOverridesByColumn?: Map<string, EventDateOverride>;
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

  const rawEventColumnCandidates: Array<{
    index: number;
    columnRef: string;
    header: string;
  }> = [];
  for (let col = 4; col < header.length; col += 1) {
    const rawHeader = normalizeWhitespace(header[col] ?? "");
    if (!rawHeader) {
      continue;
    }
    rawEventColumnCandidates.push({
      index: col,
      columnRef: toColumnRef(col),
      header: rawHeader,
    });
  }

  const dateStylePreference = detectPreferSwapForAmbiguousDateTokens(
    rawEventColumnCandidates.map((candidate) => candidate.header),
  );

  if (dateStylePreference.preferSwapForAmbiguous) {
    issues.push({
      severity: "warning",
      code: "event_date_style_inferred_day_month",
      message:
        "Interpreted ambiguous YYYY-MM-DD tokens as YYYY-DD-MM based on non-ambiguous columns in this sheet.",
      details: {
        swap_only_count: dateStylePreference.swapOnlyCount,
        direct_only_count: dateStylePreference.directOnlyCount,
      },
    });
  }

  const rawEventColumns: Array<{
    index: number;
    columnRef: string;
    header: string;
    parsed: ParsedEventDate;
  }> = rawEventColumnCandidates.map((candidate) => ({
    ...candidate,
    parsed: parseIsoDateTokenWithOptions(candidate.header, {
      preferSwapForAmbiguous: dateStylePreference.preferSwapForAmbiguous,
    }),
  }));

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
  const missingDateEventIndexes: number[] = [];
  const missingDateEventContextByIndex = new Map<number, { columnRef: string; header: string }>();

  for (const rawColumn of rawEventColumns) {
    let eventDate: string | null = null;
    const columnOverride = options?.eventDateOverridesByColumn?.get(rawColumn.columnRef);

    if (columnOverride) {
      eventDate = columnOverride.eventDate;
    } else if (rawColumn.parsed.status === "ok") {
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
      const eventIndex = events.length;
      missingDateEventIndexes.push(eventIndex);
      missingDateEventContextByIndex.set(eventIndex, {
        columnRef: rawColumn.columnRef,
        header: rawColumn.header,
      });
    }

    const title = normalizeWhitespace(columnOverride?.title ?? "") || eventTitleFromHeader(rawColumn.header);
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

  for (const missingIndex of missingDateEventIndexes) {
    const target = events[missingIndex];
    if (!target || target.eventDate) {
      continue;
    }

    const left = events[missingIndex - 1];
    const right = events[missingIndex + 1];
    if (!left?.eventDate || !right?.eventDate) {
      continue;
    }

    const leftMonthKey = left.eventDate.slice(0, 7);
    const rightMonthKey = right.eventDate.slice(0, 7);
    if (leftMonthKey !== rightMonthKey) {
      continue;
    }

    const dayGap = Math.abs(dayFromIsoDate(right.eventDate) - dayFromIsoDate(left.eventDate));
    if (dayGap > 3) {
      continue;
    }

    target.eventDate = left.eventDate;
    issues.push({
      severity: "warning",
      code: "event_date_inferred_from_neighbors",
      message:
        `Inferred missing date token in ${target.columnRef} (${target.header}) from neighboring columns ${left.columnRef}/${right.columnRef}.`,
      column_ref: target.columnRef,
      details: {
        inferred_iso_date: target.eventDate,
        left_neighbor_column: left.columnRef,
        left_neighbor_iso_date: left.eventDate,
        right_neighbor_column: right.columnRef,
        right_neighbor_iso_date: right.eventDate,
      },
    });
  }

  for (const missingIndex of missingDateEventIndexes) {
    const target = events[missingIndex];
    if (!target || target.eventDate) {
      continue;
    }
    const context = missingDateEventContextByIndex.get(missingIndex) ?? {
      columnRef: target.columnRef,
      header: target.header,
    };
    issues.push({
      severity: "warning",
      code: "missing_date_token",
      message: `Invalid or missing date token in ${context.columnRef} (${context.header}).`,
      column_ref: context.columnRef,
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
      currentInstrument = canonicalizeInstrumentLabel(sectionCell, "Unknown");
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

    const instrument = canonicalizeInstrumentLabel(currentInstrument, "Unknown");
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
  supabaseAdmin: SupabaseAdminClient,
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
  supabaseAdmin: SupabaseAdminClient,
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
  supabaseAdmin: SupabaseAdminClient,
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

  const sourceOffsetWasProvided = body.sourceOffset !== undefined;
  const sourceLimitWasProvided = body.sourceLimit !== undefined;
  const sourceOffset = sourceOffsetWasProvided ? parseNonNegativeIntegerInput(body.sourceOffset) : 0;
  const sourceLimit = sourceLimitWasProvided ? parseNonNegativeIntegerInput(body.sourceLimit) : null;

  if (sourceOffset === null) {
    return jsonResponse(
      {
        error: "invalid_source_offset",
        message: "`sourceOffset` must be a non-negative integer.",
      },
      400,
    );
  }

  if (sourceLimitWasProvided && (sourceLimit === null || sourceLimit <= 0)) {
    return jsonResponse(
      {
        error: "invalid_source_limit",
        message: "`sourceLimit` must be a positive integer.",
      },
      400,
    );
  }

  const effectiveSources = sourceLimit === null
    ? sources.slice(sourceOffset)
    : sources.slice(sourceOffset, sourceOffset + sourceLimit);
  if (effectiveSources.length === 0) {
    return jsonResponse(
      {
        error: "missing_sheet_source",
        message: "No sources left after applying sourceOffset/sourceLimit.",
      },
      400,
    );
  }
  const sourceSliceApplied = sourceOffset > 0 || sourceLimit !== null;

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const sourceRef = effectiveSources.length === 1 ? effectiveSources[0].sourceRef : `multi:${effectiveSources.length}`;
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
        sources_count: effectiveSources.length,
        sources_total_count: sources.length,
        source_slice_applied: sourceSliceApplied,
        source_slice_offset: sourceOffset,
        source_slice_limit: sourceLimit,
        sources: effectiveSources.map((source) => ({
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
  const csvUrls = effectiveSources.map((source) =>
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

    for (let index = 0; index < effectiveSources.length; index += 1) {
      const source = effectiveSources[index];
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
        eventDateOverridesByColumn: EVENT_DATE_OVERRIDES_BY_SOURCE.get(source.sourceRef),
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
      sources_count: effectiveSources.length,
      sources_total_count: sources.length,
      source_slice_applied: sourceSliceApplied,
      source_slice_offset: sourceOffset,
      source_slice_limit: sourceLimit,
      attendance_sources_processed: processedAttendanceSources,
      sources_skipped_non_attendance_layout: skippedNonAttendanceSources,
      global_dominant_year: globalDominantYear,
      source_refs: effectiveSources.map((source) => source.sourceRef),
      source_labels: effectiveSources.map((source) => source.label ?? source.sourceRef),
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
      attendance_entries_skipped_due_to_invalid_events: 0,
    };
    if (effectiveSources.length === 1) {
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
          source_refs: effectiveSources.map((source) => source.sourceRef),
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
