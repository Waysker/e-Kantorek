import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type SupabaseAdminClient = SupabaseClient<any, "public", any>;

type ProfileRow = {
  id: string;
  full_name: string | null;
  role: string | null;
};

type AppAttendanceEntryRow = {
  attendance_ratio: number;
  recorded_by_profile_id: string | null;
  source: string | null;
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

const SMOKE_AUTH_TOKEN = Deno.env.get("SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN");
const SMOKE_TEST_EMAIL =
  normalizeWhitespace(Deno.env.get("SMOKE_ATTENDANCE_TEST_EMAIL") ?? "") ||
  normalizeWhitespace(Deno.env.get("SMOKE_TEST_EMAIL") ?? "");
const SMOKE_TEST_PASSWORD =
  normalizeWhitespace(Deno.env.get("SMOKE_ATTENDANCE_TEST_PASSWORD") ?? "") ||
  normalizeWhitespace(Deno.env.get("SMOKE_TEST_PASSWORD") ?? "");
// The smoke test never touches real attendance: it writes to its own fixture
// event and member, which the app hides (the member is inactive, the event is not
// from the forum, not a rehearsal and not in any sheet), skips the copy-sheet
// export and deletes what it wrote. See docs/reference/attendance-model.md.
const SMOKE_EVENT_ID = "evt-smoke-fixture";
const SMOKE_EVENT_DATE = "2000-01-01";
const SMOKE_MEMBER_ID = "member-smoke-fixture";
const SMOKE_TEMPORARY_RATIO = 0.5;
const DEFAULT_CHECK_SYNC_CONTRACT = parseBooleanEnv(
  Deno.env.get("SMOKE_ATTENDANCE_CHECK_SYNC_CONTRACT"),
  false,
);
const SMOKE_SYNC_MAX_WARNINGS_RAW = normalizeWhitespace(Deno.env.get("SMOKE_SYNC_MAX_WARNINGS") ?? "");
const SMOKE_SYNC_FORBID_WARNING_CODES = parseWarningCodeList(
  Deno.env.get("SMOKE_SYNC_FORBID_WARNING_CODES"),
);
const ATTENDANCE_WRITE_FUNCTION_URL =
  normalizeWhitespace(Deno.env.get("SMOKE_ATTENDANCE_WRITE_FUNCTION_URL") ?? "") ||
  normalizeWhitespace(Deno.env.get("EXPO_PUBLIC_ATTENDANCE_WRITE_FUNCTION_URL") ?? "");
const SHEET_SYNC_FUNCTION_URL =
  normalizeWhitespace(Deno.env.get("SMOKE_SHEET_SYNC_FUNCTION_URL") ?? "");

function normalizeWhitespace(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
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

function parseBooleanInput(rawValue: unknown, fallback: boolean): boolean {
  return parseBooleanEnv(normalizeWhitespace(rawValue), fallback);
}

function parseWarningCodeList(rawValue: string | undefined): string[] {
  const normalized = normalizeWhitespace(rawValue ?? "");
  if (!normalized) {
    return [];
  }

  const uniqueCodes = new Set<string>();
  for (const chunk of normalized.split(",")) {
    const code = normalizeWhitespace(chunk).toLowerCase();
    if (!code) continue;
    uniqueCodes.add(code);
  }

  return Array.from(uniqueCodes);
}

function parseNonNegativeInteger(value: unknown): number | null {
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 0) return value;
    return null;
  }

  if (typeof value === "string") {
    const normalized = normalizeWhitespace(value);
    if (!normalized) return null;
    const parsed = Number(normalized);
    if (!Number.isInteger(parsed) || parsed < 0) return null;
    return parsed;
  }

  return null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseOptionalMaxWarningsThreshold(): number | null {
  if (!SMOKE_SYNC_MAX_WARNINGS_RAW) {
    return null;
  }

  const parsed = Number(SMOKE_SYNC_MAX_WARNINGS_RAW);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HttpError(
      500,
      "invalid_smoke_sync_max_warnings_env",
      "SMOKE_SYNC_MAX_WARNINGS must be a non-negative integer when set.",
      { value: SMOKE_SYNC_MAX_WARNINGS_RAW },
    );
  }

  return parsed;
}

