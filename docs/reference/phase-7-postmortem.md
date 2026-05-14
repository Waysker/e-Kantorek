# Phase 7 Postmortem (2026-04-29)

## Goal

Close operations hardening for attendance runtime:

- local edge-function check path,
- automated runtime health checks,
- CI/runtime docs alignment.

## Outcome

Status: delivered with follow-up patching.

What is now true:

- local command `npm run edge:check` exists and validates all `app/supabase/functions/**/*.ts` files via Deno,
- `attendance_health_check` function is implemented and deployed,
- GitHub workflow `Attendance Health Check` exists for schedule/manual/PR/push execution,
- alerting/docs were updated to include health-check ownership and runtime baseline.

## Evidence Snapshot

Key artifacts introduced in Phase 7:

- `app/scripts/edge-functions-check.mjs`
- `app/supabase/functions/attendance_health_check/index.ts`
- `.github/workflows/attendance-health-check.yml`
- docs updates in `docs/ops/*` and `docs/reference/*`

## Issues Found During Postmortem Review

1. Health-check detection window originally did not match schedule cadence (risk: missed failures between checks).
2. `stale processing` threshold was below DB reclaim threshold (risk: false alarms).
3. Workflow calls were sensitive to transient network/API errors (observed `502` incidents).
4. Runbook SQL examples referenced non-existing `sync_issues.source_ref` field instead of `sync_runs.source_ref` via `run_id`.
5. Export token naming was inconsistent (`DB_TO_SHEET_EXPORT_AUTH_TOKEN` vs `DB_TO_SHEET_EXPORT_TOKEN`).
6. `docs/reference/phase-7-postmortem.md` was referenced but missing.

## Corrective Actions Applied

1. Health-check defaults aligned:
   - `DEFAULT_FAILURE_WINDOW_MINUTES=150`
   - `DEFAULT_STALE_PROCESSING_MINUTES=15`
2. `Attendance Health Check` workflow hardened:
   - retry/backoff for HTTP call,
   - explicit request timeout,
   - safer non-JSON response handling,
   - job timeout and per-ref concurrency group.
3. `Smoke Attendance DB-First` workflow hardened similarly:
   - retry/backoff,
   - explicit timeout,
   - safer JSON status parsing,
   - per-ref concurrency group.
4. `Forum Sync Publish` workflow hardened:
   - concurrency group,
   - job timeout,
   - one retry for transient failures.
5. CI reliability alignment:
   - `CI Edge Functions Check` now also runs on `push` to `main`.
   - `CI Web Build` now also runs on `push` to `main`.
   - CI jobs received explicit timeouts.
6. Runtime token compatibility improved:
   - `attendance_write_sheet_first` now accepts `DB_TO_SHEET_EXPORT_AUTH_TOKEN` first,
   - `supabase_to_sheet_export` accepts both `DB_TO_SHEET_EXPORT_AUTH_TOKEN` and `DB_TO_SHEET_EXPORT_TOKEN`.
7. Runbook/docs fixes:
   - SQL queries corrected to join `sync_issues` with `sync_runs`,
   - secrets matrix expanded with missing runtime vars and token alias guidance,
   - missing postmortem document added.

## Residual Risks

1. `main` branch protection/rulesets are an external GitHub setting and may still not enforce required checks.
2. PR checks with missing fork secrets are intentionally skipped; if marked required, they can create false confidence unless branch protection policy is tuned.
3. Smoke still operates on shared real dataset (rollback-safe, but not fully isolated).

## Recommended Next Phase (Phase 8)

1. Enforce GitHub branch protection/rulesets for `main` with required CI/smoke checks.
2. Add a dedicated isolated smoke fixture row (or fixture dataset) to remove shared-data race surface.
3. Add an always-on lightweight required workflow (no path filters) to avoid required-check edge cases.
4. Add optional synthetic monitor/notification sink for health-check failures (Slack or equivalent).
