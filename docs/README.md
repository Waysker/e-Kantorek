# Documentation Index

## Structure

- `docs/ops`: operational setup, runbooks, secrets ownership, incident handling
- `docs/contracts`: source data contracts consumed by sync/export pipelines
- `docs/reference`: architecture/roadmaps/maintenance plans for current baseline
- `docs/archive`: historical product/design notes kept for context

## Start Here (Current Baseline)

1. `docs/reference/phase-7-operations-hardening-plan.md`
2. `docs/reference/phase-7-postmortem.md`
3. `docs/reference/phase-6-maintainability-plan.md`
4. `docs/reference/phase-6-postmortem.md`
5. `docs/reference/cleanup-maintenance-plan.md`
6. `docs/ops/sheet-sync-setup.md`
7. `docs/ops/attendance-ops-runbook.md`
8. `docs/ops/function-errors-runbook.md`
9. `docs/ops/attendance-alerting-plan.md`
10. `docs/ops/pr-ops-checklist.md`
11. `docs/ops/secrets-runtime-matrix.md`
12. `docs/ops/smoke-attendance-db-first-hybrid.md`
13. `docs/contracts/attendance-sheet-contract.md`

## Scope Notes

- Runtime source of truth: Supabase DB (`db_first`) with controlled export to copy sheet.
- Reference sheet remains ingress-only (sync to DB), not an active write target from app.
- Smoke checks are hybrid: execution in Supabase function, trigger from GitHub Actions.
- Attendance health checks are hybrid too: the function reads operational tables in Supabase and the workflow triggers it on schedule or manually.
