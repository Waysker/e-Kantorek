# Phase 7 Operations Hardening Plan

## Scope

Phase 7 addresses operational gaps left after Phase 6:

- local pre-PR edge function type-check path,
- automated attendance runtime health checks,
- workflow and secrets hygiene for long-term maintainability.

## Status (2026-04-29)

- `Phase 7`: completed
- Postmortem: `docs/reference/phase-7-postmortem.md`

## Goals

1. Give contributors a single local command to mirror CI edge-function checks.
2. Add scheduled hybrid health-check automation for runtime pipeline integrity.
3. Keep docs/secrets inventory aligned with newly introduced checks.

## Tasks

1. Add local command:
   - `npm run edge:check`
   - script scans `app/supabase/functions/**/*.ts` and runs `deno check`.
2. Add Supabase function:
   - `attendance_health_check`
   - protected by bearer token
   - checks:
     - recent failed `sheet_to_supabase_sync` runs
     - queue `dead_letter` rows
     - stale `processing` rows
3. Add GitHub workflow:
   - `.github/workflows/attendance-health-check.yml`
   - manual + scheduled triggers
   - skip-on-missing behavior for PR from forks
   - fail on non-OK function result
4. Update docs:
   - `docs/ops/attendance-alerting-plan.md`
   - `docs/ops/secrets-runtime-matrix.md`
   - `docs/ops/pr-ops-checklist.md`
   - `app/README.md`

## Acceptance Criteria

1. `npm run edge:check` exists and fails clearly when `deno` is missing or checks fail.
2. `attendance_health_check` returns `status=ok/fail` with counts + issue details.
3. Attendance health workflow can run from GitHub and enforce non-OK as failure.
4. Docs and secret ownership matrix include the new health-check token and flow.
