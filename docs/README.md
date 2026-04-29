# Documentation Index

## Structure

- `docs/ops`: operational setup, runbooks, secrets ownership, incident handling
- `docs/contracts`: source data contracts consumed by sync/export pipelines
- `docs/reference`: architecture/roadmaps/maintenance plans for current baseline
- `docs/archive`: historical product/design notes kept for context

## Start Here (Current Baseline)

1. `docs/reference/phase-6-maintainability-plan.md`
2. `docs/reference/phase-6-postmortem.md`
3. `docs/reference/cleanup-maintenance-plan.md`
4. `docs/ops/sheet-sync-setup.md`
5. `docs/ops/attendance-ops-runbook.md`
6. `docs/ops/function-errors-runbook.md`
7. `docs/ops/attendance-alerting-plan.md`
8. `docs/ops/pr-ops-checklist.md`
9. `docs/ops/secrets-runtime-matrix.md`
10. `docs/ops/smoke-attendance-db-first-hybrid.md`
11. `docs/contracts/attendance-sheet-contract.md`

## Scope Notes

- Runtime source of truth: Supabase DB (`db_first`) with controlled export to copy sheet.
- Reference sheet remains ingress-only (sync to DB), not an active write target from app.
- Smoke checks are hybrid: execution in Supabase function, trigger from GitHub Actions.
