# Phase 6 Postmortem (2026-04-29)

## Goal

Close the maintainability phase end-to-end:

- complete CI gates,
- harden smoke quality checks,
- align docs and runtime,
- leave `main` in a reproducible green state.

## Outcome

Status: delivered.

What is now true:

- `main` includes Phase 6 plan + follow-up fixes.
- CI gates are green on latest `main`:
  - `CI Typecheck`
  - `CI Web Build`
  - `CI Edge Functions Check`
- smoke (`Smoke Attendance DB-First`) is green on latest `main`.
- Supabase runtime is deployed for the updated function set.

## Evidence Snapshot

Latest key commits:

- `426983a` (`phase 6`)
- `6a6847d` (`ci: allow manual dispatch for web and edge checks`)
- `c11ae73`, `a250be0`, `caec23e`, `20dd0f7` (edge typing fixes)
- `e2b74e9` (smoke race hardening)
- `937b84e` (force Node24 runtime env in workflows)

Latest successful runs:

- `CI Typecheck`: `25111799436`
- `CI Web Build`: `25111799394`
- `CI Edge Functions Check`: `25111799366`
- `Smoke Attendance DB-First`: `25111851901`

## Issues Found During Closeout

1. `CI Edge Functions Check` initially failed after enabling manual dispatch.
2. Root cause: strict `deno check` surfaced type mismatches for `SupabaseClient` generics in multiple edge functions.
3. Smoke had an intermittent fail (`smoke_first_step_ratio_mismatch`) caused by race between smoke write assertion and sync overwrite.
4. GitHub Actions emitted Node20 deprecation warnings (non-blocking but operational debt).

## Corrective Actions Applied

1. Standardized edge-function client typing (`SupabaseClient<any, "public", any>`) across affected functions.
2. Added smoke fallback evidence check in `change_journal` so a real write is accepted even if row value is quickly overwritten by concurrent sync.
3. Added `workflow_dispatch` to CI workflows that previously only ran on PR.
4. Forced JS action runtime to Node24 via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` in workflow envs.
5. Deployed updated Supabase functions:
   - `sheet_to_supabase_sync`
   - `attendance_write_sheet_first`
   - `supabase_to_sheet_export`
   - `smoke_attendance_db_first`

## Residual Risks

1. Actions still annotate that some actions target Node20 internally; they run forced on Node24 now, but action version upgrades are still recommended.
2. Smoke still depends on shared data surface; race effects are mitigated, not eliminated.
3. Local `deno` is not installed on contributor machines by default, so edge typing feedback comes mainly from CI.

## Recommended Next Phase (Phase 7)

1. Upgrade workflow actions to latest Node24-native versions when available.
2. Introduce isolated smoke target row/event dedicated for CI (reduce shared-data races).
3. Add an optional lightweight local edge-check script path for contributors (`deno check` parity pre-push).
4. Add periodic SQL/ops alert checks from `docs/ops/attendance-alerting-plan.md` as automated jobs.
