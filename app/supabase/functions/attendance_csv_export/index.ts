import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type SupabaseAdminClient = SupabaseClient<any, "public", any>;

type EventRow = {
  event_id: string;
  title: string;
  event_date: string;
  source_column: string | null;
  source_header: string | null;
  source_sheet_id: string | null;
  source_gid: string | null;
};

type SheetMemberRow = {
  member_id: string;
  source_sheet_id: string;
  source_gid: string;
  source_row_number: number;
  source_updated_at: string | null;
  updated_at: string | null;
};

type MemberRow = {
  member_id: string;
  first_name: string;
  last_name: string;
  instrument: string;
  source_row_number: number | null;
  is_active: boolean;
};

type AttendanceEntryRow = {
  member_id: string;
  event_id: string;
  attendance_ratio: number;
  source_raw_value: string | null;
};

type CsvExport = {
  source_gid: string;
  month_key: string | null;
  events_count: number;
  member_rows_count: number;
  date_from: string | null;
  date_to: string | null;
  file_name: string;
  csv: string;
};

class HttpError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");

const FUNCTION_AUTH_TOKEN =
  Deno.env.get("ATTENDANCE_CSV_EXPORT_AUTH_TOKEN") ??
  Deno.env.get("DB_TO_SHEET_EXPORT_AUTH_TOKEN") ??
  Deno.env.get("DB_TO_SHEET_EXPORT_TOKEN");

const DEFAULT_SOURCE_SHEET_ID =
  Deno.env.get("ATTENDANCE_SHEET_ID") ??
  Deno.env.get("ATTENDANCE_EXPORT_TARGET_SHEET_ID") ??
  "";

const MAX_SOURCE_GIDS_FILTER = 100;
const MAX_EVENTS = 5000;
const MAX_MEMBER_ROWS = 10000;

function normalizeWhitespace(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBearerToken(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }

  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
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

function parseMonthKey(value: unknown): string | null {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }

  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    throw new HttpError(422, "invalid_month", `Invalid month value: ${normalized}. Expected YYYY-MM.`);
  }

  const month = Number.parseInt(normalized.slice(5, 7), 10);
  if (month < 1 || month > 12) {
    throw new HttpError(422, "invalid_month", `Invalid month value: ${normalized}. Expected YYYY-MM.`);
  }

  return normalized;
}

function parseSourceGidsFilter(body: Record<string, unknown>): string[] {
  const values: string[] = [];
  const single = normalizeWhitespace(body.sourceGid ?? body.source_gid ?? "");
  if (single) {
    values.push(single);
  }

  const rawArray = Array.isArray(body.sourceGids)
    ? body.sourceGids
    : Array.isArray(body.source_gids)
    ? body.source_gids
    : [];

  for (const rawValue of rawArray) {
    const normalized = normalizeWhitespace(rawValue);
    if (normalized) {
      values.push(normalized);
    }
  }

  const deduped = Array.from(new Set(values));
  if (deduped.length > MAX_SOURCE_GIDS_FILTER) {
    throw new HttpError(
      422,
      "too_many_source_gids",
      `Too many sourceGids values (${deduped.length}). Max allowed: ${MAX_SOURCE_GIDS_FILTER}.`,
    );
  }

  return deduped;
}

function columnRefToIndex(columnRef: string): number {
  const cleaned = normalizeWhitespace(columnRef).toUpperCase();
  if (!/^[A-Z]+$/.test(cleaned)) {
    return Number.MAX_SAFE_INTEGER;
  }

  let result = 0;
  for (const character of cleaned) {
    result = result * 26 + (character.charCodeAt(0) - 64);
  }
  return result - 1;
}

