# Function Errors Runbook

## Scope

This runbook maps common error codes/responses from attendance functions to concrete remediation steps.

Covered functions:

- `sheet_to_supabase_sync`
- `attendance_write_sheet_first`
- `supabase_to_sheet_export`
- `smoke_attendance_db_first`

## Quick Triage Order

1. Verify latest runs:

```sql
select pipeline_name, status, started_at, finished_at, error_message, summary
from public.sync_runs
order by started_at desc
limit 20;
```

2. Verify parser/runtime issues:

```sql
select
  i.severity,
  i.code,
  i.message,
  r.source_ref,
  i.column_ref,
  i.row_number,
  i.created_at
from public.sync_issues i
left join public.sync_runs r on r.id = i.run_id
order by i.created_at desc
limit 200;
```

3. Verify queue health:

```sql
select status, count(*) as cnt
from public.attendance_change_queue
group by status
order by status;
```

## Error Matrix

| Function | Error / Code | Meaning | Action |
|---|---|---|---|
| `sheet_to_supabase_sync` | `missing_sheet_source` | Function has no sheet source configuration. | Set `ATTENDANCE_SHEET_ID` or `ATTENDANCE_SHEET_SOURCES_JSON`; if auto-discovery is intended, set `ATTENDANCE_SHEET_AUTO_DISCOVER_SOURCES=true` and `ATTENDANCE_SHEET_ID`. |
| `sheet_to_supabase_sync` | `invalid_source_offset` | `sourceOffset` is not a non-negative integer. | Pass integer `>=0` or remove parameter. |
| `sheet_to_supabase_sync` | `invalid_source_limit` | `sourceLimit` is not a positive integer. | Pass integer `>0` or remove parameter. |
| `sheet_to_supabase_sync` | `unauthorized` | Missing/invalid bearer token. | Use `SHEET_SYNC_FUNCTION_AUTH_TOKEN`; verify cron payload uses the same token. |
| `sheet_to_supabase_sync` | `run_start_failed` | Could not create `sync_runs` row. | Check DB connectivity/service key env and table grants. |
| `sheet_to_supabase_sync` | `no_attendance_sources_processed` | All discovered tabs were skipped as non-attendance layout. | Validate tab layout against contract; pin explicit `ATTENDANCE_SHEET_SOURCES_JSON` for attendance tabs. |
| `sheet_to_supabase_sync` | `missing_date_token` warning | Header column has no parseable event date. | Add entry to `ATTENDANCE_EVENT_DATE_OVERRIDES_JSON` for `{sourceRef,columnRef,eventDate,title}`. |
| `sheet_to_supabase_sync` | `unexpected_header_prefix` warning | Expected `B` header (`L.p.`) is missing/changed. | Confirm source sheet schema; if immutable legacy sheet, keep monitored and document exception in runbook. |
| `attendance_write_sheet_first` | `management_only_write_path` | Caller role cannot write attendance. | Ensure profile role is one of `section`/`board`/`admin`; role changes only via admin flow. |
| `attendance_write_sheet_first` | `missing_worker_auth_token` | Worker/process mode auth secret is missing. | Set `ATTENDANCE_WRITE_FUNCTION_AUTH_TOKEN` in Supabase secrets and re-deploy function. |
| `attendance_write_sheet_first` | `queue_claim_failed` | Worker could not claim queued rows. | Verify queue RPC exists (`020` migration+), auth, and DB health; retry process mode. |
| `attendance_write_sheet_first` | `queue_update_failed` | Queue row could not be marked `done`. | Check row lock contention / DB error in logs, then re-run worker. |
| `attendance_write_sheet_first` | `queue_failure_state_update_failed` | Worker failed while persisting failure state. | Treat as critical; inspect function logs immediately and fix DB write path before retries. |
| `attendance_write_sheet_first` | `invalid_batch_enqueue_payload` | Payload missing required fields or invalid changes list. | Ensure `mode=enqueue_batch`, valid `eventId`, and non-empty `changes[{memberId,attendanceRatio}]`. |
| `supabase_to_sheet_export` | `missing_target_sheet_id` | No export target configured. | Set `ATTENDANCE_EXPORT_TARGET_SHEET_ID` in Supabase secrets. |
| `supabase_to_sheet_export` | `unauthorized` | Missing/invalid export bearer token. | Use `DB_TO_SHEET_EXPORT_AUTH_TOKEN` (or `DB_TO_SHEET_EXPORT_TOKEN`) consistently in trigger and function config. |
| `supabase_to_sheet_export` | `apps_script_webhook_failed` | Apps Script endpoint returned non-2xx or failure payload. | Verify web app deployment URL/token, inspect Apps Script execution logs, retry with lower write concurrency. |
| `supabase_to_sheet_export` | `events_load_failed` / `attendance_entries_load_failed` / `members_load_failed` | Export query failure in DB. | Check table indexes/migrations, service key, and SQL logs for failing relation/permission. |
| `smoke_attendance_db_first` | `smoke_write_no_session` | Smoke test sign-in failed (no auth session). | Verify smoke user email/password secrets in Supabase. |
| `smoke_attendance_db_first` | `smoke_write_failed` | Attendance write call in smoke failed. | Check write function logs and role of smoke user (`section`/`board`/`admin`). |
| `smoke_attendance_db_first` | `smoke_write_not_applied` | Expected row value was not changed by smoke write. | Validate fixed smoke target (`event_id`,`member_id`) and queue worker/export path. |
| `smoke_attendance_db_first` | `smoke_rollback_failed` | Smoke could not restore original value. | Immediate manual rollback in DB, then fix function and rerun smoke. |
| `smoke_attendance_db_first` | `missing_sheet_sync_auth_token` | Sync contract check enabled, but function has no sync auth token. | Set `SHEET_SYNC_FUNCTION_AUTH_TOKEN` in Supabase secrets or disable `checkSyncContract` for smoke call. |
| `smoke_attendance_db_first` | `sync_contract_http_status_unexpected` / `sync_contract_invalid_payload` / `sync_contract_missing_run_id` / `sync_contract_invalid_status` / `sync_contract_invalid_dry_run` / `sync_contract_missing_summary` | `sheet_to_supabase_sync` contract check failed. | Inspect `sheet_to_supabase_sync` logs and response payload; validate auth token, payload contract, and function deployment version. |
| `smoke_attendance_db_first` | `invalid_smoke_sync_max_warnings_env` | `SMOKE_SYNC_MAX_WARNINGS` has invalid value. | Set non-negative integer or unset variable. |
| `smoke_attendance_db_first` | `sync_quality_missing_errors_count` / `sync_quality_errors_count_not_zero` | Sync summary quality gate failed on `errors_count`. | Inspect latest sync run issues and fix sheet/parser problems before rerun. |
| `smoke_attendance_db_first` | `sync_quality_missing_skipped_invalid_events_count` / `sync_quality_skipped_invalid_events_not_zero` | Sync summary quality gate failed on skipped invalid events. | Fix event parsing/mapping so `attendance_entries_skipped_due_to_invalid_events` returns to `0`. |
| `smoke_attendance_db_first` | `sync_quality_missing_warnings_count` / `sync_quality_warnings_count_exceeded` | Warnings threshold gate failed. | Increase threshold intentionally or reduce parser warnings in source sheets/overrides. |
| `smoke_attendance_db_first` | `sync_quality_forbidden_warning_codes_present` | Forbidden warning code detected in sync warning breakdown. | Remove source anomaly or relax `SMOKE_SYNC_FORBID_WARNING_CODES` only with explicit decision. |

## Platform-Level Errors Seen in Client Calls

| Error | Meaning | Action |
|---|---|---|
| `IDLE_TIMEOUT` | Function execution exceeded Supabase idle timeout window. | Reduce batch (`memberLimit/memberOffset` paging), lower `writeConcurrency`, split by event/date. |
| `WORKER_RESOURCE_LIMIT` | Execution exceeded memory/CPU quota. | Lower `writeConcurrency`, reduce write set, retry narrower export window. |

## Verification After Fix

1. Re-run failing function manually with same payload class.
2. Confirm terminal success in `sync_runs`.
3. Confirm queue has no stuck `processing` rows.
4. Confirm smoke run returns `status=ok` and restored original value.
