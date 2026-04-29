# Attendance Ops Runbook

## Scope

Runbook for the attendance pipeline:

- `sheet_to_supabase_sync` (reference sheet -> DB),
- `attendance_write_sheet_first` (app write path, queue worker),
- `supabase_to_sheet_export` (DB -> copy sheet export).

## Quick Health Checks

```sql
select pipeline_name, status, started_at, finished_at, summary
from public.sync_runs
order by started_at desc
limit 20;
```

```sql
select severity, code, message, source_ref, gid, column_ref, row_number, created_at
from public.sync_issues
order by created_at desc
limit 200;
```

```sql
select status, count(*) as cnt
from public.attendance_change_queue
group by status
order by status;
```

```sql
select id, status, member_id, event_id, attempt_count, last_error, claimed_at, enqueued_at
from public.attendance_change_queue
where status in ('queued', 'processing', 'dead_letter')
order by enqueued_at asc
limit 200;
```

## Common Errors and Actions

### `IDLE_TIMEOUT` (export/sync HTTP)

Meaning:
- Function exceeded request idle limit before response.

Actions:
1. Reduce batch size/concurrency for export (`writeConcurrency` lower value).
2. Run export in pages (`memberOffset`/`memberLimit`) instead of full dataset.
3. Check recent `sync_runs` and function logs for heavy tabs/rows.

### `WORKER_RESOURCE_LIMIT` (export)

Meaning:
- Function ran out of compute/memory budget.

Actions:
1. Lower `writeConcurrency` (for example `4`).
2. Export single event/date first, not full month.
3. Re-run after reducing payload size and verify written cells count in response.

### `apps_script_webhook_failed`

Meaning:
- Supabase function could not complete call to Apps Script webhook.

Actions:
1. Verify Apps Script deployment is live and accessible as Web App.
2. Re-check webhook auth token alignment:
   - `ATTENDANCE_APPS_SCRIPT_WEBHOOK_TOKEN`
   - token expected by Apps Script endpoint.
3. Inspect Apps Script execution logs for stack trace and failing row/column.

### `queue_claim_failed` / `queue_update_failed` / `queue_failure_state_update_failed`

Meaning:
- Queue worker could not claim/update queue rows consistently.

Actions:
1. Confirm function auth secret exists:
   - `ATTENDANCE_WRITE_FUNCTION_AUTH_TOKEN`.
2. Confirm worker cron is installed and running every minute.
3. Check for stale `processing` rows; reclaim is handled by `claim_attendance_change_queue_items` (`020` migration), then re-run worker.

### `missing_worker_auth_token`

Meaning:
- Worker mode called without configured bearer secret.

Actions:
1. Set `ATTENDANCE_WRITE_FUNCTION_AUTH_TOKEN` in Supabase secrets.
2. Re-deploy `attendance_write_sheet_first`.
3. Recreate cron job with correct bearer token if needed.

### `management_only_write_path`

Meaning:
- Caller is not `section`, `board`, or `admin`.

Actions:
1. Verify role in `public.profiles.role`.
2. Use role management screen or admin RPC to adjust role.

## Warnings in `sync_issues`

Most warning codes are non-blocking parser normalizations (`event_year_inferred`, `event_date_token_swapped_day_month`, etc.).

Treat as actionable only when one of these appears:

- `missing_date_token`
- repeated `unexpected_header_prefix`

Recommended action:
1. Add/update `ATTENDANCE_EVENT_DATE_OVERRIDES_JSON` for immutable header anomalies.
2. Re-run manual sync and confirm `attendance_entries_skipped_due_to_invalid_events = 0`.

## Required Runtime Baseline

Supabase secrets:

- `SHEET_SYNC_FUNCTION_AUTH_TOKEN`
- `ATTENDANCE_WRITE_FUNCTION_AUTH_TOKEN`
- `ATTENDANCE_EXPORT_TARGET_SHEET_ID`
- `ATTENDANCE_WRITE_SOURCE_MODE=db_first`
- `ATTENDANCE_WRITE_TRIGGER_DB_EXPORT=true`
- `DB_TO_SHEET_EXPORT_URL`
- `DB_TO_SHEET_EXPORT_AUTH_TOKEN` (or `DB_TO_SHEET_EXPORT_TOKEN`)

GitHub (for smoke workflow):

- secret: `SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN`
- variable: `SUPABASE_PROJECT_REF`
- optional variable: `SMOKE_REQUIRE_EXPORT_TRIGGER_OK`

## Regression Gate After Any Change

1. `npm run typecheck` in `app`.
2. Trigger `smoke_attendance_db_first` (manual curl or GitHub workflow).
3. Verify smoke returns `status=ok` and restores original attendance value.
4. Check `sync_runs` terminal status and absence of new critical errors.