function escapeCsvValue(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function toCsvRow(values: string[]): string {
  return values.map((value) => escapeCsvValue(value)).join(",");
}

function formatAttendanceValue(ratio: number, sourceRawValue: string | null): string {
  const raw = normalizeWhitespace(sourceRawValue ?? "");
  if (raw) {
    return raw;
  }

  if (Number.isInteger(ratio)) {
    return String(ratio);
  }

  const normalized = ratio
    .toFixed(4)
    .replace(/0+$/, "")
    .replace(/\.$/, "");

  return normalized.replace(".", ",");
}

function buildTabMonthKey(events: EventRow[]): string | null {
  const counts = new Map<string, number>();

  for (const event of events) {
    const date = normalizeWhitespace(event.event_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      continue;
    }
    const monthKey = date.slice(0, 7);
    counts.set(monthKey, (counts.get(monthKey) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return null;
  }

  return Array.from(counts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })[0][0];
}

function sanitizeFilenamePart(value: string): string {
  const normalized = normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "unknown";
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

async function loadEvents(
  supabaseAdmin: SupabaseAdminClient,
  sourceSheetId: string,
  sourceGids: string[],
): Promise<EventRow[]> {
  let query = supabaseAdmin
    .from("events")
    .select("event_id,title,event_date,source_column,source_header,source_sheet_id,source_gid")
    .eq("source_sheet_id", sourceSheetId)
    .not("source_gid", "is", null)
    .not("source_column", "is", null)
    .limit(MAX_EVENTS);

  if (sourceGids.length > 0) {
    query = query.in("source_gid", sourceGids);
  }

  const { data, error } = await query.returns<EventRow[]>();
  if (error) {
    throw new HttpError(500, "events_load_failed", error.message);
  }

  return data ?? [];
}

async function loadSheetMemberRows(
  supabaseAdmin: SupabaseAdminClient,
  sourceSheetId: string,
  sourceGids: string[],
): Promise<SheetMemberRow[]> {
  let query = supabaseAdmin
    .from("sheet_member_rows")
    .select("member_id,source_sheet_id,source_gid,source_row_number,source_updated_at,updated_at")
    .eq("source_sheet_id", sourceSheetId)
    .order("source_updated_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(MAX_MEMBER_ROWS);

  if (sourceGids.length > 0) {
    query = query.in("source_gid", sourceGids);
  }

  const { data, error } = await query.returns<SheetMemberRow[]>();
  if (error) {
    throw new HttpError(500, "sheet_member_rows_load_failed", error.message);
  }

  return data ?? [];
}

async function loadMembers(
  supabaseAdmin: SupabaseAdminClient,
  memberIds: string[],
  includeInactiveMembers: boolean,
): Promise<MemberRow[]> {
  if (memberIds.length === 0) {
    return [];
  }

  let query = supabaseAdmin
    .from("members")
    .select("member_id,first_name,last_name,instrument,source_row_number,is_active")
    .in("member_id", memberIds);

  if (!includeInactiveMembers) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query.returns<MemberRow[]>();
  if (error) {
    throw new HttpError(500, "members_load_failed", error.message);
  }

  return data ?? [];
}

async function loadAttendanceEntries(
  supabaseAdmin: SupabaseAdminClient,
  eventIds: string[],
  memberIds: string[],
): Promise<AttendanceEntryRow[]> {
  if (eventIds.length === 0 || memberIds.length === 0) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from("attendance_entries")
    .select("member_id,event_id,attendance_ratio,source_raw_value")
    .in("event_id", eventIds)
    .in("member_id", memberIds)
    .returns<AttendanceEntryRow[]>();

  if (error) {
    throw new HttpError(500, "attendance_entries_load_failed", error.message);
  }

  return data ?? [];
}

function sourceHeaderFallback(event: EventRow): string {
  const header = normalizeWhitespace(event.source_header ?? "");
  if (header) {
    return header;
  }

  const dateToken = normalizeWhitespace(event.event_date);
  const title = normalizeWhitespace(event.title);
  return normalizeWhitespace(`${dateToken} ${title}`) || event.event_id;
}

function sortEventsForTab(events: EventRow[]): EventRow[] {
  return [...events].sort((left, right) => {
    const leftColumn = normalizeWhitespace(left.source_column ?? "");
    const rightColumn = normalizeWhitespace(right.source_column ?? "");

    const leftIndex = columnRefToIndex(leftColumn);
    const rightIndex = columnRefToIndex(rightColumn);
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }

    const leftDate = normalizeWhitespace(left.event_date);
    const rightDate = normalizeWhitespace(right.event_date);
    if (leftDate !== rightDate) {
      return leftDate.localeCompare(rightDate);
    }

    return left.event_id.localeCompare(right.event_id);
  });
}

function buildCsvForTab(params: {
  gid: string;
  events: EventRow[];
  rowNumberToMemberId: Map<number, string>;
  membersById: Map<string, MemberRow>;
  attendanceByMemberEvent: Map<string, AttendanceEntryRow>;
}): CsvExport {
  const events = sortEventsForTab(params.events);
  const rowNumbers = Array.from(params.rowNumberToMemberId.keys()).sort((left, right) => left - right);

  const lines: string[] = [];
  const header = ["", "L.p.", "Nazwisko", "Imię", ...events.map(sourceHeaderFallback)];
  lines.push(toCsvRow(header));

  let lpCounter = 1;
  let previousInstrument = "";
  let materializedMemberRows = 0;

  for (const rowNumber of rowNumbers) {
    const memberId = params.rowNumberToMemberId.get(rowNumber);
    if (!memberId) {
      continue;
    }

    const member = params.membersById.get(memberId);
    if (!member) {
      continue;
    }

    materializedMemberRows += 1;

    const instrument = normalizeWhitespace(member.instrument);
    const sectionCell = instrument && instrument !== previousInstrument ? instrument : "";
    previousInstrument = instrument;

    const row: string[] = [
      sectionCell,
      String(lpCounter),
      normalizeWhitespace(member.last_name),
      normalizeWhitespace(member.first_name),
    ];

    for (const event of events) {
      const attendanceKey = `${member.member_id}::${event.event_id}`;
      const attendanceEntry = params.attendanceByMemberEvent.get(attendanceKey);

      if (!attendanceEntry) {
        row.push("");
        continue;
      }

      row.push(formatAttendanceValue(Number(attendanceEntry.attendance_ratio), attendanceEntry.source_raw_value));
    }

    lines.push(toCsvRow(row));
    lpCounter += 1;
  }

  const sortedDates = events
    .map((event) => normalizeWhitespace(event.event_date))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort((left, right) => left.localeCompare(right));

  const monthKey = buildTabMonthKey(events);
  const safeMonthPart = monthKey ? sanitizeFilenamePart(monthKey) : "unknown-month";
  const safeGidPart = sanitizeFilenamePart(params.gid);

  return {
    source_gid: params.gid,
    month_key: monthKey,
    events_count: events.length,
    member_rows_count: materializedMemberRows,
    date_from: sortedDates[0] ?? null,
    date_to: sortedDates[sortedDates.length - 1] ?? null,
    file_name: `attendance-${safeMonthPart}-${safeGidPart}.csv`,
    csv: `${lines.join("\n")}\n`,
  };
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
    const token = parseBearerToken(request.headers.get("authorization"));
    if (token !== FUNCTION_AUTH_TOKEN) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const sourceSheetId = normalizeWhitespace(body.sourceSheetId ?? body.source_sheet_id ?? DEFAULT_SOURCE_SHEET_ID);
  if (!sourceSheetId) {
    return jsonResponse(
      {
        error: "missing_source_sheet_id",
        message: "Provide sourceSheetId (or set ATTENDANCE_SHEET_ID).",
      },
      422,
    );
  }

  try {
    const sourceGidsFilter = parseSourceGidsFilter(body);
    const monthFilter = parseMonthKey(body.month ?? body.month_key ?? "");
    const includeInactiveMembers = parseBoolean(body.includeInactiveMembers ?? body.include_inactive_members, true);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const events = await loadEvents(supabaseAdmin, sourceSheetId, sourceGidsFilter);
    if (events.length === 0) {
      return jsonResponse({
        status: "ok",
        source_sheet_id: sourceSheetId,
        month_filter: monthFilter,
        exports: [],
        message: "No matching events found.",
      });
    }

    const eventsByGid = new Map<string, EventRow[]>();
    for (const event of events) {
      const gid = normalizeWhitespace(event.source_gid ?? "");
      if (!gid) {
        continue;
      }

      const bucket = eventsByGid.get(gid) ?? [];
      bucket.push(event);
      eventsByGid.set(gid, bucket);
    }

    const gidEntries = Array.from(eventsByGid.entries())
      .map(([gid, gidEvents]) => ({ gid, events: gidEvents, monthKey: buildTabMonthKey(gidEvents) }))
      .filter((item) => !monthFilter || item.monthKey === monthFilter)
      .sort((left, right) => {
        const leftMonth = left.monthKey ?? "";
        const rightMonth = right.monthKey ?? "";
        if (leftMonth !== rightMonth) {
          return leftMonth.localeCompare(rightMonth);
        }
        return left.gid.localeCompare(right.gid);
      });

    if (gidEntries.length === 0) {
      return jsonResponse({
        status: "ok",
        source_sheet_id: sourceSheetId,
        month_filter: monthFilter,
        exports: [],
        message: "No matching source tabs for the requested filters.",
      });
    }

    const selectedGids = gidEntries.map((item) => item.gid);
    const sheetMemberRows = await loadSheetMemberRows(supabaseAdmin, sourceSheetId, selectedGids);

    const rowMapsByGid = new Map<string, Map<number, string>>();
    for (const row of sheetMemberRows) {
      const gid = normalizeWhitespace(row.source_gid);
      if (!gid || !Number.isInteger(row.source_row_number) || row.source_row_number <= 0) {
        continue;
      }

      const rowMap = rowMapsByGid.get(gid) ?? new Map<number, string>();
      if (!rowMap.has(row.source_row_number)) {
        rowMap.set(row.source_row_number, row.member_id);
      }
      rowMapsByGid.set(gid, rowMap);
    }

    const memberIds = Array.from(
      new Set(
        Array.from(rowMapsByGid.values())
          .flatMap((rowMap) => Array.from(rowMap.values()))
          .filter((memberId) => normalizeWhitespace(memberId).length > 0),
      ),
    );

    const members = await loadMembers(supabaseAdmin, memberIds, includeInactiveMembers);
    const membersById = new Map(members.map((member) => [member.member_id, member]));

    const eventIds = gidEntries.flatMap((entry) => entry.events.map((event) => event.event_id));
    const attendanceEntries = await loadAttendanceEntries(
      supabaseAdmin,
      eventIds,
      Array.from(membersById.keys()),
    );

    const attendanceByMemberEvent = new Map<string, AttendanceEntryRow>();
    for (const entry of attendanceEntries) {
      attendanceByMemberEvent.set(`${entry.member_id}::${entry.event_id}`, entry);
    }

    const exports: CsvExport[] = [];

    for (const entry of gidEntries) {
      let rowMap = rowMapsByGid.get(entry.gid) ?? new Map<number, string>();

      if (rowMap.size === 0) {
        const fallback = new Map<number, string>();
        const fallbackMembers = Array.from(membersById.values())
          .filter((member) => Number.isInteger(member.source_row_number) && (member.source_row_number ?? 0) > 0)
          .sort((left, right) => {
            const leftRow = left.source_row_number ?? Number.MAX_SAFE_INTEGER;
            const rightRow = right.source_row_number ?? Number.MAX_SAFE_INTEGER;
            return leftRow - rightRow;
          });

        for (const member of fallbackMembers) {
          const rowNumber = member.source_row_number;
          if (typeof rowNumber === "number" && Number.isInteger(rowNumber) && rowNumber > 0 && !fallback.has(rowNumber)) {
            fallback.set(rowNumber, member.member_id);
          }
        }

        rowMap = fallback;
      }

      exports.push(
        buildCsvForTab({
          gid: entry.gid,
          events: entry.events,
          rowNumberToMemberId: rowMap,
          membersById,
          attendanceByMemberEvent,
        }),
      );
    }

    return jsonResponse({
      status: "ok",
      source_sheet_id: sourceSheetId,
      month_filter: monthFilter,
      include_inactive_members: includeInactiveMembers,
      exports_count: exports.length,
      exports,
    });
  } catch (error) {
    const knownError = error instanceof HttpError
      ? error
      : new HttpError(
        500,
        "unexpected_error",
        error instanceof Error ? error.message : "Unknown error",
      );

    return jsonResponse(
      {
        error: knownError.code,
        message: knownError.message,
        details: knownError.details ?? null,
      },
      knownError.status,
    );
  }
});
