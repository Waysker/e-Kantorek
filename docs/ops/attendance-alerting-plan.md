# Attendance Alerting Plan

## Scope

Alerting for the attendance runtime:

- `sheet_to_supabase_sync` (reference sheet -> DB)
- `attendance_write_sheet_first` (app write path, queue worker)
- `supabase_to_sheet_export` (DB -> copy sheet)

## Primary Signals

### A. Sync run failures

Condition:

- any `sheet_to_supabase_sync` run with `status='failed'` in the last 150 minutes
  (aligned with scheduled health-check cadence + buffer).

```sql
select id, started_at, finished_at, error_message, summary
from public.sync_runs
where pipeline_name = 'sheet_to_supabase_sync'
  and status = 'failed'
  and started_at >= now() - interval '150 minutes'
order by started_at desc;
```

### B. Queue dead-letter growth

Condition:

- `attendance_change_queue.status='dead_letter'` count > 0 (critical if growing).

```sql
select count(*) as dead_letter_count
from public.attendance_change_queue
where status = 'dead_letter';
```

### C. Stale processing rows

Condition:

- queue rows in `processing` older than 15 minutes (reclaim should normally prevent this).

```sql
select id, member_id, event_id, claimed_at, attempt_count, last_error
from public.attendance_change_queue
where status = 'processing'
  and claimed_at < now() - interval '15 minutes'
order by claimed_at asc;
```

### D. Export trigger failure

Condition:

- `db_first` write flow indicates export trigger failure (check change journal / function logs).

```sql
select created_at, action, mode, event_id, payload
from public.change_journal
where action in ('attendance_write_db_export_trigger_failed', 'attendance_write_db_applied_batch')
order by created_at desc
limit 200;
```

## Automated Health Check

The canonical operational check is the Supabase function `attendance_health_check`, triggered from GitHub Actions.

It verifies:

1. recent failed `sheet_to_supabase_sync` runs
2. queue rows in `dead_letter`
3. stale queue rows still stuck in `processing`

Workflow:

- `.github/workflows/attendance-health-check.yml`

Required secret:

- `ATTENDANCE_HEALTH_CHECK_FUNCTION_AUTH_TOKEN`

Recommended schedule:

- every 2 hours, plus manual dispatch when investigating incidents

Recommended payload thresholds:

- `failureWindowMinutes=150`
- `staleProcessingMinutes=15`
- `rowLimit=50`

## Alert Severity

- `P1`:
  - repeated sync failures for 150+ minutes
  - dead-letter count increasing
  - smoke regression failing on `main`
- `P2`:
  - single failed sync run with successful retry
  - isolated parser warning increase without skipped attendance rows

## Automatic Guardrails Already Enabled

- GitHub workflow `Smoke Attendance DB-First` on:
  - push to `main`
  - schedule (daily)
  - manual dispatch
- smoke checks:
  - write + rollback on fixed attendance row
  - optional export trigger requirement
  - sync response contract check (`dryRun=true`) with data-quality gates
- health checks:
  - scheduled and manual runtime read-only verification of sync failure, dead-letter, and stale processing conditions

## Recommended Escalation Path

1. Check `sync_runs` and `sync_issues`.
2. Check queue status (`queued`/`processing`/`dead_letter`).
3. Trigger manual `Attendance Health Check` from GitHub Actions.
4. Trigger manual smoke run from GitHub Actions.
5. If failure persists, disable risky writes temporarily:
  - set `EXPO_PUBLIC_ATTENDANCE_WRITE_ENABLED=false` in web deploy context
  - keep sync ingress active until incident is resolved.

## Future Extension (Optional)

- Add SQL-based notifier (cron) writing alert snapshots to a dedicated table.
- Add Slack webhook integration for `P1` conditions.
