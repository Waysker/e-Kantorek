import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type ProfileRow = {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  instrument: string;
  role: string | null;
};

type MemberCandidate = {
  member_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  instrument: string;
};

type EventSourceRow = {
  event_id: string;
  title: string;
  event_date: string;
  source_header: string | null;
  source_sheet_id: string | null;
  source_gid: string | null;
  source_column: string | null;
};

type EventLookupRow = {
  event_id: string;
  title: string;
  event_date: string;
};

type QueueRow = {
  id: number;
  status: "queued" | "processing" | "applied" | "failed" | "dead_letter";
  member_id: string;
  event_id: string;
  attendance_ratio: number;
  requested_raw_value: string | null;
  requested_by_profile_id: string | null;
  requested_by_label: string | null;
  request_note: string | null;
  source: string;
  source_sheet_id: string | null;
  source_gid: string | null;
  source_column: string | null;
  source_row_number: number | null;
  attempt_count: number;
  last_error: string | null;
  worker_run_id: string | null;
  enqueued_at: string;
  claimed_at: string | null;
  processed_at: string | null;
  applied_cell_ref: string | null;
};

type SourceCoordinates = {
  sourceSheetId: string;
  sourceGid: string;
  sourceColumn: string;
  sourceRowNumber: number;
  cellRef: string;
};