function parseWarningBreakdownCandidate(value: unknown): Map<string, number> | null {
  if (Array.isArray(value)) {
    const counts = new Map<string, number>();
    for (const item of value) {
      const asRecord = toRecord(item);
      if (!asRecord) continue;
      const code = normalizeWhitespace(
        asRecord.code ?? asRecord.warning_code ?? asRecord.name ?? "",
      ).toLowerCase();
      if (!code) continue;
      const count = parseNonNegativeInteger(asRecord.count ?? asRecord.cnt ?? asRecord.total ?? 1) ?? 1;
      counts.set(code, (counts.get(code) ?? 0) + count);
    }
    return counts.size > 0 ? counts : null;
  }

  const asRecord = toRecord(value);
  if (!asRecord) {
    return null;
  }

  const counts = new Map<string, number>();
  for (const [rawCode, rawCount] of Object.entries(asRecord)) {
    const code = normalizeWhitespace(rawCode).toLowerCase();
    if (!code) continue;
    const count = parseNonNegativeInteger(rawCount);
    if (count === null) continue;
    counts.set(code, count);
  }

  return counts.size > 0 ? counts : null;
}

function extractWarningBreakdown(
  payload: Record<string, unknown>,
  summary: Record<string, unknown>,
): Map<string, number> | null {
  const candidates: unknown[] = [
    summary.warning_breakdown,
    summary.warnings_breakdown,
    summary.warning_code_counts,
    summary.warnings_by_code,
    summary.warning_counts_by_code,
    payload.warning_breakdown,
    payload.warnings_breakdown,
    payload.warning_code_counts,
    payload.warnings_by_code,
    payload.warning_counts_by_code,
  ];

  for (const candidate of candidates) {
    const parsed = parseWarningBreakdownCandidate(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function parseBearerToken(headerValue: string | null): string | null {
  const normalized = normalizeWhitespace(headerValue ?? "");
  if (!normalized) {
    return null;
  }
  const match = normalized.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizeRole(rawRole: string | null): "member" | "section" | "board" | "admin" {
  const normalized = normalizeWhitespace(rawRole ?? "").toLowerCase();
  if (normalized === "admin") return "admin";
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
  if (normalized === "board" || normalized === "zarzad" || normalized === "zarząd") {
    return "board";
  }
  return "member";
}

function deriveAttendanceWriteFunctionUrl(supabaseUrl: string): string {
  const base = new URL(supabaseUrl);
  const projectRef = base.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i)?.[1];
  if (projectRef) {
    return `https://${projectRef}.functions.supabase.co/attendance_write_sheet_first`;
  }
  return `${base.origin}/functions/v1/attendance_write_sheet_first`;
}

function deriveSheetSyncFunctionUrl(supabaseUrl: string): string {
  const base = new URL(supabaseUrl);
  const projectRef = base.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i)?.[1];
  if (projectRef) {
    return `https://${projectRef}.functions.supabase.co/sheet_to_supabase_sync`;
  }
  return `${base.origin}/functions/v1/sheet_to_supabase_sync`;
}

async function callAttendanceWrite(params: {
  functionUrl: string;
  jwt: string;
  eventId: string;
  memberId: string;
  attendanceRatio: number;
  requestNote: string;
  runTag: string;
}): Promise<Record<string, unknown>> {
  const response = await fetch(params.functionUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "enqueue_batch",
      eventId: params.eventId,
      source: "smoke_attendance_db_first",
      requestNote: params.requestNote,
      changes: [{
        memberId: params.memberId,
        attendanceRatio: params.attendanceRatio,
      }],
      smokeRunTag: params.runTag,
      skipSheetExport: true,
    }),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new HttpError(
      502,
      "attendance_write_call_failed",
      `attendance_write_sheet_first failed (${response.status}).`,
      {
        response_status: response.status,
        response_payload: payload,
      },
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new HttpError(502, "attendance_write_invalid_payload", "attendance_write_sheet_first returned invalid JSON payload.");
  }

  return payload as Record<string, unknown>;
}

type SyncContractCheckResult = {
  http_status: number;
  run_id: string;
  status: "dry_run" | "success" | "failed";
  dry_run: boolean;
  errors_count: number;
  attendance_entries_skipped_due_to_invalid_events: number;
  attendance_entries_skipped_due_to_invalid_events_inferred: boolean;
  warnings_count: number | null;
  warning_breakdown_available: boolean;
};

async function verifySheetSyncContract(params: {
  functionUrl: string;
  functionAuthToken: string;
  runTag: string;
  maxWarnings: number | null;
  forbiddenWarningCodes: string[];
}): Promise<SyncContractCheckResult> {
  const response = await fetch(params.functionUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.functionAuthToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      trigger: "smoke_contract",
      dryRun: true,
      smokeRunTag: params.runTag,
    }),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.status !== 200 && response.status !== 422) {
    throw new HttpError(
      502,
      "sync_contract_http_status_unexpected",
      `sheet_to_supabase_sync returned unexpected status ${response.status}.`,
      {
        response_status: response.status,
        response_payload: payload,
      },
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new HttpError(
      502,
      "sync_contract_invalid_payload",
      "sheet_to_supabase_sync returned invalid JSON payload.",
      { response_status: response.status },
    );
  }

  const asRecord = payload as Record<string, unknown>;
  const runId = normalizeWhitespace(asRecord.run_id ?? "");
  const status = normalizeWhitespace(asRecord.status ?? "");
  const dryRun = asRecord.dry_run;
  const summary = asRecord.summary;

  if (!runId) {
    throw new HttpError(502, "sync_contract_missing_run_id", "sheet_to_supabase_sync payload missing run_id.", {
      response_payload: payload,
    });
  }

  if (status !== "dry_run" && status !== "success" && status !== "failed") {
    throw new HttpError(502, "sync_contract_invalid_status", `Unexpected sync status: ${status || "empty"}.`, {
      response_payload: payload,
    });
  }

  if (dryRun !== true) {
    throw new HttpError(502, "sync_contract_invalid_dry_run", "Expected dry_run=true in sync contract smoke response.", {
      response_payload: payload,
    });
  }

  if (!summary || typeof summary !== "object") {
    throw new HttpError(502, "sync_contract_missing_summary", "Sync response is missing summary object.", {
      response_payload: payload,
    });
  }

  const summaryRecord = summary as Record<string, unknown>;
  const errorsCount = parseNonNegativeInteger(summaryRecord.errors_count);
  if (errorsCount === null) {
    throw new HttpError(
      502,
      "sync_quality_missing_errors_count",
      "Sync summary is missing numeric errors_count.",
      { response_payload: payload },
    );
  }
  if (errorsCount !== 0) {
    throw new HttpError(
      502,
      "sync_quality_errors_count_not_zero",
      `Sync summary errors_count must be 0, got ${errorsCount}.`,
      { errors_count: errorsCount, response_payload: payload },
    );
  }

  const skippedInvalidEventsCountRaw = parseNonNegativeInteger(
    summaryRecord.attendance_entries_skipped_due_to_invalid_events,
  );
  const skippedInvalidEventsCountInferred = skippedInvalidEventsCountRaw === null && status === "dry_run";
  const skippedInvalidEventsCount = skippedInvalidEventsCountRaw ?? (skippedInvalidEventsCountInferred ? 0 : null);
  if (skippedInvalidEventsCount === null) {
    throw new HttpError(
      502,
      "sync_quality_missing_skipped_invalid_events_count",
      "Sync summary is missing numeric attendance_entries_skipped_due_to_invalid_events.",
      { response_payload: payload },
    );
  }
  if (skippedInvalidEventsCount !== 0) {
    throw new HttpError(
      502,
      "sync_quality_skipped_invalid_events_not_zero",
      "Sync summary attendance_entries_skipped_due_to_invalid_events must be 0.",
      {
        attendance_entries_skipped_due_to_invalid_events: skippedInvalidEventsCount,
        response_payload: payload,
      },
    );
  }

  const warningsCount = parseNonNegativeInteger(summaryRecord.warnings_count);
  if (params.maxWarnings !== null) {
    if (warningsCount === null) {
      throw new HttpError(
        502,
        "sync_quality_missing_warnings_count",
        "Sync summary is missing numeric warnings_count required by SMOKE_SYNC_MAX_WARNINGS.",
        { response_payload: payload, max_warnings: params.maxWarnings },
      );
    }
    if (warningsCount > params.maxWarnings) {
      throw new HttpError(
        502,
        "sync_quality_warnings_count_exceeded",
        `Sync summary warnings_count=${warningsCount} exceeds SMOKE_SYNC_MAX_WARNINGS=${params.maxWarnings}.`,
        { warnings_count: warningsCount, max_warnings: params.maxWarnings, response_payload: payload },
      );
    }
  }

  const warningBreakdown = extractWarningBreakdown(asRecord, summaryRecord);
  if (params.forbiddenWarningCodes.length > 0 && warningBreakdown) {
    const offending = params.forbiddenWarningCodes
      .map((code) => ({
        code,
        count: warningBreakdown.get(code) ?? 0,
      }))
      .filter((entry) => entry.count > 0);

    if (offending.length > 0) {
      throw new HttpError(
        502,
        "sync_quality_forbidden_warning_codes_present",
        "Sync warning breakdown contains forbidden warning codes.",
        {
          forbidden_warning_codes: params.forbiddenWarningCodes,
          offending_warning_codes: offending,
          response_payload: payload,
        },
      );
    }
  }

  return {
    http_status: response.status,
    run_id: runId,
    status,
    dry_run: true,
    errors_count: errorsCount,
    attendance_entries_skipped_due_to_invalid_events: skippedInvalidEventsCount,
    attendance_entries_skipped_due_to_invalid_events_inferred: skippedInvalidEventsCountInferred,
    warnings_count: warningsCount,
    warning_breakdown_available: !!warningBreakdown,
  };
}

