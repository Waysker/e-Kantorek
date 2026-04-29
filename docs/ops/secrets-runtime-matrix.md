# Secrets and Runtime Ownership Matrix

## Goal

Keep every variable in the runtime where it is consumed.

- Supabase function runtime secrets: Supabase only.
- CI trigger/config values: GitHub only.
- Public client config (`EXPO_PUBLIC_*`): GitHub variables/secrets (non-sensitive by design).

## Rules

1. Do not duplicate sensitive values across GitHub and Supabase unless a trigger flow explicitly needs it.
2. If a secret is consumed only by Edge Functions, it must not be stored in GitHub.
3. Use GitHub `Variables` for non-sensitive values and `Secrets` for sensitive ones.

## Canonical Matrix

| Variable | Type | Runtime Owner | Store In | Notes |
|---|---|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | public config | web/app build | GitHub Variable or Secret | Required for Pages/web builds. |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public config | web/app build | GitHub Variable or Secret | Publishable key, still safe as public client config. |
| `EXPO_PUBLIC_ATTENDANCE_REFERENCE_SHEET_ID` | public config | web/app build | GitHub Variable or Secret | Required by attendance summary panel; enforces ref-only source filter. |
| `ORAGH_FORUM_USERNAME` | secret | GitHub forum sync workflow | GitHub Secret | Runner-side sync login. |
| `ORAGH_FORUM_PASSWORD` | secret | GitHub forum sync workflow | GitHub Secret | Runner-side sync login. |
| `SUPABASE_URL` | secret-ish config | GitHub forum publish workflow | GitHub Secret | Used by publish scripts in CI. |
| `SUPABASE_SECRET_KEY` | secret | GitHub forum publish workflow | GitHub Secret | Service-level access for publish scripts. |
| `SHEET_SYNC_FUNCTION_AUTH_TOKEN` | secret | `sheet_to_supabase_sync` function + cron | Supabase Secret | Required for manual/curl and cron auth. |
| `ATTENDANCE_WRITE_FUNCTION_AUTH_TOKEN` | secret | `attendance_write_sheet_first` worker mode | Supabase Secret | Protects worker/process endpoint flow. |
| `ATTENDANCE_EXPORT_TARGET_SHEET_ID` | config | `supabase_to_sheet_export` function | Supabase Secret | Target copy sheet ID. |
| `DB_TO_SHEET_EXPORT_URL` | config | `attendance_write_sheet_first` trigger | Supabase Secret | Full URL to export function. |
| `DB_TO_SHEET_EXPORT_AUTH_TOKEN` | secret | export trigger/auth | Supabase Secret | Canonical bearer token for export trigger and export function. |
| `DB_TO_SHEET_EXPORT_TOKEN` | secret | export trigger/auth | Supabase Secret | Backward-compatible alias; keep equal to `DB_TO_SHEET_EXPORT_AUTH_TOKEN` if still used. |
| `ATTENDANCE_APPS_SCRIPT_WEBHOOK_URL` | config | write/export webhook calls | Supabase Secret | Apps Script web app URL. |
| `ATTENDANCE_APPS_SCRIPT_WEBHOOK_TOKEN` | secret | write/export webhook calls | Supabase Secret | Shared secret expected by Apps Script. |
| `ATTENDANCE_SHEET_ID` | config | sync ingest function | Supabase Secret | Reference sheet ID for ingress sync. |
| `ATTENDANCE_SHEET_AUTO_DISCOVER_SOURCES` | config | sync ingest function | Supabase Secret | Enables month-tab auto-discovery. |
| `ATTENDANCE_EVENT_DATE_OVERRIDES_JSON` | config | sync ingest function | Supabase Secret | Manual header/date overrides for legacy immutable tabs. |
| `ATTENDANCE_WRITE_SOURCE_MODE` | config | `attendance_write_sheet_first` | Supabase Secret | Should be `db_first` in current baseline. |
| `ATTENDANCE_WRITE_TRIGGER_DB_EXPORT` | config | `attendance_write_sheet_first` | Supabase Secret | Enables automatic DB->copy export trigger after write. |
| `SMOKE_ATTENDANCE_TEST_EMAIL` | secret | smoke function runtime | Supabase Secret | Test user login (never in GitHub). |
| `SMOKE_ATTENDANCE_TEST_PASSWORD` | secret | smoke function runtime | Supabase Secret | Test user password (never in GitHub). |
| `SMOKE_ATTENDANCE_EVENT_ID` | config | smoke function runtime | Supabase Secret | Fixed smoke target event. |
| `SMOKE_ATTENDANCE_MEMBER_ID` | config | smoke function runtime | Supabase Secret | Fixed smoke target member. |
| `SMOKE_SYNC_MAX_WARNINGS` | config | smoke function runtime | Supabase Secret | Optional warnings threshold for sync quality gate. |
| `SMOKE_SYNC_FORBID_WARNING_CODES` | config | smoke function runtime | Supabase Secret | Optional comma-separated forbidden warning codes for sync quality gate. |
| `SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN` | secret | smoke trigger auth | Supabase Secret + GitHub Secret | Only intentionally duplicated secret. |
| `ATTENDANCE_HEALTH_CHECK_FUNCTION_AUTH_TOKEN` | secret | health-check trigger auth | Supabase Secret + GitHub Secret | Dedicated bearer token for `attendance_health_check`. |
| `SUPABASE_PROJECT_REF` | config | smoke + health workflow trigger | GitHub Variable | Non-sensitive project ref for function URL. |
| `SMOKE_REQUIRE_EXPORT_TRIGGER_OK` | config | smoke workflow trigger | GitHub Variable | Optional strict smoke mode. |
| `SMOKE_CHECK_SYNC_CONTRACT` | config | smoke workflow trigger | GitHub Variable | Optional gate that enables sync contract check (`true` by default in workflow). |

## Hybrid Smoke Model

Reference:

- `docs/ops/smoke-attendance-db-first-hybrid.md`

Design:

1. Smoke logic and test credentials stay in Supabase function runtime.
2. GitHub has only trigger token + project ref.
3. Smoke run writes and rolls back the same fixed row to stay idempotent.
4. Optional sync contract check reuses `SHEET_SYNC_FUNCTION_AUTH_TOKEN` from Supabase runtime only.
5. Attendance health checks remain read-only and use their own bearer token, also duplicated only because GitHub needs to trigger the function.

## Rotation Policy

1. Rotate function trigger token in Supabase first.
2. Update matching GitHub secret(s) immediately after.
3. Rotate smoke user password in Supabase Auth and sync `SMOKE_ATTENDANCE_TEST_PASSWORD`.
4. Re-run smoke workflow to confirm post-rotation health.
