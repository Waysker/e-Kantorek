# Phase 6 Maintainability Plan

## Scope

This phase converts the current “functionally stable” baseline into an operationally maintainable one.

Focus areas:

- CI gates completeness on pull requests
- sync data-quality enforcement in automated smoke
- operational docs consistency (runtime truth, migrations, role taxonomy)
- handoff clarity for future contributors

## Status (2026-04-29)

- `Phase 6`: completed

## Goals

1. Block PRs on both type and web build regressions.
2. Extend smoke beyond response-shape contract to minimum data-quality checks.
3. Remove contradictory operational guidance in docs.
4. Keep one explicit runtime model: reference sheet ingress -> DB source of truth -> copy sheet export.

## P0 Tasks

1. Add CI workflow for PR web build (`npm ci` + `npm run web:build` in `app`).
2. Add CI workflow for Supabase Edge Functions static check (`deno check`).
3. Strengthen `checkSyncContract` in `smoke_attendance_db_first`:
   - fail on `errors_count > 0`
   - fail on `attendance_entries_skipped_due_to_invalid_events > 0`
   - optional warning thresholds via env.
4. Fix docs inconsistencies:
   - real migration filenames
   - runtime role names (`section/board/admin`)
   - no source-of-truth contradiction.

## P1 Tasks

1. Add lightweight PR checklist doc for ops-impacting changes.
2. Add alerting plan (failed sync/dead-letter/stale processing/export trigger failure).
3. Normalize README command paths (`npm` primary, legacy notes isolated).

## P2 Tasks

1. Add staging pipeline integration checks (`sync -> db -> export`).
2. Add canary sync mode for large workbook changes.
3. Add function response contract docs with pinned JSON examples.

## Acceptance Criteria

1. PR has required checks:
   - `CI Typecheck`
   - `CI Web Build`
   - `CI Edge Functions Check`
2. Smoke run with `checkSyncContract=true` fails on hard data-quality violations.
3. `docs/ops/sheet-sync-setup.md` and `docs/contracts/attendance-sheet-contract.md` are aligned with runtime behavior.
4. No conflicting “source of truth” statements across docs.

## Regression Gate

1. `npm run typecheck`
2. `npm run web:build`
3. Run `Smoke Attendance DB-First` workflow with `SMOKE_CHECK_SYNC_CONTRACT=true`
4. Confirm smoke response:
   - `status=ok`
   - `sync_contract_check.status in {dry_run, success}`
5. Verify `sync_runs` latest entries have no unexpected `failed` status after deployment.

## Delivered

1. PR CI gates now include:
   - `CI Typecheck`
   - `CI Web Build`
   - `CI Edge Functions Check`
2. `smoke_attendance_db_first` enforces sync quality checks (`errors_count`, skipped-invalid-events, optional warnings policy).
3. `sheet_to_supabase_sync` response contract stabilized:
   - `attendance_entries_skipped_due_to_invalid_events` present also in `dry_run`
   - canary source slicing via `sourceOffset` / `sourceLimit`
4. Docs aligned:
   - role taxonomy (`member/section/board/admin`)
   - migration names
   - source-of-truth model
5. New operational docs:
   - `docs/ops/attendance-alerting-plan.md`
   - `docs/ops/pr-ops-checklist.md`
6. Function response contract examples pinned in `docs/contracts/attendance-sheet-contract.md`.
