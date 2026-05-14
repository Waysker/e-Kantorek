import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type SupabaseAdminClient = SupabaseClient<any, "public", any>;

type SyncRunRow = {
  id: number | string;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
  summary: Record<string, unknown> | null;
};

type QueueRow = {
  id: number | string;
  member_id: string | null;
  event_id: string | null;
  claimed_at: string | null;
  attempt_count: number | null;
  last_error: string | null;
  enqueued_at: string | null;
  processed_at: string | null;
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
const HEALTH_CHECK_AUTH_TOKEN = Deno.env.get("ATTENDANCE_HEALTH_CHECK_FUNCTION_AUTH_TOKEN");

const DEFAULT_FAILURE_WINDOW_MINUTES = 150;
const DEFAULT_STALE_PROCESSING_MINUTES = 15;
const DEFAULT_ROW_LIMIT = 20;

function normalizeWhitespace(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
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

function parsePositiveInteger(rawValue: unknown, fallback: number): number {
  if (typeof rawValue === "number" && Number.isInteger(rawValue) && rawValue > 0) {
    return rawValue;
  }
  if (typeof rawValue === "string") {
    const parsed = Number(normalizeWhitespace(rawValue));
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function createSupabaseAdminClient(): SupabaseAdminClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(
      500,
      "missing_supabase_env",
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
    );
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

async function loadRecentFailedSyncRuns(
  supabaseAdmin: SupabaseAdminClient,
  failureWindowMinutes: number,
  rowLimit: number,
): Promise<SyncRunRow[]> {
  const cutoffIso = minutesAgoIso(failureWindowMinutes);
  const { data, error } = await supabaseAdmin
    .from("sync_runs")
    .select("id,started_at,finished_at,error_message,summary")
    .eq("pipeline_name", "sheet_to_supabase_sync")
    .eq("status", "failed")
    .gte("started_at", cutoffIso)
    .order("started_at", { ascending: false })
    .limit(rowLimit)
    .returns<SyncRunRow[]>();

  if (error) {
    throw new HttpError(500, "sync_runs_load_failed", error.message);
  }

  return data ?? [];
}

async function loadDeadLetterRows(
  supabaseAdmin: SupabaseAdminClient,
  rowLimit: number,
): Promise<QueueRow[]> {
  const { data, error } = await supabaseAdmin
    .from("attendance_change_queue")
    .select("id,member_id,event_id,claimed_at,attempt_count,last_error,enqueued_at,processed_at")
    .eq("status", "dead_letter")
    .order("processed_at", { ascending: false })
    .limit(rowLimit)
    .returns<QueueRow[]>();

  if (error) {
    throw new HttpError(500, "dead_letter_load_failed", error.message);
  }

  return data ?? [];
}

async function loadStaleProcessingRows(
  supabaseAdmin: SupabaseAdminClient,
  staleWindowMinutes: number,
  rowLimit: number,
): Promise<QueueRow[]> {
  const cutoffIso = minutesAgoIso(staleWindowMinutes);
  const { data, error } = await supabaseAdmin
    .from("attendance_change_queue")
    .select("id,member_id,event_id,claimed_at,attempt_count,last_error,enqueued_at,processed_at")
    .eq("status", "processing")
    .lt("claimed_at", cutoffIso)
    .order("claimed_at", { ascending: true })
    .limit(rowLimit)
    .returns<QueueRow[]>();

  if (error) {
    throw new HttpError(500, "stale_processing_load_failed", error.message);
  }

  return data ?? [];
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    if (!HEALTH_CHECK_AUTH_TOKEN) {
      throw new HttpError(
        500,
        "missing_auth_token_env",
        "ATTENDANCE_HEALTH_CHECK_FUNCTION_AUTH_TOKEN is required.",
      );
    }

    const token = parseBearerToken(request.headers.get("authorization"));
    if (token !== HEALTH_CHECK_AUTH_TOKEN) {
      throw new HttpError(401, "unauthorized", "Invalid bearer token.");
    }

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const failureWindowMinutes = parsePositiveInteger(
      body.failureWindowMinutes ?? body.failure_window_minutes,
      DEFAULT_FAILURE_WINDOW_MINUTES,
    );
    const staleProcessingMinutes = parsePositiveInteger(
      body.staleProcessingMinutes ?? body.stale_processing_minutes,
      DEFAULT_STALE_PROCESSING_MINUTES,
    );
    const rowLimit = parsePositiveInteger(body.rowLimit ?? body.row_limit, DEFAULT_ROW_LIMIT);

    const supabaseAdmin = createSupabaseAdminClient();

    const [recentFailedSyncRuns, deadLetterRows, staleProcessingRows] = await Promise.all([
      loadRecentFailedSyncRuns(supabaseAdmin, failureWindowMinutes, rowLimit),
      loadDeadLetterRows(supabaseAdmin, rowLimit),
      loadStaleProcessingRows(supabaseAdmin, staleProcessingMinutes, rowLimit),
    ]);

    const issues: Array<Record<string, unknown>> = [];

    if (recentFailedSyncRuns.length > 0) {
      issues.push({
        code: "recent_failed_sheet_sync_runs",
        severity: "error",
        count: recentFailedSyncRuns.length,
        window_minutes: failureWindowMinutes,
      });
    }

    if (deadLetterRows.length > 0) {
      issues.push({
        code: "dead_letter_queue_entries_present",
        severity: "error",
        count: deadLetterRows.length,
      });
    }

    if (staleProcessingRows.length > 0) {
      issues.push({
        code: "stale_processing_queue_entries_present",
        severity: "error",
        count: staleProcessingRows.length,
        stale_window_minutes: staleProcessingMinutes,
      });
    }

    const status = issues.length === 0 ? "ok" : "fail";
    return jsonResponse({
      status,
      checked_at: new Date().toISOString(),
      thresholds: {
        failure_window_minutes: failureWindowMinutes,
        stale_processing_minutes: staleProcessingMinutes,
        row_limit: rowLimit,
      },
      counts: {
        recent_failed_sheet_to_supabase_sync_runs: recentFailedSyncRuns.length,
        dead_letter_count: deadLetterRows.length,
        stale_processing_count: staleProcessingRows.length,
      },
      issues,
      details: {
        recent_failed_sheet_to_supabase_sync_runs: recentFailedSyncRuns,
        dead_letter_rows: deadLetterRows,
        stale_processing_rows: staleProcessingRows,
      },
    });
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
