import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type SupabaseAdminClient = SupabaseClient<any, "public", any>;

type EventRow = {
  event_id: string;
  title: string;
  event_date: string;
  source_header: string | null;
  source_sheet_id: string | null;
  source_gid: string | null;
};

type AttendanceEntryRow = {
  member_id: string;
  event_id: string;
  attendance_ratio: number;
};

type MemberRow = {
  member_id: string;
  source_row_number: number | null;
  is_active: boolean;
};

type SheetMemberRow = {
  member_id: string;
  source_sheet_id: string;
  source_gid: string;
  source_row_number: number;
  source_updated_at: string | null;
  updated_at: string | null;
};

type FallbackRowMaps = {
  bySourceRef: Map<string, Map<string, number>>;
  byMemberId: Map<string, number>;
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
  Deno.env.get("DB_TO_SHEET_EXPORT_AUTH_TOKEN") ??
  Deno.env.get("DB_TO_SHEET_EXPORT_TOKEN") ??
  Deno.env.get("SUPABASE_TO_SHEET_EXPORT_AUTH_TOKEN");
const APPS_SCRIPT_WEBHOOK_URL =
  Deno.env.get("ATTENDANCE_APPS_SCRIPT_WEBHOOK_URL") ??
  Deno.env.get("APPS_SCRIPT_WEBHOOK_URL");
const APPS_SCRIPT_WEBHOOK_TOKEN =
  Deno.env.get("ATTENDANCE_APPS_SCRIPT_WEBHOOK_TOKEN") ??
  Deno.env.get("APPS_SCRIPT_WEBHOOK_TOKEN");
const TARGET_ATTENDANCE_SHEET_ID =
  Deno.env.get("ATTENDANCE_EXPORT_TARGET_SHEET_ID") ??
  Deno.env.get("ATTENDANCE_SHEET_TARGET_ID");
const DEFAULT_EVENT_LOOKBACK_DAYS = 31;
const MAX_EVENTS_PER_RUN = 60;
const DEFAULT_CELL_WRITE_CONCURRENCY = 6;
const MAX_CELL_WRITE_CONCURRENCY = 20;
const MAX_MEMBER_WINDOW = 2000;

function normalizeWhitespace(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDateOnly(value: unknown): string | null {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }

  const exact = normalized.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (exact) {
    return exact[1];
  }

  const fromIso = normalized.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (fromIso) {
    return fromIso[1];
  }

  return null;
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

function parseIntegerInRange(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(max, Math.max(min, Math.trunc(value)));
  }

  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return fallback;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function parseMemberIdFilter(body: Record<string, unknown>): Set<string> | null {
  const items: unknown[] = [];

  const memberIdSingle = normalizeWhitespace(body.memberId ?? body.member_id ?? "");
  if (memberIdSingle) {
    items.push(memberIdSingle);
  }

  const memberIds = Array.isArray(body.memberIds)
    ? body.memberIds
    : Array.isArray(body.member_ids)
    ? body.member_ids
    : [];
  items.push(...memberIds);

  const normalized = items
    .map((value) => normalizeWhitespace(value))
    .filter((value) => value.length > 0);

  if (normalized.length === 0) {
    return null;
  }

  return new Set(normalized);
}

function toSourceRef(sheetId: string | null | undefined, gid: string | null | undefined): string | null {
  const normalizedSheetId = normalizeWhitespace(sheetId ?? "");
  const normalizedGid = normalizeWhitespace(gid ?? "");
  if (!normalizedSheetId || !normalizedGid) {
    return null;
  }
  return `${normalizedSheetId}:${normalizedGid}`;
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

function columnRefToIndex(columnRef: string): number {
  const cleaned = normalizeWhitespace(columnRef).toUpperCase();
  if (!/^[A-Z]+$/.test(cleaned)) {
    throw new HttpError(422, "invalid_source_column", `Invalid source column reference: ${columnRef}`);
  }

  let result = 0;
  for (const character of cleaned) {
    result = result * 26 + (character.charCodeAt(0) - 64);
  }
  return result - 1;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function extractWebhookErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const obj = payload as Record<string, unknown>;
  const keys = ["error", "message", "details"] as const;
  for (const key of keys) {
    const value = normalizeWhitespace(obj[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

async function callAppsScriptWebhook(payload: Record<string, unknown>): Promise<string> {
  if (!APPS_SCRIPT_WEBHOOK_URL) {
    throw new HttpError(
      422,
      "missing_apps_script_webhook_url",
      "ATTENDANCE_APPS_SCRIPT_WEBHOOK_URL (or APPS_SCRIPT_WEBHOOK_URL) is required.",
    );
  }

  const response = await fetch(APPS_SCRIPT_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...payload,
      webhookToken: APPS_SCRIPT_WEBHOOK_TOKEN ?? null,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(
      502,
      "apps_script_webhook_failed",
      `Apps Script call failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }

  return text;
}

async function ensureAttendanceSheet(params: {
  sheetId: string;
  eventDate: string;
  suggestedGid?: string | null;
}): Promise<{ gid: string; title?: string; created?: boolean }> {
  const eventDate = parseDateOnly(params.eventDate);
  if (!eventDate) {
    throw new HttpError(422, "invalid_event_date", `Invalid event date value: ${params.eventDate}`);
  }

  const responseText = await callAppsScriptWebhook({
    action: "ensure_attendance_sheet",
    sheetId: params.sheetId,
    eventDate,
    suggestedGid: normalizeWhitespace(params.suggestedGid ?? "") || null,
  });

  if (!responseText) {
    throw new HttpError(502, "apps_script_empty_response", "Apps Script ensure_attendance_sheet returned empty response.");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    throw new HttpError(
      502,
      "apps_script_invalid_response",
      `Could not parse Apps Script ensure_attendance_sheet response: ${responseText.slice(0, 500)}`,
    );
  }

  if (parsed.ok !== true) {
    throw new HttpError(
      502,
      "apps_script_failed",
      `Apps Script responded with failure: ${extractWebhookErrorMessage(parsed) ?? "unknown_error"}`,
    );
  }

  const gid = normalizeWhitespace(parsed.gid ?? "");
  if (!gid) {
    throw new HttpError(502, "apps_script_missing_gid", "Apps Script ensure_attendance_sheet did not return gid.");
  }

  return {
    gid,
    title: normalizeWhitespace(parsed.title ?? "") || undefined,
    created: parsed.created === true,
  };
}

async function ensureAttendanceColumn(params: {
  sheetId: string;
  gid: string;
  eventDate: string;
  eventTitle: string;
  sourceHeader: string | null;
}): Promise<{ columnRef: string; header: string | null; created?: boolean }> {
  const eventDate = parseDateOnly(params.eventDate);
  if (!eventDate) {
    throw new HttpError(422, "invalid_event_date", `Invalid event date value: ${params.eventDate}`);
  }

  const responseText = await callAppsScriptWebhook({
    action: "ensure_attendance_column",
    sheetId: params.sheetId,
    gid: params.gid,
    eventDate,
    eventTitle: params.eventTitle,
    sourceHeader: params.sourceHeader,
  });

  if (!responseText) {
    throw new HttpError(502, "apps_script_empty_response", "Apps Script ensure_attendance_column returned empty response.");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    throw new HttpError(
      502,
      "apps_script_invalid_response",
      `Could not parse Apps Script ensure_attendance_column response: ${responseText.slice(0, 500)}`,
    );
  }

  if (parsed.ok !== true) {
    throw new HttpError(
      502,
      "apps_script_failed",
      `Apps Script responded with failure: ${extractWebhookErrorMessage(parsed) ?? "unknown_error"}`,
    );
  }

  const columnRefRaw = normalizeWhitespace(parsed.columnRef ?? parsed.column_ref ?? "");
  if (!columnRefRaw) {
    throw new HttpError(
      502,
      "apps_script_missing_column_ref",
      "Apps Script ensure_attendance_column did not return columnRef.",
    );
  }

  const normalizedColumnRef = toColumnRef(columnRefToIndex(columnRefRaw));
  const header = normalizeWhitespace(parsed.header ?? parsed.source_header ?? "") || null;

  return {
    columnRef: normalizedColumnRef,
    header,
    created: parsed.created === true,
  };
}

async function setAttendanceCell(params: {
  sheetId: string;
  gid: string;
  columnRef: string;
  rowNumber: number;
  attendanceRatio: number;
  eventDate: string;
  eventTitle: string;
  sourceHeader: string | null;
}): Promise<void> {
  const responseText = await callAppsScriptWebhook({
    action: "set_attendance_cell",
    sheetId: params.sheetId,
    gid: params.gid,
    columnRef: params.columnRef,
    rowNumber: params.rowNumber,
    attendanceRatio: params.attendanceRatio,
    eventDate: params.eventDate,
    eventTitle: params.eventTitle,
    sourceHeader: params.sourceHeader,
  });

  if (!responseText) {
    throw new HttpError(502, "apps_script_empty_response", "Apps Script set_attendance_cell returned empty response.");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    throw new HttpError(
      502,
      "apps_script_invalid_response",
      `Could not parse Apps Script set_attendance_cell response: ${responseText.slice(0, 500)}`,
    );
  }

  if (parsed.ok !== true) {
    throw new HttpError(
      502,
      "apps_script_failed",
      `Apps Script responded with failure: ${extractWebhookErrorMessage(parsed) ?? "unknown_error"}`,
    );
  }
}

type CellWriteTarget = {
  memberId: string;
  rowNumber: number;
  attendanceRatio: number;
};

async function writeAttendanceCellsWithConcurrency(params: {
  writes: CellWriteTarget[];
  concurrency: number;
  sheetId: string;
  gid: string;
  columnRef: string;
  eventDate: string;
  eventTitle: string;
  sourceHeader: string | null;
}): Promise<void> {
  const writes = params.writes;
  if (writes.length === 0) {
    return;
  }

  const concurrency = Math.min(Math.max(1, params.concurrency), MAX_CELL_WRITE_CONCURRENCY);
  for (let offset = 0; offset < writes.length; offset += concurrency) {
    const chunk = writes.slice(offset, offset + concurrency);
    await Promise.all(
      chunk.map((write) =>
        setAttendanceCell({
          sheetId: params.sheetId,
          gid: params.gid,
          columnRef: params.columnRef,
          rowNumber: write.rowNumber,
          attendanceRatio: write.attendanceRatio,
          eventDate: params.eventDate,
          eventTitle: params.eventTitle,
          sourceHeader: params.sourceHeader,
        })
      ),
    );
  }
}

function pickMemberRowNumber(
  memberId: string,
  membersById: Map<string, MemberRow>,
  fallbackRows: FallbackRowMaps,
  sourceSheetId: string | null,
  sourceGid: string | null,
): number | null {
  const direct = membersById.get(memberId)?.source_row_number;
  if (typeof direct === "number" && Number.isInteger(direct) && direct > 0) {
    return direct;
  }

  const sourceRef = toSourceRef(sourceSheetId, sourceGid);
  if (sourceRef) {
    const scopedFallback = fallbackRows.bySourceRef.get(sourceRef)?.get(memberId) ?? null;
    if (typeof scopedFallback === "number" && Number.isInteger(scopedFallback) && scopedFallback > 0) {
      return scopedFallback;
    }
  }

  const globalFallback = fallbackRows.byMemberId.get(memberId) ?? null;
  if (typeof globalFallback === "number" && Number.isInteger(globalFallback) && globalFallback > 0) {
    return globalFallback;
  }

  return null;
}

async function loadEvents(
  supabaseAdmin: SupabaseAdminClient,
  eventIdFilter: string | null,
  eventDateFilter: string | null,
): Promise<EventRow[]> {
  let query = supabaseAdmin
    .from("events")
    .select("event_id,title,event_date,source_header,source_sheet_id,source_gid")
    .order("event_date", { ascending: true })
    .limit(MAX_EVENTS_PER_RUN);

  if (eventIdFilter) {
    query = query.eq("event_id", eventIdFilter);
  } else if (eventDateFilter) {
    query = query.eq("event_date", eventDateFilter);
  } else {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - DEFAULT_EVENT_LOOKBACK_DAYS);
    const dateFrom = startDate.toISOString().slice(0, 10);
    query = query.gte("event_date", dateFrom);
  }

  const { data, error } = await query.returns<EventRow[]>();
  if (error) {
    throw new HttpError(500, "events_load_failed", error.message);
  }

  return data ?? [];
}

async function loadAttendanceEntries(
  supabaseAdmin: SupabaseAdminClient,
  eventIds: string[],
): Promise<AttendanceEntryRow[]> {
  if (eventIds.length === 0) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from("attendance_entries")
    .select("member_id,event_id,attendance_ratio")
    .in("event_id", eventIds)
    .returns<AttendanceEntryRow[]>();

  if (error) {
    throw new HttpError(500, "attendance_entries_load_failed", error.message);
  }

  return data ?? [];
}

async function loadMembers(supabaseAdmin: SupabaseAdminClient): Promise<MemberRow[]> {
  const { data, error } = await supabaseAdmin
    .from("members")
    .select("member_id,source_row_number,is_active")
    .eq("is_active", true)
    .returns<MemberRow[]>();

  if (error) {
    throw new HttpError(500, "members_load_failed", error.message);
  }

  return data ?? [];
}

async function loadFallbackRows(
  supabaseAdmin: SupabaseAdminClient,
  sourceSheetId: string,
): Promise<FallbackRowMaps> {
  const { data, error } = await supabaseAdmin
    .from("sheet_member_rows")
    .select("member_id,source_sheet_id,source_gid,source_row_number,source_updated_at,updated_at")
    .eq("source_sheet_id", sourceSheetId)
    .order("source_updated_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(5000)
    .returns<SheetMemberRow[]>();

  if (error) {
    throw new HttpError(500, "sheet_member_rows_load_failed", error.message);
  }

  const byMemberId = new Map<string, number>();
  const bySourceRef = new Map<string, Map<string, number>>();

  for (const row of data ?? []) {
    const memberId = normalizeWhitespace(row.member_id);
    if (!memberId) {
      continue;
    }

    if (!Number.isInteger(row.source_row_number) || row.source_row_number <= 0) {
      continue;
    }

    const sourceRef = toSourceRef(row.source_sheet_id, row.source_gid);
    if (sourceRef) {
      const scopedMap = bySourceRef.get(sourceRef) ?? new Map<string, number>();
      if (!scopedMap.has(memberId)) {
        scopedMap.set(memberId, row.source_row_number);
      }
      bySourceRef.set(sourceRef, scopedMap);
    }

    if (!byMemberId.has(memberId)) {
      byMemberId.set(memberId, row.source_row_number);
    }
  }

  return {
    bySourceRef,
    byMemberId,
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

  if (!TARGET_ATTENDANCE_SHEET_ID) {
    return jsonResponse(
      {
        error: "missing_target_sheet_id",
        message: "ATTENDANCE_EXPORT_TARGET_SHEET_ID (or ATTENDANCE_SHEET_TARGET_ID) is required.",
      },
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

  const dryRun = parseBoolean(body.dryRun, false);
  const overwriteMissingWithZero = parseBoolean(body.overwriteMissingWithZero, true);
  const eventIdFilter = normalizeWhitespace(body.eventId ?? body.event_id ?? "") || null;
  const hasEventDateInput = body.eventDate !== undefined || body.event_date !== undefined;
  const rawEventDateInput = body.eventDate ?? body.event_date;
  const eventDateFilter = parseDateOnly(rawEventDateInput);
  const memberIdFilter = parseMemberIdFilter(body);
  const memberOffset = parseIntegerInRange(body.memberOffset ?? body.member_offset, 0, 0, 200000);
  const memberLimit = parseIntegerInRange(body.memberLimit ?? body.member_limit, 0, 0, MAX_MEMBER_WINDOW);
  const requestedConcurrency = body.writeConcurrency ??
    body.write_concurrency ??
    Deno.env.get("ATTENDANCE_EXPORT_WRITE_CONCURRENCY") ??
    Deno.env.get("DB_TO_SHEET_EXPORT_WRITE_CONCURRENCY");
  const writeConcurrency = parseIntegerInRange(
    requestedConcurrency,
    DEFAULT_CELL_WRITE_CONCURRENCY,
    1,
    MAX_CELL_WRITE_CONCURRENCY,
  );

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    if (hasEventDateInput && !eventDateFilter) {
      throw new HttpError(
        422,
        "invalid_event_date",
        `Invalid eventDate value: ${normalizeWhitespace(rawEventDateInput) || String(rawEventDateInput ?? "")}`,
      );
    }

    const events = await loadEvents(supabaseAdmin, eventIdFilter, eventDateFilter);
    if (events.length === 0) {
      return jsonResponse({
        status: "ok",
        dry_run: dryRun,
        events_exported: 0,
        cells_written: 0,
        message: "No matching events found.",
      });
    }

    const [members, fallbackRows, attendanceEntries] = await Promise.all([
      loadMembers(supabaseAdmin),
      loadFallbackRows(supabaseAdmin, TARGET_ATTENDANCE_SHEET_ID),
      loadAttendanceEntries(supabaseAdmin, events.map((event) => event.event_id)),
    ]);

    const membersById = new Map(members.map((member) => [member.member_id, member]));
    const filteredMemberIds = members
      .map((member) => member.member_id)
      .filter((memberId) => !memberIdFilter || memberIdFilter.has(memberId))
      .sort((left, right) => {
        const leftRow = membersById.get(left)?.source_row_number;
        const rightRow = membersById.get(right)?.source_row_number;
        const leftHasRow = typeof leftRow === "number" && Number.isInteger(leftRow) && leftRow > 0;
        const rightHasRow = typeof rightRow === "number" && Number.isInteger(rightRow) && rightRow > 0;
        if (leftHasRow && rightHasRow && leftRow !== rightRow) {
          return leftRow - rightRow;
        }
        if (leftHasRow !== rightHasRow) {
          return leftHasRow ? -1 : 1;
        }
        return left.localeCompare(right);
      });

    const pagedMemberIds = overwriteMissingWithZero
      ? (memberLimit > 0
        ? filteredMemberIds.slice(memberOffset, memberOffset + memberLimit)
        : filteredMemberIds.slice(memberOffset))
      : filteredMemberIds;

    const hasMoreMemberPages = overwriteMissingWithZero &&
      (memberOffset + pagedMemberIds.length < filteredMemberIds.length);

    const attendanceByEventId = new Map<string, Map<string, number>>();
    for (const entry of attendanceEntries) {
      const eventBucket = attendanceByEventId.get(entry.event_id) ?? new Map<string, number>();
      eventBucket.set(entry.member_id, Number(entry.attendance_ratio));
      attendanceByEventId.set(entry.event_id, eventBucket);
    }

    let cellsWritten = 0;
    let eventsExported = 0;
    const missingRows = new Set<string>();

    for (const event of events) {
      const eventDate = parseDateOnly(event.event_date);
      if (!eventDate) {
        continue;
      }

      const ensuredSheet = await ensureAttendanceSheet({
        sheetId: TARGET_ATTENDANCE_SHEET_ID,
        eventDate,
        suggestedGid: event.source_gid,
      });

      const ensuredColumn = await ensureAttendanceColumn({
        sheetId: TARGET_ATTENDANCE_SHEET_ID,
        gid: ensuredSheet.gid,
        eventDate,
        eventTitle: event.title,
        sourceHeader: event.source_header,
      });

      const eventEntries = attendanceByEventId.get(event.event_id) ?? new Map<string, number>();
      if (overwriteMissingWithZero) {
        const writes: CellWriteTarget[] = [];
        for (const memberId of pagedMemberIds) {
          const rowNumber = pickMemberRowNumber(
            memberId,
            membersById,
            fallbackRows,
            TARGET_ATTENDANCE_SHEET_ID,
            ensuredSheet.gid,
          );
          if (!rowNumber) {
            missingRows.add(memberId);
            continue;
          }

          writes.push({
            memberId,
            rowNumber,
            attendanceRatio: eventEntries.get(memberId) ?? 0,
          });
        }

        if (!dryRun) {
          await writeAttendanceCellsWithConcurrency({
            writes,
            concurrency: writeConcurrency,
            sheetId: TARGET_ATTENDANCE_SHEET_ID,
            gid: ensuredSheet.gid,
            columnRef: ensuredColumn.columnRef,
            eventDate,
            eventTitle: event.title,
            sourceHeader: event.source_header,
          });
        }
        cellsWritten += writes.length;
      } else {
        const writes: CellWriteTarget[] = [];
        for (const [memberId, ratio] of eventEntries.entries()) {
          if (memberIdFilter && !memberIdFilter.has(memberId)) {
            continue;
          }

          const rowNumber = pickMemberRowNumber(
            memberId,
            membersById,
            fallbackRows,
            TARGET_ATTENDANCE_SHEET_ID,
            ensuredSheet.gid,
          );
          if (!rowNumber) {
            missingRows.add(memberId);
            continue;
          }

          writes.push({
            memberId,
            rowNumber,
            attendanceRatio: ratio,
          });
        }

        if (!dryRun) {
          await writeAttendanceCellsWithConcurrency({
            writes,
            concurrency: writeConcurrency,
            sheetId: TARGET_ATTENDANCE_SHEET_ID,
            gid: ensuredSheet.gid,
            columnRef: ensuredColumn.columnRef,
            eventDate,
            eventTitle: event.title,
            sourceHeader: event.source_header,
          });
        }
        cellsWritten += writes.length;
      }

      eventsExported += 1;
    }

    return jsonResponse({
      status: "ok",
      dry_run: dryRun,
      overwrite_missing_with_zero: overwriteMissingWithZero,
      target_sheet_id: TARGET_ATTENDANCE_SHEET_ID,
      events_exported: eventsExported,
      cells_written: cellsWritten,
      write_concurrency: writeConcurrency,
      member_filter_count: memberIdFilter?.size ?? 0,
      member_offset: memberOffset,
      member_limit: memberLimit,
      selected_member_targets_count: pagedMemberIds.length,
      total_member_targets_count: filteredMemberIds.length,
      has_more_member_pages: hasMoreMemberPages,
      next_member_offset: hasMoreMemberPages ? memberOffset + pagedMemberIds.length : null,
      missing_member_row_mappings: Array.from(missingRows).slice(0, 100),
      missing_member_row_mappings_count: missingRows.size,
    });
  } catch (error) {
    const known = error instanceof HttpError
      ? error
      : new HttpError(
        500,
        "unexpected_error",
        error instanceof Error ? error.message : "Unknown error",
      );

    return jsonResponse(
      {
        error: known.code,
        message: known.message,
        details: known.details ?? null,
      },
      known.status,
    );
  }
});
