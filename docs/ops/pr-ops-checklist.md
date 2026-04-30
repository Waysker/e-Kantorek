# PR Ops Checklist (Attendance Pipelines)

Use this checklist for PRs that touch at least one of:

- `app/supabase/functions/**`
- `app/supabase/migrations/**`
- `.github/workflows/**`
- `docs/ops/**`
- `docs/contracts/**`

## 1) Contract and Runtime Safety

- [ ] Source-of-truth model is unchanged or explicitly documented (`reference sheet -> DB -> copy`).
- [ ] Function response contract changes are reflected in `docs/contracts/attendance-sheet-contract.md`.
- [ ] New env vars/secrets are added to `docs/ops/secrets-runtime-matrix.md`.
- [ ] Role model remains `member/section/board/admin` (no accidental privilege drift).

## 2) Migration and DB Safety

- [ ] New migrations are additive and ordered (no hidden destructive step).
- [ ] RLS/policies are preserved for user-facing tables.
- [ ] Any queue/event dedupe logic protects open intents (no silent drop).

## 3) CI and Smoke Gates

- [ ] `CI Typecheck` passes.
- [ ] `CI Web Build` passes.
- [ ] `CI Edge Functions Check` passes (if function code changed).
- [ ] `npm run edge:check` passes locally before opening the PR.
- [ ] `Smoke Attendance DB-First` passes with:
  - `SMOKE_CHECK_SYNC_CONTRACT=true`
  - `SMOKE_REQUIRE_EXPORT_TRIGGER_OK=true`
- [ ] `Attendance Health Check` passes on manual dispatch after deploys touching pipeline/runtime logic.
- [ ] `Deploy Web Staging` completed for `main` commit and staging URL was sanity-checked.
- [ ] If releasing, `Deploy Web Production` was run manually from the validated ref.

## 4) Ops Verifications (Post-Deploy)

- [ ] Latest `sync_runs` entries are terminal (`success`/`dry_run`, no unexpected `failed`).
- [ ] No growth in `attendance_change_queue` `dead_letter`.
- [ ] No stale `processing` queue rows older than reclaim window.
- [ ] Export trigger path still works (`db_first` write produces export trigger in logs/change journal).

## 5) Rollback Notes in PR Description

- [ ] Include rollback command(s) or migration rollback strategy.
- [ ] Include “what to monitor for 24h” section (sync errors, queue dead-letter, smoke failures).