async function loadProfile(
  supabaseAdmin: SupabaseAdminClient,
  profileId: string,
): Promise<ProfileRow> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id,full_name,role")
    .eq("id", profileId)
    .maybeSingle<ProfileRow>();
  if (error) {
    throw new HttpError(500, "profile_load_failed", error.message);
  }
  if (!data) {
    throw new HttpError(404, "profile_not_found", `Profile not found for id=${profileId}.`);
  }
  return data;
}

async function ensureSmokeFixtures(supabaseAdmin: SupabaseAdminClient): Promise<void> {
  const { error: memberError } = await supabaseAdmin.from("members").upsert({
    member_id: SMOKE_MEMBER_ID,
    first_name: "Smoke",
    last_name: "Test",
    full_name: "Smoke Test",
    instrument: "Test",
    is_active: false,
  }, { onConflict: "member_id" });
  if (memberError) {
    throw new HttpError(500, "smoke_fixture_member_failed", memberError.message);
  }

  const { error: eventError } = await supabaseAdmin.from("events").upsert({
    event_id: SMOKE_EVENT_ID,
    title: "Smoke test",
    event_date: SMOKE_EVENT_DATE,
  }, { onConflict: "event_id" });
  if (eventError) {
    throw new HttpError(500, "smoke_fixture_event_failed", eventError.message);
  }
}

