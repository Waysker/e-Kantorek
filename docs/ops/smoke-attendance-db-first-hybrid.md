# Smoke Attendance (`db_first`) Hybrid Model

## Goal

Run end-to-end regression checks without exposing test-user credentials to GitHub.

Hybrid model:

- Supabase function executes the smoke scenario and stores sensitive runtime secrets.
- GitHub Actions only triggers the function with a dedicated bearer token.

## Runtime Ownership

Supabase secrets (function runtime):

- `SMOKE_ATTENDANCE_TEST_EMAIL`
- `SMOKE_ATTENDANCE_TEST_PASSWORD`
- `SMOKE_ATTENDANCE_EVENT_ID`
- `SMOKE_ATTENDANCE_MEMBER_ID`
- optional `SMOKE_ATTENDANCE_REQUIRE_EXPORT_TRIGGER_OK`
- `SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN`

GitHub settings (trigger only):

- secret: `SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN`
- variable: `SUPABASE_PROJECT_REF`
- optional variable: `SMOKE_REQUIRE_EXPORT_TRIGGER_OK`

## What Smoke Validates

1. Sign-in using dedicated manager account.
2. Attendance write through `attendance_write_sheet_first` (`mode=enqueue_batch`, `db_first`).
3. DB assertion that value changed.
4. Rollback assertion that original value was restored.

## Workflow

File:

- `.github/workflows/smoke-attendance-db-first.yml`

Triggers:

- `pull_request` (paths limited to app/workflow)
- `push` to `main` (paths limited)
- scheduled daily run
- manual `workflow_dispatch`

## Manual Trigger

```bash
curl -sS -X POST \
  "https://<project-ref>.functions.supabase.co/smoke_attendance_db_first" \
  -H "Authorization: Bearer <SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"requireExportTriggerOk":false}'
```

Expected result:

- `{"status":"ok", ...}`

## Rotation

1. Rotate `SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN` in Supabase.
2. Update GitHub secret `SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN`.
3. If rotating smoke user password, update:
   - Supabase Auth user password
   - Supabase secret `SMOKE_ATTENDANCE_TEST_PASSWORD`

## Failure Handling

- Use `docs/ops/function-errors-runbook.md` for code-level remediation.
- Use `docs/ops/attendance-ops-runbook.md` for SQL checks and queue/sync health.