type SheetSource = {
  sheetId: string;
  gid: string;
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
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

const WORKER_AUTH_TOKEN = Deno.env.get("ATTENDANCE_WRITE_FUNCTION_AUTH_TOKEN");
const APPS_SCRIPT_WEBHOOK_URL =
  Deno.env.get("ATTENDANCE_APPS_SCRIPT_WEBHOOK_URL") ??
  Deno.env.get("APPS_SCRIPT_WEBHOOK_URL");
const APPS_SCRIPT_WEBHOOK_TOKEN =
  Deno.env.get("ATTENDANCE_APPS_SCRIPT_WEBHOOK_TOKEN") ??
  Deno.env.get("APPS_SCRIPT_WEBHOOK_TOKEN");
const DEFAULT_ATTENDANCE_SHEET_ID = normalizeWhitespace(Deno.env.get("ATTENDANCE_SHEET_ID") ?? "");
const DEFAULT_ATTENDANCE_SHEET_GID = normalizeWhitespace(Deno.env.get("ATTENDANCE_SHEET_GID") ?? "");
const SHEET_TO_SUPABASE_SYNC_URL = Deno.env.get("SHEET_TO_SUPABASE_SYNC_URL");
const SHEET_TO_SUPABASE_SYNC_TOKEN = Deno.env.get("SHEET_TO_SUPABASE_SYNC_TOKEN");
const DB_TO_SHEET_EXPORT_URL =
  Deno.env.get("DB_TO_SHEET_EXPORT_URL") ??
  Deno.env.get("SUPABASE_TO_SHEET_EXPORT_URL");
const DB_TO_SHEET_EXPORT_TOKEN =
  Deno.env.get("DB_TO_SHEET_EXPORT_TOKEN") ??
  Deno.env.get("SUPABASE_TO_SHEET_EXPORT_TOKEN");
const CORS_ALLOWED_ORIGINS = parseCorsAllowedOrigins(Deno.env.get("ATTENDANCE_WRITE_CORS_ALLOWED_ORIGINS"));
const ALLOW_CRON_SYNC_FALLBACK = parseBooleanEnv(
  Deno.env.get("ATTENDANCE_WRITE_ALLOW_CRON_SYNC_FALLBACK"),
  false,
);
const WRITE_SOURCE_MODE = normalizeWhitespace(Deno.env.get("ATTENDANCE_WRITE_SOURCE_MODE") ?? "sheet_first").toLowerCase();
const IS_DB_FIRST_MODE = WRITE_SOURCE_MODE === "db_first";
const TRIGGER_DB_EXPORT_AFTER_WRITE = parseBooleanEnv(
  Deno.env.get("ATTENDANCE_WRITE_TRIGGER_DB_EXPORT"),
  false,
);

const DEFAULT_PROCESS_BATCH_SIZE = parseIntegerEnv("ATTENDANCE_WRITE_PROCESS_BATCH_SIZE", 25, 1, 200);
const DEFAULT_MAX_ATTEMPTS = parseIntegerEnv("ATTENDANCE_WRITE_MAX_ATTEMPTS", 5, 1, 50);

function parseIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Deno.env.get(name);
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function parseBooleanEnv(rawValue: string | undefined, fallback: boolean): boolean {
  const normalized = normalizeWhitespace(rawValue ?? "").toLowerCase();
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

function parseCorsAllowedOrigins(rawValue: string | undefined): string[] {
  const normalized = normalizeWhitespace(rawValue ?? "");
  if (!normalized) {
    return ["*"];
  }

  const parsed = normalized
    .split(",")
    .map((item) => normalizeWhitespace(item))
    .filter((item) => item.length > 0);

  return parsed.length > 0 ? parsed : ["*"];
}

function resolveCorsOrigin(request: Request): string {
  const requestOrigin = normalizeWhitespace(request.headers.get("origin") ?? "");
  if (CORS_ALLOWED_ORIGINS.includes("*")) {
    return "*";
  }

  if (!requestOrigin) {
    return CORS_ALLOWED_ORIGINS[0] ?? "*";
  }

  if (CORS_ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin;
  }

  return CORS_ALLOWED_ORIGINS[0] ?? "*";
}

function buildCorsHeaders(request: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": resolveCorsOrigin(request),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  const corsHeaders = buildCorsHeaders(request);
  for (const [headerName, headerValue] of Object.entries(corsHeaders)) {
    headers.set(headerName, headerValue);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildCanonicalSourceHeader(eventDate: string, eventTitle: string, sourceHeader: string | null): string {
  const normalizedEventDate = normalizeWhitespace(eventDate);
  const normalizedSourceHeader = normalizeWhitespace(sourceHeader ?? "");
  const normalizedEventTitle = normalizeWhitespace(eventTitle);

  const datePattern = normalizedEventDate
    ? new RegExp(`\\b${escapeRegex(normalizedEventDate)}\\b`, "g")
    : null;

  const baseTitleRaw = normalizedSourceHeader || normalizedEventTitle;
  const baseTitleWithoutDate = datePattern
    ? normalizeWhitespace(baseTitleRaw.replace(datePattern, " "))
    : normalizeWhitespace(baseTitleRaw);
  const fallbackTitleWithoutDate = datePattern
    ? normalizeWhitespace(normalizedEventTitle.replace(datePattern, " "))
    : normalizedEventTitle;
  const resolvedTitle = baseTitleWithoutDate || fallbackTitleWithoutDate || "Proba";

  if (!normalizedEventDate) {
    return resolvedTitle;
  }

  return `${resolvedTitle}\n${normalizedEventDate}`;
}

function normalizeMatchText(value: unknown): string {
  return normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

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

function normalizeInstrumentKey(value: unknown): string {
  return normalizeMatchText(value);
}

function canonicalizeInstrumentLabel(value: unknown): string {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return "";
  }

  return CANONICAL_INSTRUMENT_LABEL_BY_KEY[normalizeInstrumentKey(normalized)] ?? normalized;
}

function slugify(value: unknown): string {
  return normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseEventDateInput(value: unknown): string | null {
  const normalized = normalizeWhitespace(value ?? "");
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

function toIsoDateFromLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysToIsoDate(isoDate: string, deltaDays: number): string {
  const date = new Date(`${isoDate}T12:00:00`);
  date.setDate(date.getDate() + deltaDays);
  return toIsoDateFromLocalDate(date);
}

function startOfMonthIsoDate(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

function startOfNextMonthIsoDate(isoDate: string): string {
  const monthStart = new Date(`${startOfMonthIsoDate(isoDate)}T12:00:00`);
  monthStart.setMonth(monthStart.getMonth() + 1);
  return toIsoDateFromLocalDate(monthStart);
}

function scoreTitleMatch(requestedTitle: string, candidateTitle: string): number {
  if (!requestedTitle || !candidateTitle) {
    return 0;
  }

  let score = 0;
  if (candidateTitle === requestedTitle) {
    score += 1000;
  }
  if (candidateTitle.includes(requestedTitle)) {
    score += 300;
  }
  if (requestedTitle.includes(candidateTitle)) {
    score += 150;
  }

  const requestedTokens = requestedTitle.split(" ").filter((token) => token.length >= 3);
  const candidateTokens = new Set(candidateTitle.split(" ").filter((token) => token.length >= 3));
  const overlap = requestedTokens.filter((token) => candidateTokens.has(token)).length;
  score += overlap * 25;

  return score;
}

function toUpperLetters(value: string): string {
  return normalizeWhitespace(value).toUpperCase();
}

function parseBearerToken(headerValue: string | null): string | null {
  const normalized = normalizeWhitespace(headerValue ?? "");
  if (!normalized) {
    return null;
  }
  const match = normalized.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
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
  const normalized = toUpperLetters(columnRef);
  if (!/^[A-Z]+$/.test(normalized)) {
    throw new HttpError(422, "invalid_source_column", `Invalid source column reference: ${columnRef}`);
  }

  let index = 0;
  for (const char of normalized) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

async function callAppsScriptWebhook(payload: Record<string, unknown>): Promise<string> {
  if (!APPS_SCRIPT_WEBHOOK_URL) {
    throw new HttpError(
      500,
      "missing_apps_script_webhook_url",
      "ATTENDANCE_APPS_SCRIPT_WEBHOOK_URL (or APPS_SCRIPT_WEBHOOK_URL) is required for process mode.",
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (APPS_SCRIPT_WEBHOOK_TOKEN) {
    headers.Authorization = `Bearer ${APPS_SCRIPT_WEBHOOK_TOKEN}`;
    headers["X-Webhook-Token"] = APPS_SCRIPT_WEBHOOK_TOKEN;
  }

  const response = await fetch(APPS_SCRIPT_WEBHOOK_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...payload,
      webhookToken: APPS_SCRIPT_WEBHOOK_TOKEN ?? null,
    }),
    redirect: "follow",
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new HttpError(
      502,
      "apps_script_write_failed",
      `Apps Script write failed (${response.status}): ${bodyText.slice(0, 500)}`,
    );
  }

  return await response.text();
}

function extractWebhookErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const asRecord = payload as Record<string, unknown>;
  const error = normalizeWhitespace(asRecord.error ?? "");
  if (error) {
    return error;
  }
  const message = normalizeWhitespace(asRecord.message ?? "");
  if (message) {
    return message;
  }
  return null;
}

function parseWebhookColumnRef(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const asRecord = payload as Record<string, unknown>;
  const rawColumn = normalizeWhitespace(asRecord.columnRef ?? asRecord.column_ref ?? asRecord.source_column ?? "");
  if (!rawColumn) {
    return null;
  }
  return toColumnRef(columnRefToIndex(rawColumn));
}

function parseWebhookGid(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const asRecord = payload as Record<string, unknown>;
  const rawGid = normalizeWhitespace(asRecord.gid ?? asRecord.source_gid ?? asRecord.sheetGid ?? asRecord.sheet_gid ?? "");
  if (!rawGid || !/^\d+$/.test(rawGid)) {
    return null;
  }
  return rawGid;
}

async function ensureAttendanceSheetViaAppsScript(params: {
  sheetId: string;
  eventDate: string;
  suggestedGid: string | null;
}): Promise<{ gid: string; title: string | null; created: boolean }> {
  const normalizedSheetId = normalizeWhitespace(params.sheetId);
  if (!normalizedSheetId) {
    throw new HttpError(422, "invalid_source_sheet_id", "Invalid source sheet ID.");
  }

  const normalizedEventDate = parseEventDateInput(params.eventDate);
  if (!normalizedEventDate) {
    throw new HttpError(422, "invalid_event_date", `Invalid event date value: ${params.eventDate}`);
  }

  const normalizedSuggestedGid = normalizeWhitespace(params.suggestedGid ?? "");
  const suggestedGid = normalizedSuggestedGid && /^\d+$/.test(normalizedSuggestedGid)
    ? normalizedSuggestedGid
    : null;

  const responseText = await callAppsScriptWebhook({
    action: "ensure_attendance_sheet",
    sheetId: normalizedSheetId,
    eventDate: normalizedEventDate,
    suggestedGid,
  });

  if (!responseText) {
    throw new HttpError(
      502,
      "apps_script_ensure_sheet_invalid_response",
      "Apps Script ensure_attendance_sheet returned an empty response.",
    );
  }

  try {
    const parsed = JSON.parse(responseText) as {
      ok?: boolean;
      error?: string;
      message?: string;
      created?: boolean;
      title?: string;
      sheetTitle?: string;
      sheet_title?: string;
      gid?: string | number;
      source_gid?: string | number;
      sheetGid?: string | number;
      sheet_gid?: string | number;
    };
    if (parsed.ok === false) {
      throw new HttpError(
        502,
        "apps_script_write_failed",
        `Apps Script responded with failure: ${extractWebhookErrorMessage(parsed) ?? "unknown_error"}`,
      );
    }

    const gid = parseWebhookGid(parsed);
    if (!gid) {
      throw new HttpError(
        502,
        "apps_script_ensure_sheet_invalid_response",
        "Apps Script ensure_attendance_sheet did not return gid.",
      );
    }

    const title = normalizeWhitespace(parsed.title ?? parsed.sheetTitle ?? parsed.sheet_title ?? "");
    return {
      gid,
      title: title || null,
      created: parsed.created === true,
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(
      502,
      "apps_script_ensure_sheet_invalid_response",
      `Could not parse Apps Script ensure_attendance_sheet response: ${responseText.slice(0, 500)}`,
    );
  }
}

async function ensureAttendanceColumnViaAppsScript(params: {
  sheetId: string;
  gid: string;
  eventDate: string;
  eventTitle: string;
  sourceHeader: string | null;
}): Promise<{ columnRef: string; header: string | null }> {
  if (!Number.isFinite(Number(params.gid))) {
    throw new HttpError(422, "invalid_source_gid", `Invalid gid value: ${params.gid}`);
  }

  const preferredSourceHeader = buildCanonicalSourceHeader(
    params.eventDate,
    params.eventTitle,
    params.sourceHeader,
  );

  const responseText = await callAppsScriptWebhook({
    action: "ensure_attendance_column",
    sheetId: params.sheetId,
    gid: String(params.gid),
    eventDate: params.eventDate,
    eventTitle: params.eventTitle,
    sourceHeader: preferredSourceHeader,
  });

  if (!responseText) {
    throw new HttpError(
      502,
      "apps_script_ensure_column_invalid_response",
      "Apps Script ensure_attendance_column returned an empty response.",
    );
  }

  try {
    const parsed = JSON.parse(responseText) as {
      ok?: boolean;
      error?: string;
      message?: string;
      header?: string;
      source_header?: string;
      columnRef?: string;
      column_ref?: string;
      source_column?: string;
    };
    if (parsed.ok === false) {
      throw new HttpError(
        502,
        "apps_script_write_failed",
        `Apps Script responded with failure: ${extractWebhookErrorMessage(parsed) ?? "unknown_error"}`,
      );
    }
    const columnRef = parseWebhookColumnRef(parsed);
    if (!columnRef) {
      throw new HttpError(
        502,
        "apps_script_ensure_column_invalid_response",
        "Apps Script ensure_attendance_column did not return columnRef.",
      );
    }
    const responseHeader = normalizeWhitespace(parsed.header ?? parsed.source_header ?? "");
    return {
      columnRef,
      header: responseHeader || null,
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(
      502,
      "apps_script_ensure_column_invalid_response",
      `Could not parse Apps Script ensure_attendance_column response: ${responseText.slice(0, 500)}`,
    );
  }
}

async function writeAttendanceViaAppsScript(params: {
  sheetId: string;
  gid: string;
  columnRef: string;
  rowNumber: number;
  attendanceRatio: number;
}): Promise<void> {
  if (!Number.isFinite(Number(params.gid))) {
    throw new HttpError(422, "invalid_source_gid", `Invalid gid value: ${params.gid}`);
  }

  const normalizedColumnRef = toColumnRef(columnRefToIndex(params.columnRef));
  const normalizedRow = Math.trunc(params.rowNumber);
  if (!Number.isInteger(normalizedRow) || normalizedRow <= 0) {
    throw new HttpError(422, "invalid_source_row", `Invalid row number: ${params.rowNumber}`);
  }

  const cellRef = `${normalizedColumnRef}${normalizedRow}`;
  const responseText = await callAppsScriptWebhook({
    action: "set_attendance_cell",
    sheetId: params.sheetId,
    gid: String(params.gid),
    columnRef: normalizedColumnRef,
    rowNumber: normalizedRow,
    cellRef,
    attendanceRatio: Number(params.attendanceRatio.toFixed(4)),
  });

  if (!responseText) {
    return;
  }

  try {
    const parsed = JSON.parse(responseText) as {
      ok?: boolean;
      error?: string;
      message?: string;
    };
    if (parsed.ok === false) {
      throw new HttpError(
        502,
        "apps_script_write_failed",
        `Apps Script responded with failure: ${extractWebhookErrorMessage(parsed) ?? "unknown_error"}`,
      );
    }
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    // Non-JSON response is acceptable as long as HTTP status is 2xx.
  }
}

function parseAttendanceRatioInput(input: unknown): { ratio: number; rawValue: string } {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      throw new HttpError(422, "invalid_attendance_ratio", "attendanceRatio must be a finite number.");
    }
    if (input < 0 || input > 1) {
      throw new HttpError(422, "invalid_attendance_ratio", "attendanceRatio must be between 0 and 1.");
    }
    return {
      ratio: Number(input.toFixed(4)),
      rawValue: String(input),
    };
  }

  const normalized = normalizeWhitespace(input);
  if (!normalized) {
    throw new HttpError(422, "missing_attendance_ratio", "attendanceRatio is required.");
  }

  const usesPercent = normalized.endsWith("%");
  const numericPart = usesPercent ? normalized.slice(0, -1) : normalized;
  const parsed = Number.parseFloat(numericPart.replace(",", "."));
  if (!Number.isFinite(parsed)) {
    throw new HttpError(422, "invalid_attendance_ratio", `Cannot parse attendance ratio value: ${normalized}`);
  }

  const ratio = usesPercent || parsed > 1 ? parsed / 100 : parsed;
  if (ratio < 0 || ratio > 1) {
    throw new HttpError(422, "invalid_attendance_ratio", "attendanceRatio must be between 0 and 1.");
  }

  return {
    ratio: Number(ratio.toFixed(4)),
    rawValue: normalized,
  };
}

function parseProcessInteger(value: unknown, fallback: number, min: number, max: number): number {
  const asNumber = typeof value === "number"
    ? value
    : typeof value === "string"
    ? Number.parseInt(value, 10)
    : Number.NaN;

  if (!Number.isFinite(asNumber)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(asNumber), min), max);
}

function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = normalizeWhitespace(raw);
  return normalized.slice(0, 1200);
}

async function resolveUserFromToken(accessToken: string): Promise<{ id: string }> {
  if (!SUPABASE_URL || (!SUPABASE_ANON_KEY && !SUPABASE_SERVICE_ROLE_KEY)) {
    throw new HttpError(
      500,
      "missing_supabase_auth_env",
      "SUPABASE_URL and SUPABASE_ANON_KEY (or service key fallback) are required.",
    );
  }

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY ?? SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data, error } = await authClient.auth.getUser(accessToken);
  if (error || !data?.user) {
    throw new HttpError(401, "unauthorized", "Invalid or expired user access token.");
  }

  return { id: data.user.id };
}

async function loadProfile(
  supabaseAdmin: ReturnType<typeof createClient>,
  profileId: string,
): Promise<ProfileRow> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id,first_name,last_name,full_name,instrument,role")
    .eq("id", profileId)
    .maybeSingle<ProfileRow>();

  if (error) {
    throw new HttpError(500, "profile_lookup_failed", `Could not load profile: ${error.message}`);
  }

  if (!data) {
    throw new HttpError(404, "profile_not_found", "Signed-in profile was not found in public.profiles.");
  }

  return data;
}

async function resolveMemberIdForProfile(
  supabaseAdmin: ReturnType<typeof createClient>,
  profile: ProfileRow,
): Promise<string> {
  const { data: existingLink, error: existingLinkError } = await supabaseAdmin
    .from("profile_member_links")
    .select("member_id")
    .eq("profile_id", profile.id)
    .maybeSingle<{ member_id: string }>();

  if (existingLinkError) {
    throw new HttpError(500, "profile_member_link_lookup_failed", existingLinkError.message);
  }

  if (existingLink?.member_id) {
    return existingLink.member_id;
  }

  let candidates: MemberCandidate[] = [];
  const { data: exactCandidates, error: exactError } = await supabaseAdmin
    .from("members")
    .select("member_id,first_name,last_name,full_name,instrument")
    .eq("first_name", profile.first_name)
    .eq("last_name", profile.last_name)
    .returns<MemberCandidate[]>();

  if (exactError) {
    throw new HttpError(500, "member_lookup_failed", exactError.message);
  }

  candidates = exactCandidates ?? [];

  if (candidates.length === 0) {
    const { data: fallbackCandidates, error: fallbackError } = await supabaseAdmin
      .from("members")
      .select("member_id,first_name,last_name,full_name,instrument")
      .ilike("first_name", profile.first_name)
      .ilike("last_name", profile.last_name)
      .returns<MemberCandidate[]>();

    if (fallbackError) {
      throw new HttpError(500, "member_lookup_failed", fallbackError.message);
    }

    candidates = fallbackCandidates ?? [];
  }

  if (candidates.length === 0) {
    throw new HttpError(
      404,
      "member_not_mapped",
      "No member row matched this profile. Run sheet sync first or create profile_member_links mapping.",
      {
        profile_id: profile.id,
        first_name: profile.first_name,
        last_name: profile.last_name,
      },
    );
  }

  const instrumentMatch = candidates.filter((candidate) =>
    normalizeInstrumentKey(canonicalizeInstrumentLabel(candidate.instrument)) ===
      normalizeInstrumentKey(canonicalizeInstrumentLabel(profile.instrument))
  );
  const narrowed = instrumentMatch.length > 0 ? instrumentMatch : candidates;

  if (narrowed.length !== 1) {
    throw new HttpError(
      409,
      "ambiguous_member_mapping",
      "Profile matched multiple members. Create an explicit mapping in profile_member_links.",
      {
        profile_id: profile.id,
        candidate_member_ids: narrowed.map((candidate) => candidate.member_id),
      },
    );
  }

  const selectedMemberId = narrowed[0].member_id;
  const { error: upsertLinkError } = await supabaseAdmin
    .from("profile_member_links")
    .upsert(
      {
        profile_id: profile.id,
        member_id: selectedMemberId,
      },
      { onConflict: "profile_id" },
    );

  if (upsertLinkError) {
    throw new HttpError(500, "profile_member_link_upsert_failed", upsertLinkError.message);
  }

  return selectedMemberId;
}

async function resolveEventSource(
  supabaseAdmin: ReturnType<typeof createClient>,
  eventId: string,
): Promise<EventSourceRow> {
  const { data, error } = await supabaseAdmin
    .from("events")
    .select("event_id,title,event_date,source_header,source_sheet_id,source_gid,source_column")
    .eq("event_id", eventId)
    .maybeSingle<EventSourceRow>();

  if (error) {
    throw new HttpError(500, "event_lookup_failed", error.message);
  }

  if (!data) {
    throw new HttpError(404, "event_not_found", `Event ${eventId} was not found.`);
  }

  return data;
}

async function resolveDefaultSheetSource(
  supabaseAdmin: ReturnType<typeof createClient>,
  options?: {
    eventDate?: string | null;
  },
): Promise<SheetSource | null> {
  const preferredEventDate = parseEventDateInput(options?.eventDate ?? null);

  if (preferredEventDate) {
    const monthStart = startOfMonthIsoDate(preferredEventDate);
    const nextMonthStart = startOfNextMonthIsoDate(preferredEventDate);
    const preferredDateEpoch = new Date(`${preferredEventDate}T12:00:00`).getTime();

    const { data: sameMonthRows, error: sameMonthError } = await supabaseAdmin
      .from("events")
      .select("event_date,source_sheet_id,source_gid")
      .gte("event_date", monthStart)
      .lt("event_date", nextMonthStart)
      .not("source_sheet_id", "is", null)
      .not("source_gid", "is", null)
      .returns<Array<{ event_date: string; source_sheet_id: string | null; source_gid: string | null }>>();

    if (sameMonthError) {
      throw new HttpError(500, "default_sheet_source_lookup_failed", sameMonthError.message);
    }

    const bestSameMonth = (sameMonthRows ?? [])
      .map((row) => ({
        row,
        distance: Math.abs(new Date(`${row.event_date}T12:00:00`).getTime() - preferredDateEpoch),
      }))
      .sort((left, right) => left.distance - right.distance)[0]?.row;

    const sameMonthSheetId = normalizeWhitespace(bestSameMonth?.source_sheet_id ?? "");
    const sameMonthGid = normalizeWhitespace(bestSameMonth?.source_gid ?? "");
    if (sameMonthSheetId && sameMonthGid && /^\d+$/.test(sameMonthGid)) {
      return {
        sheetId: sameMonthSheetId,
        gid: sameMonthGid,
      };
    }

    const searchStart = addDaysToIsoDate(preferredEventDate, -120);
    const searchEnd = addDaysToIsoDate(preferredEventDate, 120);
    const { data: nearbyRows, error: nearbyError } = await supabaseAdmin
      .from("events")
      .select("event_date,source_sheet_id,source_gid")
      .gte("event_date", searchStart)
      .lte("event_date", searchEnd)
      .not("source_sheet_id", "is", null)
      .not("source_gid", "is", null)
      .returns<Array<{ event_date: string; source_sheet_id: string | null; source_gid: string | null }>>();

    if (nearbyError) {
      throw new HttpError(500, "default_sheet_source_lookup_failed", nearbyError.message);
    }

    const bestNearby = (nearbyRows ?? [])
      .map((row) => ({
        row,
        distance: Math.abs(new Date(`${row.event_date}T12:00:00`).getTime() - preferredDateEpoch),
      }))
      .sort((left, right) => left.distance - right.distance)[0]?.row;

    const nearbySheetId = normalizeWhitespace(bestNearby?.source_sheet_id ?? "");
    const nearbyGid = normalizeWhitespace(bestNearby?.source_gid ?? "");
    if (nearbySheetId && nearbyGid && /^\d+$/.test(nearbyGid)) {
      return {
        sheetId: nearbySheetId,
        gid: nearbyGid,
      };
    }
  }

  const { data: fromEvents, error: fromEventsError } = await supabaseAdmin
    .from("events")
    .select("source_sheet_id,source_gid")
    .not("source_sheet_id", "is", null)
    .not("source_gid", "is", null)
    .order("source_updated_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("event_date", { ascending: false })
    .limit(1)
    .maybeSingle<{ source_sheet_id: string | null; source_gid: string | null }>();

  if (fromEventsError) {
    throw new HttpError(500, "default_sheet_source_lookup_failed", fromEventsError.message);
  }

  const eventsSheetId = normalizeWhitespace(fromEvents?.source_sheet_id ?? "");
  const eventsGid = normalizeWhitespace(fromEvents?.source_gid ?? "");
  if (eventsSheetId && eventsGid && /^\d+$/.test(eventsGid)) {
    return {
      sheetId: eventsSheetId,
      gid: eventsGid,
    };
  }

  const { data: fromRows, error: fromRowsError } = await supabaseAdmin
    .from("sheet_member_rows")
    .select("source_sheet_id,source_gid")
    .order("source_updated_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<{ source_sheet_id: string; source_gid: string }>();

  if (fromRowsError) {
    throw new HttpError(500, "default_sheet_source_lookup_failed", fromRowsError.message);
  }

  const rowsSheetId = normalizeWhitespace(fromRows?.source_sheet_id ?? "");
  const rowsGid = normalizeWhitespace(fromRows?.source_gid ?? "");
  if (rowsSheetId && rowsGid && /^\d+$/.test(rowsGid)) {
    return {
      sheetId: rowsSheetId,
      gid: rowsGid,
    };
  }

  if (DEFAULT_ATTENDANCE_SHEET_ID && DEFAULT_ATTENDANCE_SHEET_GID && /^\d+$/.test(DEFAULT_ATTENDANCE_SHEET_GID)) {
    return {
      sheetId: DEFAULT_ATTENDANCE_SHEET_ID,
      gid: DEFAULT_ATTENDANCE_SHEET_GID,
    };
  }

  return null;
}

function buildFallbackEventTitle(_eventDate: string): string {
  return "Proba";
}

function buildSheetStyleEventId(eventDate: string, eventTitle: string): string {
  const suffix = slugify(eventTitle || "event");
  return `evt-${eventDate}-${suffix || "event"}`;
}

async function createPlaceholderEvent(
  supabaseAdmin: ReturnType<typeof createClient>,
  payload: {
    eventDate: string;
    eventTitleInput: string;
  },
): Promise<string> {
  const eventTitle = normalizeWhitespace(payload.eventTitleInput) || buildFallbackEventTitle(payload.eventDate);
  const sourceHeader = buildCanonicalSourceHeader(payload.eventDate, eventTitle, null);
  const fallbackSource = await resolveDefaultSheetSource(supabaseAdmin, { eventDate: payload.eventDate });
  if (!fallbackSource) {
    throw new HttpError(
      422,
      "missing_default_sheet_source",
      "Cannot create a placeholder event because no sheet source is configured. Set ATTENDANCE_SHEET_ID + ATTENDANCE_SHEET_GID or sync at least one mapped event first.",
      { event_date: payload.eventDate, event_title: eventTitle },
    );
  }

  const baseEventId = buildSheetStyleEventId(payload.eventDate, eventTitle);
  let candidateEventId = baseEventId;
  let suffix = 2;
  while (true) {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("events")
      .select("event_id")
      .eq("event_id", candidateEventId)
      .maybeSingle<{ event_id: string }>();

    if (existingError) {
      throw new HttpError(500, "event_lookup_failed", existingError.message);
    }

    if (!existing?.event_id) {
      break;
    }

    candidateEventId = `${baseEventId}-${suffix}`;
    suffix += 1;
  }

  const { error: insertError } = await supabaseAdmin
    .from("events")
    .insert({
      event_id: candidateEventId,
      title: eventTitle,
      event_date: payload.eventDate,
      source_header: sourceHeader,
      source_sheet_id: fallbackSource.sheetId,
      source_gid: fallbackSource.gid,
      source_column: null,
      source_updated_at: new Date().toISOString(),
    });

  if (insertError) {
    throw new HttpError(500, "event_create_failed", insertError.message, {
      event_id: candidateEventId,
      event_date: payload.eventDate,
      event_title: eventTitle,
    });
  }

  return candidateEventId;
}

async function resolveCanonicalEventId(
  supabaseAdmin: ReturnType<typeof createClient>,
  payload: {
    eventIdInput: string;
    eventDateInput: string | null;
    eventTitleInput: string;
  },
): Promise<{ eventId: string; resolution: "direct_event_id" | "date_unique" | "date_title_match" | "created_placeholder" }> {
  if (payload.eventIdInput) {
    const { data: exactMatch, error: exactMatchError } = await supabaseAdmin
      .from("events")
      .select("event_id")
      .eq("event_id", payload.eventIdInput)
      .maybeSingle<{ event_id: string }>();

    if (exactMatchError) {
      throw new HttpError(500, "event_lookup_failed", exactMatchError.message);
    }

    if (exactMatch?.event_id) {
      return { eventId: exactMatch.event_id, resolution: "direct_event_id" };
    }
  }

  if (!payload.eventDateInput) {
    throw new HttpError(
      422,
      "missing_event_date",
      "eventDate is required when eventId is not a canonical event_id.",
    );
  }

  const { data: dateMatches, error: dateMatchError } = await supabaseAdmin
    .from("events")
    .select("event_id,title,event_date")
    .eq("event_date", payload.eventDateInput)
    .returns<EventLookupRow[]>();

  if (dateMatchError) {
    throw new HttpError(500, "event_lookup_failed", dateMatchError.message);
  }

  const candidates = dateMatches ?? [];
  if (candidates.length === 0) {
    const createdEventId = await createPlaceholderEvent(supabaseAdmin, {
      eventDate: payload.eventDateInput,
      eventTitleInput: payload.eventTitleInput,
    });
    return { eventId: createdEventId, resolution: "created_placeholder" };
  }

  if (candidates.length === 1) {
    return { eventId: candidates[0].event_id, resolution: "date_unique" };
  }

  const normalizedRequestedTitle = normalizeMatchText(payload.eventTitleInput);
  if (!normalizedRequestedTitle) {
    throw new HttpError(
      409,
      "ambiguous_event_match",
      "Multiple canonical events exist for this date and eventTitle was not provided.",
      {
        event_date: payload.eventDateInput,
        candidates: candidates.map((candidate) => ({ event_id: candidate.event_id, title: candidate.title })),
      },
    );
  }

  const rankedCandidates = candidates
    .map((candidate) => ({
      candidate,
      score: scoreTitleMatch(normalizedRequestedTitle, normalizeMatchText(candidate.title)),
    }))
    .sort((left, right) => right.score - left.score);

  const best = rankedCandidates[0];
  const second = rankedCandidates[1];
  const scoreGap = second ? best.score - second.score : best.score;
  if (best.score <= 0 || scoreGap <= 0) {
    throw new HttpError(
      409,
      "ambiguous_event_match",
      "Could not unambiguously match eventTitle to a canonical event on this date.",
      {
        event_date: payload.eventDateInput,
        requested_event_title: payload.eventTitleInput,
        candidates: rankedCandidates.map((row) => ({
          event_id: row.candidate.event_id,
          title: row.candidate.title,
          score: row.score,
        })),
      },
    );
  }

  return { eventId: best.candidate.event_id, resolution: "date_title_match" };
}

async function resolveSourceCoordinates(
  supabaseAdmin: ReturnType<typeof createClient>,
  queueRow: {
    member_id: string;
    event_id: string;
    source_sheet_id?: string | null;
    source_gid?: string | null;
    source_column?: string | null;
    source_row_number?: number | null;
  },
): Promise<SourceCoordinates> {
  const eventSource = await resolveEventSource(supabaseAdmin, queueRow.event_id);
  const originalSourceSheetId = normalizeWhitespace(eventSource.source_sheet_id ?? "");
  const originalSourceGid = normalizeWhitespace(eventSource.source_gid ?? "");
  const originalSourceColumn = toUpperLetters(eventSource.source_column ?? "");
  let resolvedSourceHeader = normalizeWhitespace(eventSource.source_header ?? eventSource.title) || eventSource.title;

  let sourceSheetId = normalizeWhitespace(queueRow.source_sheet_id ?? eventSource.source_sheet_id ?? "");
  let sourceGid = normalizeWhitespace(queueRow.source_gid ?? eventSource.source_gid ?? "");
  if (!sourceSheetId || !sourceGid) {
    const fallbackSource = await resolveDefaultSheetSource(supabaseAdmin, { eventDate: eventSource.event_date });
    sourceSheetId = sourceSheetId || fallbackSource?.sheetId || "";
    sourceGid = sourceGid || fallbackSource?.gid || "";
  }

  if (!sourceSheetId || !sourceGid) {
    throw new HttpError(
      422,
      "event_source_sheet_missing",
      "Event is missing source sheet coordinates and no default sheet source is available.",
      { event_id: queueRow.event_id },
    );
  }

  const ensuredSheet = await ensureAttendanceSheetViaAppsScript({
    sheetId: sourceSheetId,
    eventDate: eventSource.event_date,
    suggestedGid: sourceGid || null,
  });
  sourceGid = ensuredSheet.gid;

  let sourceColumn = toUpperLetters(queueRow.source_column ?? eventSource.source_column ?? "");
  if (!sourceColumn) {
    const ensuredColumn = await ensureAttendanceColumnViaAppsScript({
      sheetId: sourceSheetId,
      gid: sourceGid,
      eventDate: eventSource.event_date,
      eventTitle: eventSource.title,
      sourceHeader: eventSource.source_header,
    });
    sourceColumn = ensuredColumn.columnRef;
    resolvedSourceHeader = normalizeWhitespace(ensuredColumn.header ?? resolvedSourceHeader) || eventSource.title;
  }

  const sourceMappingChanged =
    sourceSheetId !== originalSourceSheetId ||
    sourceGid !== originalSourceGid ||
    sourceColumn !== originalSourceColumn ||
    resolvedSourceHeader !== normalizeWhitespace(eventSource.source_header ?? "");

  if (sourceMappingChanged) {
    const { error: eventUpdateError } = await supabaseAdmin
      .from("events")
      .update({
        source_sheet_id: sourceSheetId,
        source_gid: sourceGid,
        source_column: sourceColumn || null,
        source_header: resolvedSourceHeader,
        source_updated_at: new Date().toISOString(),
      })
      .eq("event_id", eventSource.event_id);

    if (eventUpdateError) {
      throw new HttpError(500, "event_source_update_failed", eventUpdateError.message, {
        event_id: eventSource.event_id,
      });
    }
  }

  let sourceRowNumber = queueRow.source_row_number ?? null;
  if (!sourceRowNumber) {
    const { data: rowMapExact, error: rowMapExactError } = await supabaseAdmin
      .from("sheet_member_rows")
      .select("source_row_number")
      .eq("member_id", queueRow.member_id)
      .eq("source_sheet_id", sourceSheetId)
      .eq("source_gid", sourceGid)
      .maybeSingle<{ source_row_number: number }>();

    if (rowMapExactError) {
      throw new HttpError(500, "sheet_member_row_lookup_failed", rowMapExactError.message);
    }

    sourceRowNumber = rowMapExact?.source_row_number ?? null;

    if (!sourceRowNumber) {
      const { data: rowMapFallback, error: rowMapFallbackError } = await supabaseAdmin
        .from("sheet_member_rows")
        .select("source_row_number,source_gid")
        .eq("member_id", queueRow.member_id)
        .eq("source_sheet_id", sourceSheetId)
        .order("source_updated_at", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle<{ source_row_number: number; source_gid: string }>();

      if (rowMapFallbackError) {
        throw new HttpError(500, "sheet_member_row_lookup_failed", rowMapFallbackError.message);
      }

      sourceRowNumber = rowMapFallback?.source_row_number ?? null;
      if (sourceRowNumber) {
        const { error: rowMapUpsertError } = await supabaseAdmin
          .from("sheet_member_rows")
          .upsert(
            {
              member_id: queueRow.member_id,
              source_sheet_id: sourceSheetId,
              source_gid: sourceGid,
              source_row_number: sourceRowNumber,
              source_updated_at: new Date().toISOString(),
            },
            { onConflict: "member_id,source_sheet_id,source_gid" },
          );

        if (rowMapUpsertError) {
          throw new HttpError(500, "sheet_member_row_upsert_failed", rowMapUpsertError.message, {
            member_id: queueRow.member_id,
            source_sheet_id: sourceSheetId,
            source_gid: sourceGid,
          });
        }
      }
    }
  }

  if (!sourceRowNumber) {
    throw new HttpError(
      422,
      "member_source_row_missing",
      "Member row mapping for this sheet tab is missing. Re-run sheet_to_supabase_sync in write mode.",
      {
        member_id: queueRow.member_id,
        event_id: queueRow.event_id,
        source_sheet_id: sourceSheetId,
        source_gid: sourceGid,
      },
    );
  }

  const normalizedColumnRef = toColumnRef(columnRefToIndex(sourceColumn));

  return {
    sourceSheetId,
    sourceGid,
    sourceColumn: normalizedColumnRef,
    sourceRowNumber,
    cellRef: `${normalizedColumnRef}${sourceRowNumber}`,
  };
}

async function enqueueAttendanceChange(
  supabaseAdmin: ReturnType<typeof createClient>,
  payload: {
    memberId: string;
    eventId: string;
    attendanceRatio: number;
    requestedRawValue: string;
    requestedByProfileId: string;
    requestedByLabel: string;
    requestNote: string | null;
    source: string;
    sourceSheetId?: string | null;
    sourceGid?: string | null;
    sourceColumn?: string | null;
    sourceRowNumber?: number | null;
  },
): Promise<QueueRow> {
  const insertPayload = {
    status: "queued",
    member_id: payload.memberId,
    event_id: payload.eventId,
    attendance_ratio: payload.attendanceRatio,
    requested_raw_value: payload.requestedRawValue,
    requested_by_profile_id: payload.requestedByProfileId,
    requested_by_label: payload.requestedByLabel,
    request_note: payload.requestNote,
    source: payload.source,
    source_sheet_id: payload.sourceSheetId ?? null,
    source_gid: payload.sourceGid ?? null,
    source_column: payload.sourceColumn ?? null,
    source_row_number: payload.sourceRowNumber ?? null,
    last_error: null,
    processed_at: null,
    claimed_at: null,
    worker_run_id: null,
    applied_cell_ref: null,
  };

  const { data: insertedRow, error: insertError } = await supabaseAdmin
    .from("attendance_change_queue")
    .insert(insertPayload)
    .select("*")
    .single<QueueRow>();

  if (!insertError && insertedRow) {
    return insertedRow;
  }

  if (insertError?.code !== "23505") {
    throw new HttpError(500, "attendance_change_enqueue_failed", insertError?.message ?? "Unknown enqueue failure.");
  }

  const { data: existingRow, error: existingError } = await supabaseAdmin
    .from("attendance_change_queue")
    .select("*")
    .eq("member_id", payload.memberId)
    .eq("event_id", payload.eventId)
    .in("status", ["queued", "processing"])
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<QueueRow>();

  if (existingError) {
    throw new HttpError(500, "attendance_change_queue_conflict_lookup_failed", existingError.message);
  }

  if (!existingRow) {
    throw new HttpError(500, "attendance_change_queue_conflict_not_found", "Queue conflict row could not be resolved.");
  }

  if (existingRow.status === "processing") {
    throw new HttpError(
      409,
      "attendance_change_already_processing",
      "An attendance change for this member/event is already being processed.",
      { queue_id: existingRow.id },
    );
  }

  const { data: updatedRow, error: updateError } = await supabaseAdmin
    .from("attendance_change_queue")
    .update({
      ...insertPayload,
      enqueued_at: new Date().toISOString(),
      attempt_count: existingRow.attempt_count,
    })
    .eq("id", existingRow.id)
    .select("*")
    .single<QueueRow>();

  if (updateError || !updatedRow) {
    throw new HttpError(500, "attendance_change_queue_conflict_update_failed", updateError?.message ?? "Unknown");
  }

  return updatedRow;
}

function normalizeProfileRole(rawRole: string | null): "member" | "section" | "board" | "admin" {
  const normalized = normalizeWhitespace(rawRole ?? "").toLowerCase();
  if (normalized === "admin") {
    return "admin";
  }
  if (
    normalized === "section" ||
    normalized === "leader" ||
    normalized === "lider" ||
    normalized === "sekcyjne" ||
    normalized === "sekcyjny" ||
    normalized === "sekcyjna" ||
    normalized === "sekcyjni"
  ) {
    return "section";
  }
  if (
    normalized === "board" ||
    normalized === "zarzad" ||
    normalized === "zarząd"
  ) {
    return "board";
  }
  return "member";
}

async function ensureMemberExists(
  supabaseAdmin: ReturnType<typeof createClient>,
  memberId: string,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("members")
    .select("member_id")
    .eq("member_id", memberId)
    .maybeSingle<{ member_id: string }>();

  if (error) {
    throw new HttpError(500, "member_lookup_failed", error.message);
  }
  if (!data?.member_id) {
    throw new HttpError(404, "member_not_found", `Member ${memberId} was not found.`);
  }
}

async function ensureMembersExist(
  supabaseAdmin: ReturnType<typeof createClient>,
  memberIds: string[],
): Promise<void> {
  const uniqueMemberIds = Array.from(new Set(memberIds.map((id) => normalizeWhitespace(id)).filter(Boolean)));
  if (uniqueMemberIds.length === 0) {
    throw new HttpError(422, "missing_member_id", "At least one memberId is required.");
  }

  const { data, error } = await supabaseAdmin
    .from("members")
    .select("member_id")
    .in("member_id", uniqueMemberIds)
    .returns<Array<{ member_id: string }>>();

  if (error) {
    throw new HttpError(500, "member_lookup_failed", error.message);
  }

  const found = new Set((data ?? []).map((row) => row.member_id));
  const missing = uniqueMemberIds.filter((memberId) => !found.has(memberId));
  if (missing.length > 0) {
    throw new HttpError(
      404,
      "member_not_found",
      `Some members were not found: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "..." : ""}`,
      { missing_member_ids: missing },
    );
  }
}

async function maybeTriggerSheetSync(): Promise<{ triggered: boolean; ok: boolean; status?: number; message?: string }> {
  if (!SHEET_TO_SUPABASE_SYNC_URL) {
    if (ALLOW_CRON_SYNC_FALLBACK) {
      return {
        triggered: false,
        ok: true,
        message: "SHEET_TO_SUPABASE_SYNC_URL not set; relying on scheduled sheet_to_supabase_sync.",
      };
    }
    return {
      triggered: false,
      ok: false,
      message:
        "SHEET_TO_SUPABASE_SYNC_URL not set. Configure it or set ATTENDANCE_WRITE_ALLOW_CRON_SYNC_FALLBACK=true.",
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (SHEET_TO_SUPABASE_SYNC_TOKEN) {
    headers.Authorization = `Bearer ${SHEET_TO_SUPABASE_SYNC_TOKEN}`;
  }

  try {
    const response = await fetch(SHEET_TO_SUPABASE_SYNC_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        trigger: "attendance_write_sheet_first",
        dryRun: false,
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text();
      return {
        triggered: true,
        ok: false,
        status: response.status,
        message: bodyText.slice(0, 500),
      };
    }

    return {
      triggered: true,
      ok: true,
      status: response.status,
    };
  } catch (error) {
    return {
      triggered: true,
      ok: false,
      message: sanitizeErrorMessage(error),
    };
  }
}

async function maybeTriggerDbToSheetExport(params: {
  eventId: string;
  eventDate: string;
  memberIds?: string[];
  overwriteMissingWithZero?: boolean;
}): Promise<{ triggered: boolean; ok: boolean; status?: number; message?: string }> {
  if (!TRIGGER_DB_EXPORT_AFTER_WRITE) {
    return {
      triggered: false,
      ok: true,
      message: "DB->Sheet export trigger disabled by ATTENDANCE_WRITE_TRIGGER_DB_EXPORT.",
    };
  }

  if (!DB_TO_SHEET_EXPORT_URL) {
    return {
      triggered: false,
      ok: false,
      message: "DB_TO_SHEET_EXPORT_URL is not set.",
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (DB_TO_SHEET_EXPORT_TOKEN) {
    headers.Authorization = `Bearer ${DB_TO_SHEET_EXPORT_TOKEN}`;
  }

  try {
    const memberIds = Array.isArray(params.memberIds)
      ? params.memberIds.map((value) => normalizeWhitespace(value)).filter(Boolean)
      : [];

    const response = await fetch(DB_TO_SHEET_EXPORT_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        trigger: "attendance_write_db_first",
        dryRun: false,
        eventId: params.eventId,
        eventDate: params.eventDate,
        overwriteMissingWithZero: params.overwriteMissingWithZero ?? false,
        memberIds,
        writeConcurrency: 4,
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text();
      return {
        triggered: true,
        ok: false,
        status: response.status,
        message: bodyText.slice(0, 500),
      };
    }

    return {
      triggered: true,
      ok: true,
      status: response.status,
    };
  } catch (error) {
    return {
      triggered: true,
      ok: false,
      message: sanitizeErrorMessage(error),
    };
  }
}

async function upsertAttendanceEntriesDbFirst(
  supabaseAdmin: ReturnType<typeof createClient>,
  payload: {
    eventId: string;
    changes: Array<{
      memberId: string;
      attendanceRatio: number;
      rawValue: string;
    }>;
  },
): Promise<void> {
  const sourceUpdatedAt = new Date().toISOString();
  const rows = payload.changes.map((change) => ({
    member_id: change.memberId,
    event_id: payload.eventId,
    attendance_ratio: change.attendanceRatio,
    source_raw_value: change.rawValue,
    source_updated_at: sourceUpdatedAt,
  }));

  const { error } = await supabaseAdmin
    .from("attendance_entries")
    .upsert(rows, { onConflict: "member_id,event_id" });

  if (error) {
    throw new HttpError(500, "attendance_entries_upsert_failed", error.message);
  }
}

async function handleDbFirstEnqueueMode(
  request: Request,
  body: Record<string, unknown>,
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<Response> {
  const accessToken = parseBearerToken(request.headers.get("authorization"));
  if (!accessToken) {
    throw new HttpError(401, "unauthorized", "Missing Bearer access token.");
  }

  const user = await resolveUserFromToken(accessToken);
  const profile = await loadProfile(supabaseAdmin, user.id);

  const eventIdInput = normalizeWhitespace(body.eventId ?? body.event_id ?? "");
  const eventDateInput = parseEventDateInput(body.eventDate ?? body.event_date ?? body.startsAt ?? body.starts_at);
  const eventTitleInput = normalizeWhitespace(body.eventTitle ?? body.event_title ?? body.title ?? "");
  if (!eventIdInput && !eventDateInput) {
    throw new HttpError(422, "missing_event_id_or_date", "Provide eventId or eventDate.");
  }

  const ratioInput = body.attendanceRatio ?? body.attendance_ratio ?? body.value ?? body.attendanceValue;
  const { ratio, rawValue } = parseAttendanceRatioInput(ratioInput);
  const requestNoteRaw = normalizeWhitespace(body.requestNote ?? body.note ?? "");
  const requestNote = requestNoteRaw ? requestNoteRaw.slice(0, 500) : null;

  const actorMemberId = await resolveMemberIdForProfile(supabaseAdmin, profile);
  const explicitMemberId = normalizeWhitespace(body.memberId ?? body.member_id ?? "");
  const targetMemberId = explicitMemberId || actorMemberId;
  const profileRole = normalizeProfileRole(profile.role);
  const hasManagerPrivileges =
    profileRole === "section" || profileRole === "board" || profileRole === "admin";
  const isSelfWrite = targetMemberId === actorMemberId;

  if (!hasManagerPrivileges) {
    throw new HttpError(
      403,
      "management_only_write_path",
      "Only section/board/admin can use this write path.",
    );
  }

  if (targetMemberId !== actorMemberId) {
    await ensureMemberExists(supabaseAdmin, targetMemberId);
  }

  const sourceRaw = normalizeWhitespace(body.source ?? "");
  const source = sourceRaw
    ? sourceRaw.toLowerCase().slice(0, 64)
    : "manager_panel_db_first";

  const resolvedEvent = await resolveCanonicalEventId(supabaseAdmin, {
    eventIdInput,
    eventDateInput,
    eventTitleInput,
  });
  const eventId = resolvedEvent.eventId;

  await upsertAttendanceEntriesDbFirst(supabaseAdmin, {
    eventId,
    changes: [{
      memberId: targetMemberId,
      attendanceRatio: ratio,
      rawValue,
    }],
  });

  await supabaseAdmin.from("change_journal").insert({
    entity_type: "attendance_entries",
    entity_id: `${eventId}:${targetMemberId}`,
    action: "attendance_write_db_applied",
    actor: `profile:${profile.id}`,
    payload: {
      actor_member_id: actorMemberId,
      member_id: targetMemberId,
      is_self_write: isSelfWrite,
      profile_role: profileRole,
      source,
      event_id: eventId,
      attendance_ratio: ratio,
      requested_event_id: eventIdInput || null,
      requested_event_date: eventDateInput,
      requested_event_title: eventTitleInput || null,
      resolved_event_id: eventId,
      event_resolution: resolvedEvent.resolution,
      mode: "db_first",
      request_note: requestNote,
    },
  });

  const exportTrigger = eventDateInput
    ? await maybeTriggerDbToSheetExport({
      eventId,
      eventDate: eventDateInput,
      memberIds: [targetMemberId],
      overwriteMissingWithZero: false,
    })
    : { triggered: false, ok: true, message: "No eventDate provided for export trigger." };

  return jsonResponse({
    status: "applied",
    mode: "db_first",
    member_id: targetMemberId,
    actor_member_id: actorMemberId,
    is_self_write: isSelfWrite,
    profile_role: profileRole,
    source,
    requested_event_id: eventIdInput || null,
    event_id: eventId,
    event_resolution: resolvedEvent.resolution,
    attendance_ratio: ratio,
    export_trigger: exportTrigger,
  });
}

async function handleDbFirstEnqueueBatchMode(
  request: Request,
  body: Record<string, unknown>,
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<Response> {
  const accessToken = parseBearerToken(request.headers.get("authorization"));
  if (!accessToken) {
    throw new HttpError(401, "unauthorized", "Missing Bearer access token.");
  }

  const user = await resolveUserFromToken(accessToken);
  const profile = await loadProfile(supabaseAdmin, user.id);
  const profileRole = normalizeProfileRole(profile.role);
  const hasManagerPrivileges =
    profileRole === "section" || profileRole === "board" || profileRole === "admin";
  if (!hasManagerPrivileges) {
    throw new HttpError(
      403,
      "management_only_write_path",
      "Only section/board/admin can use this write path.",
    );
  }

  const actorMemberId = await resolveMemberIdForProfile(supabaseAdmin, profile);
  const eventIdInput = normalizeWhitespace(body.eventId ?? body.event_id ?? "");
  const eventDateInput = parseEventDateInput(body.eventDate ?? body.event_date ?? body.startsAt ?? body.starts_at);
  const eventTitleInput = normalizeWhitespace(body.eventTitle ?? body.event_title ?? body.title ?? "");
  if (!eventIdInput && !eventDateInput) {
    throw new HttpError(422, "missing_event_id_or_date", "Provide eventId or eventDate.");
  }

  const rawChanges = Array.isArray(body.changes)
    ? body.changes
    : Array.isArray(body.items)
    ? body.items
    : [];
  if (rawChanges.length === 0) {
    throw new HttpError(422, "missing_changes", "Provide non-empty changes array.");
  }
  if (rawChanges.length > 500) {
    throw new HttpError(422, "too_many_changes", "Batch size exceeds limit (500).");
  }

  const parsedChanges: Array<{
    memberId: string;
    attendanceRatio: number;
    rawValue: string;
  }> = [];
  for (let index = 0; index < rawChanges.length; index += 1) {
    const rawChange = rawChanges[index];
    if (!rawChange || typeof rawChange !== "object") {
      throw new HttpError(422, "invalid_change_item", `changes[${index}] must be an object.`);
    }
    const change = rawChange as Record<string, unknown>;
    const memberId = normalizeWhitespace(change.memberId ?? change.member_id ?? "");
    if (!memberId) {
      throw new HttpError(422, "missing_member_id", `changes[${index}].memberId is required.`);
    }

    const ratioInput = change.attendanceRatio ?? change.attendance_ratio ?? change.value ?? change.attendanceValue;
    const { ratio, rawValue } = parseAttendanceRatioInput(ratioInput);
    parsedChanges.push({
      memberId,
      attendanceRatio: ratio,
      rawValue,
    });
  }

  await ensureMembersExist(supabaseAdmin, parsedChanges.map((change) => change.memberId));

  const resolvedEvent = await resolveCanonicalEventId(supabaseAdmin, {
    eventIdInput,
    eventDateInput,
    eventTitleInput,
  });
  const eventId = resolvedEvent.eventId;

  const dedupedChanges = new Map<string, { attendanceRatio: number; rawValue: string }>();
  for (const change of parsedChanges) {
    dedupedChanges.set(change.memberId, {
      attendanceRatio: change.attendanceRatio,
      rawValue: change.rawValue,
    });
  }

  await upsertAttendanceEntriesDbFirst(supabaseAdmin, {
    eventId,
    changes: Array.from(dedupedChanges.entries()).map(([memberId, value]) => ({
      memberId,
      attendanceRatio: value.attendanceRatio,
      rawValue: value.rawValue,
    })),
  });

  const sourceRaw = normalizeWhitespace(body.source ?? "");
  const source = sourceRaw
    ? sourceRaw.toLowerCase().slice(0, 64)
    : "manager_panel_db_first";
  const requestNoteRaw = normalizeWhitespace(body.requestNote ?? body.note ?? "");
  const requestNote = requestNoteRaw ? requestNoteRaw.slice(0, 500) : null;

  await supabaseAdmin.from("change_journal").insert({
    entity_type: "attendance_entries",
    entity_id: eventId,
    action: "attendance_write_db_applied_batch",
    actor: `profile:${profile.id}`,
    payload: {
      actor_member_id: actorMemberId,
      profile_role: profileRole,
      source,
      event_id: eventId,
      requested_event_id: eventIdInput || null,
      requested_event_date: eventDateInput,
      requested_event_title: eventTitleInput || null,
      resolved_event_id: eventId,
      event_resolution: resolvedEvent.resolution,
      changed_members_count: dedupedChanges.size,
      changed_member_ids: Array.from(dedupedChanges.keys()).slice(0, 500),
      mode: "db_first",
      request_note: requestNote,
    },
  });

  const exportTrigger = eventDateInput
    ? await maybeTriggerDbToSheetExport({
      eventId,
      eventDate: eventDateInput,
      memberIds: Array.from(dedupedChanges.keys()),
      overwriteMissingWithZero: false,
    })
    : { triggered: false, ok: true, message: "No eventDate provided for export trigger." };

  return jsonResponse({
    status: "applied",
    mode: "db_first",
    queued_count: dedupedChanges.size,
    changed_count: dedupedChanges.size,
    profile_role: profileRole,
    source,
    requested_event_id: eventIdInput || null,
    event_id: eventId,
    event_resolution: resolvedEvent.resolution,
    export_trigger: exportTrigger,
  });
}

async function handleEnqueueMode(
  request: Request,
  body: Record<string, unknown>,
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<Response> {
  const accessToken = parseBearerToken(request.headers.get("authorization"));
  if (!accessToken) {
    throw new HttpError(401, "unauthorized", "Missing Bearer access token.");
  }

  const user = await resolveUserFromToken(accessToken);
  const profile = await loadProfile(supabaseAdmin, user.id);

  const eventIdInput = normalizeWhitespace(body.eventId ?? body.event_id ?? "");
  const eventDateInput = parseEventDateInput(body.eventDate ?? body.event_date ?? body.startsAt ?? body.starts_at);
  const eventTitleInput = normalizeWhitespace(body.eventTitle ?? body.event_title ?? body.title ?? "");
  if (!eventIdInput && !eventDateInput) {
    throw new HttpError(422, "missing_event_id_or_date", "Provide eventId or eventDate.");
  }

  const ratioInput = body.attendanceRatio ?? body.attendance_ratio ?? body.value ?? body.attendanceValue;
  const { ratio, rawValue } = parseAttendanceRatioInput(ratioInput);
  const requestNoteRaw = normalizeWhitespace(body.requestNote ?? body.note ?? "");
  const requestNote = requestNoteRaw ? requestNoteRaw.slice(0, 500) : null;

  const actorMemberId = await resolveMemberIdForProfile(supabaseAdmin, profile);
  const explicitMemberId = normalizeWhitespace(body.memberId ?? body.member_id ?? "");
  const targetMemberId = explicitMemberId || actorMemberId;
  const profileRole = normalizeProfileRole(profile.role);
  const hasManagerPrivileges =
    profileRole === "section" || profileRole === "board" || profileRole === "admin";
  const isSelfWrite = targetMemberId === actorMemberId;

  if (!hasManagerPrivileges) {
    throw new HttpError(
      403,
      "management_only_write_path",
      "Only section/board/admin can use this write path.",
    );
  }

  if (targetMemberId !== actorMemberId) {
    await ensureMemberExists(supabaseAdmin, targetMemberId);
  }

  const sourceRaw = normalizeWhitespace(body.source ?? "");
  const source = sourceRaw
    ? sourceRaw.toLowerCase().slice(0, 64)
    : "manager_panel";

  const resolvedEvent = await resolveCanonicalEventId(supabaseAdmin, {
    eventIdInput,
    eventDateInput,
    eventTitleInput,
  });
  const eventId = resolvedEvent.eventId;
  const eventSourceSnapshot = await resolveEventSource(supabaseAdmin, eventId);
  const sourceSheetId = normalizeWhitespace(eventSourceSnapshot.source_sheet_id ?? "") || null;
  const sourceGid = normalizeWhitespace(eventSourceSnapshot.source_gid ?? "") || null;
  const sourceColumn = normalizeWhitespace(eventSourceSnapshot.source_column ?? "") || null;

  const queueRow = await enqueueAttendanceChange(supabaseAdmin, {
    memberId: targetMemberId,
    eventId,
    attendanceRatio: ratio,
    requestedRawValue: rawValue,
    requestedByProfileId: profile.id,
    requestedByLabel: profile.full_name,
    requestNote,
    source,
    sourceSheetId,
    sourceGid,
    sourceColumn,
  });

  await supabaseAdmin.from("change_journal").insert({
    entity_type: "attendance_change_queue",
    entity_id: String(queueRow.id),
    action: "attendance_write_enqueued",
    actor: `profile:${profile.id}`,
    payload: {
      actor_member_id: actorMemberId,
      member_id: targetMemberId,
      is_self_write: isSelfWrite,
      profile_role: profileRole,
      source,
      event_id: eventId,
      attendance_ratio: ratio,
      requested_event_id: eventIdInput || null,
      requested_event_date: eventDateInput,
      requested_event_title: eventTitleInput || null,
      resolved_event_id: eventId,
      event_resolution: resolvedEvent.resolution,
      source_sheet_id: sourceSheetId,
      source_gid: sourceGid,
      source_column: sourceColumn,
      source_row_number: null,
      cell_ref: null,
    },
  });

  return jsonResponse({
    status: "queued",
    queue_id: queueRow.id,
    member_id: targetMemberId,
    actor_member_id: actorMemberId,
    is_self_write: isSelfWrite,
    profile_role: profileRole,
    source,
    requested_event_id: eventIdInput || null,
    event_id: eventId,
    event_resolution: resolvedEvent.resolution,
    attendance_ratio: ratio,
    source_ref: sourceSheetId && sourceGid ? `${sourceSheetId}:${sourceGid}` : null,
    cell_ref: null,
  });
}

async function handleEnqueueBatchMode(
  request: Request,
  body: Record<string, unknown>,
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<Response> {
  const accessToken = parseBearerToken(request.headers.get("authorization"));
  if (!accessToken) {
    throw new HttpError(401, "unauthorized", "Missing Bearer access token.");
  }

  const user = await resolveUserFromToken(accessToken);
  const profile = await loadProfile(supabaseAdmin, user.id);

  const profileRole = normalizeProfileRole(profile.role);
  const hasManagerPrivileges =
    profileRole === "section" || profileRole === "board" || profileRole === "admin";
  if (!hasManagerPrivileges) {
    throw new HttpError(
      403,
      "management_only_write_path",
      "Only section/board/admin can use this write path.",
    );
  }

  const actorMemberId = await resolveMemberIdForProfile(supabaseAdmin, profile);

  const eventIdInput = normalizeWhitespace(body.eventId ?? body.event_id ?? "");
  const eventDateInput = parseEventDateInput(body.eventDate ?? body.event_date ?? body.startsAt ?? body.starts_at);
  const eventTitleInput = normalizeWhitespace(body.eventTitle ?? body.event_title ?? body.title ?? "");
  if (!eventIdInput && !eventDateInput) {
    throw new HttpError(422, "missing_event_id_or_date", "Provide eventId or eventDate.");
  }

  const rawChanges = Array.isArray(body.changes)
    ? body.changes
    : Array.isArray(body.items)
    ? body.items
    : [];

  if (rawChanges.length === 0) {
    throw new HttpError(422, "missing_changes", "Provide non-empty changes array.");
  }
  if (rawChanges.length > 500) {
    throw new HttpError(422, "too_many_changes", "Batch size exceeds limit (500).");
  }

  const requestNoteRaw = normalizeWhitespace(body.requestNote ?? body.note ?? "");
  const requestNote = requestNoteRaw ? requestNoteRaw.slice(0, 500) : null;
  const sourceRaw = normalizeWhitespace(body.source ?? "");
  const source = sourceRaw
    ? sourceRaw.toLowerCase().slice(0, 64)
    : "manager_panel";

  const parsedChanges: Array<{
    memberId: string;
    attendanceRatio: number;
    requestedRawValue: string;
    requestNote: string | null;
  }> = [];

  for (let index = 0; index < rawChanges.length; index += 1) {
    const rawChange = rawChanges[index];
    if (!rawChange || typeof rawChange !== "object") {
      throw new HttpError(
        422,
        "invalid_change_item",
        `changes[${index}] must be an object.`,
      );
    }
    const change = rawChange as Record<string, unknown>;
    const memberId = normalizeWhitespace(change.memberId ?? change.member_id ?? "");
    if (!memberId) {
      throw new HttpError(
        422,
        "missing_member_id",
        `changes[${index}].memberId is required.`,
      );
    }

    const ratioInput = change.attendanceRatio ?? change.attendance_ratio ?? change.value ?? change.attendanceValue;
    const { ratio, rawValue } = parseAttendanceRatioInput(ratioInput);

    const itemNoteRaw = normalizeWhitespace(change.requestNote ?? change.note ?? "");
    const itemNote = itemNoteRaw ? itemNoteRaw.slice(0, 500) : null;

    parsedChanges.push({
      memberId,
      attendanceRatio: ratio,
      requestedRawValue: rawValue,
      requestNote: itemNote ?? requestNote,
    });
  }

  await ensureMembersExist(supabaseAdmin, parsedChanges.map((change) => change.memberId));

  const resolvedEvent = await resolveCanonicalEventId(supabaseAdmin, {
    eventIdInput,
    eventDateInput,
    eventTitleInput,
  });
  const eventId = resolvedEvent.eventId;
  const eventSourceSnapshot = await resolveEventSource(supabaseAdmin, eventId);
  const sourceSheetId = normalizeWhitespace(eventSourceSnapshot.source_sheet_id ?? "") || null;
  const sourceGid = normalizeWhitespace(eventSourceSnapshot.source_gid ?? "") || null;
  const sourceColumn = normalizeWhitespace(eventSourceSnapshot.source_column ?? "") || null;

  const queueRows: QueueRow[] = [];
  for (const change of parsedChanges) {
    const queueRow = await enqueueAttendanceChange(supabaseAdmin, {
      memberId: change.memberId,
      eventId,
      attendanceRatio: change.attendanceRatio,
      requestedRawValue: change.requestedRawValue,
      requestedByProfileId: profile.id,
      requestedByLabel: profile.full_name,
      requestNote: change.requestNote,
      source,
      sourceSheetId,
      sourceGid,
      sourceColumn,
    });
    queueRows.push(queueRow);
  }

  await supabaseAdmin.from("change_journal").insert({
    entity_type: "attendance_change_queue",
    entity_id: `batch:${eventId}:${new Date().toISOString()}`,
    action: "attendance_write_enqueued_batch",
    actor: `profile:${profile.id}`,
    payload: {
      actor_member_id: actorMemberId,
      profile_role: profileRole,
      source,
      event_id: eventId,
      requested_event_id: eventIdInput || null,
      requested_event_date: eventDateInput,
      requested_event_title: eventTitleInput || null,
      resolved_event_id: eventId,
      event_resolution: resolvedEvent.resolution,
      source_sheet_id: sourceSheetId,
      source_gid: sourceGid,
      source_column: sourceColumn,
      change_count: parsedChanges.length,
      member_ids: parsedChanges.map((change) => change.memberId),
      queue_ids: queueRows.map((row) => row.id),
    },
  });

  return jsonResponse({
    status: "queued",
    queued_count: queueRows.length,
    queue_ids: queueRows.map((row) => row.id),
    member_ids: parsedChanges.map((change) => change.memberId),
    actor_member_id: actorMemberId,
    profile_role: profileRole,
    source,
    requested_event_id: eventIdInput || null,
    event_id: eventId,
    event_resolution: resolvedEvent.resolution,
    source_ref: sourceSheetId && sourceGid ? `${sourceSheetId}:${sourceGid}` : null,
    cell_ref: null,
  });
}

async function handleProcessMode(
  request: Request,
  body: Record<string, unknown>,
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<Response> {
  const bearerToken = parseBearerToken(request.headers.get("authorization"));

  if (!WORKER_AUTH_TOKEN) {
    throw new HttpError(
      500,
      "missing_worker_auth_token",
      "ATTENDANCE_WRITE_FUNCTION_AUTH_TOKEN is required for process mode.",
    );
  }

  if (bearerToken !== WORKER_AUTH_TOKEN) {
    throw new HttpError(401, "unauthorized", "Invalid worker bearer token for process mode.");
  }

  const trigger = normalizeWhitespace(body.trigger ?? "manual") || "manual";
  const maxItems = parseProcessInteger(body.maxItems ?? body.max_items, DEFAULT_PROCESS_BATCH_SIZE, 1, 200);
  const maxAttempts = parseProcessInteger(body.maxAttempts ?? body.max_attempts, DEFAULT_MAX_ATTEMPTS, 1, 50);

  const { data: runStart, error: runStartError } = await supabaseAdmin
    .from("sync_runs")
    .insert({
      pipeline_name: "attendance_write_sheet_first",
      status: "running",
      dry_run: false,
      source_kind: "attendance_change_queue",
      source_ref: "queue",
      summary: {
        trigger,
        max_items: maxItems,
        max_attempts: maxAttempts,
      },
    })
    .select("id")
    .single<{ id: string }>();

  if (runStartError || !runStart?.id) {
    throw new HttpError(500, "run_start_failed", runStartError?.message ?? "Failed to start worker run.");
  }

  const runId = runStart.id;

  try {
    const { data: claimedRows, error: claimError } = await supabaseAdmin
      .rpc("claim_attendance_change_queue_items", { max_items: maxItems });

    if (claimError) {
      throw new HttpError(500, "queue_claim_failed", claimError.message);
    }

    const queueRows = (claimedRows ?? []) as QueueRow[];

    let appliedCount = 0;
    let failedCount = 0;
    let deadLetterCount = 0;
    const failures: Array<{ queue_id: number; error: string }> = [];

    for (const queueRow of queueRows) {
      try {
        const coordinates = await resolveSourceCoordinates(supabaseAdmin, queueRow);

        await writeAttendanceViaAppsScript({
          sheetId: coordinates.sourceSheetId,
          gid: coordinates.sourceGid,
          columnRef: coordinates.sourceColumn,
          rowNumber: coordinates.sourceRowNumber,
          attendanceRatio: queueRow.attendance_ratio,
        });

        const { error: updateSuccessError } = await supabaseAdmin
          .from("attendance_change_queue")
          .update({
            status: "applied",
            source_sheet_id: coordinates.sourceSheetId,
            source_gid: coordinates.sourceGid,
            source_column: coordinates.sourceColumn,
            source_row_number: coordinates.sourceRowNumber,
            applied_cell_ref: coordinates.cellRef,
            worker_run_id: runId,
            last_error: null,
            processed_at: new Date().toISOString(),
          })
          .eq("id", queueRow.id);

        if (updateSuccessError) {
          throw new HttpError(500, "queue_update_failed", updateSuccessError.message);
        }

        appliedCount += 1;
      } catch (error) {
        failedCount += 1;
        const errorMessage = sanitizeErrorMessage(error);
        const shouldDeadLetter = queueRow.attempt_count >= maxAttempts;
        const nextStatus = shouldDeadLetter ? "dead_letter" : "queued";
        if (shouldDeadLetter) {
          deadLetterCount += 1;
        }

        await supabaseAdmin
          .from("attendance_change_queue")
          .update({
            status: nextStatus,
            last_error: errorMessage,
            processed_at: new Date().toISOString(),
            worker_run_id: runId,
            claimed_at: null,
            applied_cell_ref: null,
          })
          .eq("id", queueRow.id);

        failures.push({
          queue_id: queueRow.id,
          error: errorMessage,
        });
      }
    }

    const syncTrigger = appliedCount > 0
      ? await maybeTriggerSheetSync()
      : { triggered: false, ok: true, message: "No applied queue rows." };
    const syncTriggerFailed = appliedCount > 0 && !syncTrigger.ok;

    const summary: Record<string, unknown> = {
      trigger,
      claimed_count: queueRows.length,
      applied_count: appliedCount,
      failed_count: failedCount,
      dead_letter_count: deadLetterCount,
      max_attempts: maxAttempts,
      max_items: maxItems,
      allow_cron_sync_fallback: ALLOW_CRON_SYNC_FALLBACK,
      sync_trigger: syncTrigger,
    };

    const finalStatus: "success" | "failed" = failedCount > 0 || syncTriggerFailed ? "failed" : "success";
    const finalErrorSegments: string[] = [];
    if (failedCount > 0) {
      finalErrorSegments.push(`Queue item failures: ${failedCount}`);
    }
    if (syncTriggerFailed) {
      finalErrorSegments.push("Sheet write applied but DB sync trigger failed.");
    }
    const finalErrorMessage = finalErrorSegments.length > 0 ? finalErrorSegments.join(" ") : null;

    const { error: finishError } = await supabaseAdmin
      .from("sync_runs")
      .update({
        status: finalStatus,
        finished_at: new Date().toISOString(),
        summary,
        error_message: finalErrorMessage,
      })
      .eq("id", runId);

    if (finishError) {
      throw new HttpError(500, "run_finish_failed", finishError.message);
    }

    return jsonResponse(
      {
        run_id: runId,
        status: finalStatus,
        summary,
        failures: failures.slice(0, 25),
      },
      finalStatus === "failed" ? 422 : 200,
    );
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    await supabaseAdmin
      .from("sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: message,
      })
      .eq("id", runId);

    throw error;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(request),
    });
  }

  if (request.method !== "POST") {
    return withCors(jsonResponse({ error: "method_not_allowed" }, 405), request);
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new HttpError(
        500,
        "missing_supabase_env",
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
      );
    }

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const mode = normalizeWhitespace(body.mode ?? "enqueue").toLowerCase();
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    if (mode === "process") {
      if (IS_DB_FIRST_MODE) {
        return withCors(jsonResponse({
          status: "skipped",
          mode: "db_first",
          message: "Process mode is disabled in db_first mode.",
        }), request);
      }
      return withCors(await handleProcessMode(request, body, supabaseAdmin), request);
    }

    if (mode === "enqueue_batch") {
      if (IS_DB_FIRST_MODE) {
        return withCors(await handleDbFirstEnqueueBatchMode(request, body, supabaseAdmin), request);
      }
      return withCors(await handleEnqueueBatchMode(request, body, supabaseAdmin), request);
    }

    if (IS_DB_FIRST_MODE) {
      return withCors(await handleDbFirstEnqueueMode(request, body, supabaseAdmin), request);
    }
    return withCors(await handleEnqueueMode(request, body, supabaseAdmin), request);
  } catch (error) {
    if (error instanceof HttpError) {
      return withCors(jsonResponse(
        {
          error: error.code,
          message: error.message,
          details: error.details ?? null,
        },
        error.status,
      ), request);
    }

    return withCors(jsonResponse(
      {
        error: "internal_error",
        message: sanitizeErrorMessage(error),
      },
      500,
    ), request);
  }
});