async function loadAppEntry(supabaseAdmin: SupabaseAdminClient): Promise<AppAttendanceEntryRow | null> {
  const { data, error } = await supabaseAdmin
    .from("app_attendance_entries")
    .select("attendance_ratio,recorded_by_profile_id,source")
    .eq("event_id", SMOKE_EVENT_ID)
    .eq("member_id", SMOKE_MEMBER_ID)
    .maybeSingle<AppAttendanceEntryRow>();
  if (error) {
    throw new HttpError(500, "smoke_app_entry_load_failed", error.message);
  }
  return data ?? null;
}

async function countSheetEntries(supabaseAdmin: SupabaseAdminClient): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("attendance_entries")
    .select("member_id", { count: "exact", head: true })
    .eq("event_id", SMOKE_EVENT_ID);
  if (error) {
    throw new HttpError(500, "smoke_sheet_entries_load_failed", error.message);
  }
  return count ?? 0;
}

// Removes the fixture's app entry and its journal rows, so the board's "Ostatnie
// zapisy" list and the app-side summary never show the smoke run.
async function cleanUpSmokeWrites(supabaseAdmin: SupabaseAdminClient): Promise<void> {
  const { error: entryError } = await supabaseAdmin
    .from("app_attendance_entries")
    .delete()
    .eq("event_id", SMOKE_EVENT_ID);
  if (entryError) {
    throw new HttpError(500, "smoke_cleanup_entry_failed", entryError.message);
  }
  const { error: journalError } = await supabaseAdmin
    .from("change_journal")
    .delete()
    .eq("entity_type", "app_attendance_entries")
    .eq("entity_id", SMOKE_EVENT_ID);
  if (journalError) {
    throw new HttpError(500, "smoke_cleanup_journal_failed", journalError.message);
  }
}

function almostEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.0001;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new HttpError(500, "missing_supabase_env", "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
    }
    if (!SUPABASE_ANON_KEY) {
      throw new HttpError(500, "missing_anon_key_env", "SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY) is required.");
    }
    if (!SMOKE_TEST_EMAIL || !SMOKE_TEST_PASSWORD) {
      throw new HttpError(
        500,
        "missing_smoke_user_credentials",
        "SMOKE_ATTENDANCE_TEST_EMAIL and SMOKE_ATTENDANCE_TEST_PASSWORD are required.",
      );
    }
    // The smoke run writes to the database, so it is never open to anonymous calls.
    if (!SMOKE_AUTH_TOKEN) {
      throw new HttpError(500, "missing_smoke_auth_token", "SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN is required.");
    }
    const token = parseBearerToken(request.headers.get("authorization"));
    if (token !== SMOKE_AUTH_TOKEN) {
      throw new HttpError(401, "unauthorized", "Invalid bearer token.");
    }

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const checkSyncContract = parseBooleanInput(
      body.checkSyncContract ?? body.check_sync_contract,
      DEFAULT_CHECK_SYNC_CONTRACT,
    );
    const runTag = `smoke_attendance_db_first:${crypto.randomUUID()}`;

    const attendanceWriteUrl = ATTENDANCE_WRITE_FUNCTION_URL || deriveAttendanceWriteFunctionUrl(SUPABASE_URL);
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: signInData, error: signInError } = await supabaseAuth.auth.signInWithPassword({
      email: SMOKE_TEST_EMAIL,
      password: SMOKE_TEST_PASSWORD,
    });
    if (signInError || !signInData.session?.access_token || !signInData.user?.id) {
      throw new HttpError(
        401,
        "smoke_sign_in_failed",
        `Smoke user sign-in failed: ${signInError?.message ?? "missing_session"}.`,
      );
    }

    const jwt = signInData.session.access_token;
    const profile = await loadProfile(supabaseAdmin, signInData.user.id);
    const role = normalizeRole(profile.role);
    if (!["board", "admin"].includes(role)) {
      throw new HttpError(
        403,
        "smoke_user_not_board",
        `Smoke user role must be board/admin (the only roles that write attendance), got ${role}.`,
      );
    }

    await ensureSmokeFixtures(supabaseAdmin);
    await cleanUpSmokeWrites(supabaseAdmin);
    const sheetEntriesBefore = await countSheetEntries(supabaseAdmin);

    try {
      const writePayload = await callAttendanceWrite({
        functionUrl: attendanceWriteUrl,
        jwt,
        eventId: SMOKE_EVENT_ID,
        memberId: SMOKE_MEMBER_ID,
        attendanceRatio: SMOKE_TEMPORARY_RATIO,
        requestNote: `${runTag}:write`,
        runTag,
      });

      if (writePayload.mode !== "db_first" || writePayload.status !== "applied") {
        throw new HttpError(
          502,
          "unexpected_write_response",
          `Expected mode=db_first/status=applied, got mode=${String(writePayload.mode)} status=${String(writePayload.status)}.`,
          { write_payload: writePayload },
        );
      }
      if (writePayload.event_id !== SMOKE_EVENT_ID) {
        throw new HttpError(
          500,
          "smoke_wrong_event",
          `Write resolved to ${String(writePayload.event_id)} instead of the fixture event.`,
        );
      }

      const written = await loadAppEntry(supabaseAdmin);
      if (!written || !almostEqual(Number(written.attendance_ratio), SMOKE_TEMPORARY_RATIO)) {
        throw new HttpError(
          500,
          "smoke_app_entry_mismatch",
          `Expected app entry ratio=${SMOKE_TEMPORARY_RATIO}, got ${written ? written.attendance_ratio : "none"}.`,
        );
      }
      if (written.recorded_by_profile_id !== profile.id) {
        throw new HttpError(500, "smoke_recorded_by_mismatch", "App entry does not name the smoke user as its author.");
      }

      const sheetEntriesAfter = await countSheetEntries(supabaseAdmin);
      if (sheetEntriesAfter !== sheetEntriesBefore) {
        throw new HttpError(
          500,
          "smoke_touched_sheet_data",
          "The app write changed attendance_entries (original sheet data).",
        );
      }

      let syncContractCheck: SyncContractCheckResult | null = null;
      if (checkSyncContract) {
        const sheetSyncFunctionAuthToken = normalizeWhitespace(Deno.env.get("SHEET_SYNC_FUNCTION_AUTH_TOKEN") ?? "");
        if (!sheetSyncFunctionAuthToken) {
          throw new HttpError(
            500,
            "missing_sheet_sync_auth_token",
            "SHEET_SYNC_FUNCTION_AUTH_TOKEN is required for sync contract smoke check.",
          );
        }

        const sheetSyncUrl = SHEET_SYNC_FUNCTION_URL || deriveSheetSyncFunctionUrl(SUPABASE_URL);
        const maxWarnings = parseOptionalMaxWarningsThreshold();
        syncContractCheck = await verifySheetSyncContract({
          functionUrl: sheetSyncUrl,
          functionAuthToken: sheetSyncFunctionAuthToken,
          runTag,
          maxWarnings,
          forbiddenWarningCodes: SMOKE_SYNC_FORBID_WARNING_CODES,
        });
      }

      await cleanUpSmokeWrites(supabaseAdmin);
      const leftover = await loadAppEntry(supabaseAdmin);

      return jsonResponse({
        status: leftover ? "cleanup_failed" : "ok",
        smoke_run_tag: runTag,
        mode: "db_first",
        event_id: SMOKE_EVENT_ID,
        member_id: SMOKE_MEMBER_ID,
        actor_profile_id: profile.id,
        actor_role: role,
        written_ratio: SMOKE_TEMPORARY_RATIO,
        export_trigger: writePayload.export_trigger ?? null,
        sheet_data_untouched: true,
        cleaned_up: !leftover,
        check_sync_contract: checkSyncContract,
        sync_contract_check: syncContractCheck,
      }, leftover ? 500 : 200);
    } catch (error) {
      try {
        await cleanUpSmokeWrites(supabaseAdmin);
      } catch {
        // Best effort; the next run cleans up before writing.
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({
        error: error.code,
        message: error.message,
        details: error.details ?? null,
      }, error.status);
    }

    return jsonResponse({
      error: "internal_error",
      message: sanitizeErrorMessage(error),
    }, 500);
  }
});
