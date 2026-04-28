# Secrets and Runtime Ownership Matrix

## Goal

Keep secrets where they are executed:

- Supabase runtime secrets stay in Supabase (`supabase secrets set`).
- GitHub keeps only values required by GitHub runner jobs.
- Public client config (`EXPO_PUBLIC_*`) is treated as non-sensitive and can live in GitHub variables.

## Ownership Rules

1. If value is used only by Edge Functions, keep it only in Supabase.
2. If value is needed by a GitHub Actions job, it must exist in GitHub secrets/variables.
3. Prefer GitHub `Variables` for non-sensitive config and `Secrets` for sensitive values.

## Current Target Model

| Scope | Variable | Location |
|---|---|---|
| Web build (public client config) | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | GitHub Variables or Secrets |
| Forum sync job (runner-side integration) | `ORAGH_FORUM_USERNAME`, `ORAGH_FORUM_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | GitHub Secrets |
| Sheet/db sync runtime | `SHEET_SYNC_FUNCTION_AUTH_TOKEN`, `ATTENDANCE_WRITE_FUNCTION_AUTH_TOKEN`, webhook/export tokens, sheet IDs, mode flags | Supabase Secrets |
| Smoke db_first runtime | `SMOKE_ATTENDANCE_TEST_EMAIL`, `SMOKE_ATTENDANCE_TEST_PASSWORD`, `SMOKE_ATTENDANCE_EVENT_ID`, `SMOKE_ATTENDANCE_MEMBER_ID`, `SMOKE_ATTENDANCE_REQUIRE_EXPORT_TRIGGER_OK` | Supabase Secrets |
| Smoke trigger from GitHub | `SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN`, `SUPABASE_PROJECT_REF` | GitHub Secret + Variable |

## Recommended Smoke Architecture (Hybrid)

1. `smoke_attendance_db_first` runs in Supabase and performs:
   - auth as dedicated manager user,
   - write (`db_first`) for fixed test row,
   - verify changed value,
   - restore original value.
2. GitHub workflow only calls function endpoint with bearer token.
3. Smoke writes are tagged with `source=smoke_attendance_db_first` and dedicated request note.

## Rotation Policy

1. Rotate `SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN` first in Supabase, then in GitHub.
2. Rotate smoke user password in Supabase Auth and update `SMOKE_ATTENDANCE_TEST_PASSWORD` in Supabase secrets.
3. Keep a fixed smoke target row; update `SMOKE_ATTENDANCE_EVENT_ID` / `SMOKE_ATTENDANCE_MEMBER_ID` only when dataset changes.
