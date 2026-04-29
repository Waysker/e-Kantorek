# ORAGH App

## Current Phase

Current baseline is an authenticated app with attendance management and sync/export pipelines.

Current operating model:

- source of truth for attendance is Supabase DB, fed by sheet sync (`sheet_to_supabase_sync`)
- manager writes from app use `attendance_write_sheet_first` in `db_first` mode
- DB -> sheet export is handled by `supabase_to_sheet_export`
- a separate reference sheet can sync into DB; copy sheet can be overwritten from DB for validation
- forum snapshot integration still exists as a separate data pipeline and fallback path

Documentation map: `../docs/README.md`

## Key Directories

- `App.tsx`: app bootstrap and temporary route state
- `src/domain`: stable app models
- `src/data/contracts.ts`: repository interfaces
- `src/data/generated/forumSnapshot.ts`: app-facing normalized snapshot
- `src/data/fixtures`: local fixture repositories
- `src/screens`: prototype screens
- `src/ui`: shared UI primitives
- `scripts/sync-forum-snapshot.mjs`: authenticated forum pull script

## Commands

- `npm run typecheck`
- `npm run start`
- `npm run web`
- `npm run web:build`
- `npm run web:build:pages`
- `npm run attendance:preflight -- --sheet-id <id> --gid <gid> --strict`
- `npm run forum:sync`
- `npm run forum:publish`
- `npm run forum:sync:publish`
- `npm run smoke:attendance:db-first`

## Automated Attendance Regression (db_first)

Default model is hybrid:

- smoke logic and sensitive credentials live in Supabase (`smoke_attendance_db_first` function),
- GitHub Actions only triggers that function with a dedicated bearer token.

What the smoke run validates:

- sign-in with manager account (`section` / `board` / `admin`),
- attendance write via `attendance_write_sheet_first` (`mode=enqueue_batch`, `db_first`),
- DB value changed,
- rollback restores original value.

Supabase secrets (runtime):

- `SMOKE_ATTENDANCE_TEST_EMAIL`
- `SMOKE_ATTENDANCE_TEST_PASSWORD`
- `SMOKE_ATTENDANCE_EVENT_ID`
- `SMOKE_ATTENDANCE_MEMBER_ID`
- `SMOKE_ATTENDANCE_REQUIRE_EXPORT_TRIGGER_OK` (optional)
- `SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN` (required to protect smoke endpoint)

Deploy function:

```bash
supabase functions deploy smoke_attendance_db_first --no-verify-jwt
```

GitHub Actions trigger setup:

- workflow: `.github/workflows/smoke-attendance-db-first.yml`
- required GitHub inputs:
  - secret: `SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN`
  - variable: `SUPABASE_PROJECT_REF`
  - optional variable: `SMOKE_REQUIRE_EXPORT_TRIGGER_OK`
  - optional variable: `SMOKE_CHECK_SYNC_CONTRACT` (defaults to `true`, validates `sheet_to_supabase_sync` response contract)

Manual trigger:

```bash
curl -sS -X POST \
  "https://<project-ref>.functions.supabase.co/smoke_attendance_db_first" \
  -H "Authorization: Bearer <SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"requireExportTriggerOk":false}'
```

Local fallback script (kept for debugging):

```bash
npm run smoke:attendance:db-first
```

Secrets ownership reference: `../docs/ops/secrets-runtime-matrix.md`
Ops runbook: `../docs/ops/attendance-ops-runbook.md`

## Authentication (Supabase)

The app now requires sign-in before loading Feed/Events/Profile.

Setup:

1. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `app/.env`
2. In Supabase Auth settings, enable Email/Password provider
3. Create member accounts in Supabase Auth (Dashboard -> Authentication -> Users)
4. Start app and sign in with one of those accounts
5. New users can register in-app; first name, last name, and instrument are required
6. Apply `supabase/migrations/003_profiles_server_enforced.sql` to enforce profile fields server-side

Notes:

- Session is persisted on device (`AsyncStorage`) and web storage
- `Sign out` is available in `Profile`
- Registration stores metadata on the Supabase Auth user (`firstName`, `lastName`, `fullName`, `instrument`)
- Server-enforced profile validation lives in `public.profiles` with enum instrument, RLS, and auth-user trigger
- App resolves signed-in identity from `public.profiles` first, then metadata fallback
- UI localization defaults to Polish (`pl`); set `EXPO_PUBLIC_APP_LOCALE=en` to preview English copy
- Data source for events snapshot remains Supabase/local fallback as before

Role model:

- `member`: read-only app usage
- `section`: can manage factual attendance
- `board`: can manage factual attendance
- `admin`: can manage factual attendance + change user roles

Role management hardening:

- `supabase/migrations/019_security_hardening_roles_and_rpc_privileges.sql`
- UI role admin screen uses RPC guarded for `admin` role only

## Runtime Baseline

Current baseline (as of 2026-04-29):

- `npm run typecheck` passes locally
- GitHub Pages deploys from `.github/workflows/web-deploy-pages.yml`
- smoke workflow exists at `.github/workflows/smoke-attendance-db-first.yml`
- CI typecheck workflow exists at `.github/workflows/ci-typecheck.yml`

Current verified environment:

- Node `24.14.1`
- npm `11.11.0`
- Expo `55.0.18`

Current local web URL:

- `http://127.0.0.1:8081`

## Forum Sync

The app now prefers a normalized local snapshot instead of scraping the forum at runtime.

Why:

- avoids browser CORS problems on web
- keeps forum credentials out of the app runtime
- makes the forum integration clearly temporary

Current pieces:

- `src/data/generated/forumSnapshot.ts`: app-facing snapshot data
- `scripts/sync-forum-snapshot.mjs`: MyBB login + HTML pull script
- `scripts/publish-snapshot-to-supabase.mjs`: upload latest snapshot payload to Supabase
- `scripts/attendance-sheet-preflight.mjs`: validate Google Sheet/CSV attendance input before sync
- `forum-sync.config.json`: local sync config
- `forum-sync.instrument-overrides.json`: local/bootstrap fallback mapping
- `forum-sync.instrument-overrides.example.json`: optional template/reference
- `.env.example`: required env variable names for client and publisher scripts

To prepare a real sync:

1. Set `ORAGH_FORUM_USERNAME` and `ORAGH_FORUM_PASSWORD`
2. Review `forum-sync.config.json`
3. Run `npm.cmd run attendance:preflight -- --sheet-id <id> --gid <gid> --strict`
4. Apply `supabase/migrations/010_attendance_sync_foundation.sql` through `023_atomic_enqueue_batch_rpc.sql`
5. Configure/deploy Edge Functions from `../docs/ops/sheet-sync-setup.md`
6. Run `npm.cmd run forum:sync`
7. Optionally publish snapshot with `npm.cmd run forum:publish`
8. Recommended one-shot trigger: `npm.cmd run forum:sync:publish`

The current sync auto-discovers dated concert threads from both `Dzial Koncert` (`fid=27`) and `Propozycje koncertow` (`fid=50`), filtered to the configured `eventYear`, unless `eventThreadUrls` is filled explicitly. It writes authenticated raw HTML into `.cache/forum-sync`, fetches poll results from `Ankieta`, parses setlist-like posts, and writes `.cache/forum-sync/snapshot.json`.
To explicitly refresh local fallback TypeScript snapshot, run sync with `FORUM_SYNC_WRITE_LOCAL_SNAPSHOT=1`.

Cloud-ready mode:

- If `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are set, the app reads from `forum_snapshot_cache` in Supabase.
- If they are missing or the cloud row is unavailable, the app falls back to local `forumSnapshot.ts`.
- Profile screen shows data source and `Last synced` timestamp from snapshot metadata.
- Section/board/admin profile includes an Attendance Setup PoC screen (web) with checklist/runbook for preflight and sheet sync.
- Attendance source-of-truth sync is handled by Supabase functions (`sheet_to_supabase_sync`, `attendance_write_sheet_first`).
- `forum:sync` reads instrument overrides from `forum_instrument_overrides` first (key: `ORAGH_INSTRUMENT_OVERRIDES_KEY`, fallback `ORAGH_SNAPSHOT_KEY`, default `forum`).
- If DB overrides are missing/unavailable, `forum:sync` falls back to local/env overrides.
- `forum:publish` expects `SUPABASE_URL` and a server key (`SUPABASE_SECRET_KEY` preferred, `SUPABASE_SERVICE_ROLE_KEY` legacy fallback) in your local shell and pushes `.cache/forum-sync/snapshot.json`.
- `forum:publish` reads `.env.local` and `.env` automatically before checking env variables.
- SQL bootstrap for the cloud table is in `supabase/migrations/001_forum_snapshot_cache.sql`.
- Authenticated-only reads are enforced by `supabase/migrations/004_snapshot_cache_authenticated_only.sql`.
- Sheet-sync dry-run foundation (canonical tables + run logging + scheduler helpers) lives in:
  - `supabase/migrations/010_attendance_sync_foundation.sql`
  - `supabase/migrations/011_sheet_sync_scheduler_helpers.sql`
- Sheet-sync upsert enablement (service-role grants + cron payload dryRun=false):
  - `supabase/migrations/012_sheet_sync_upsert_enablement.sql`
- Sheet-first write path foundation (queue + mapping + worker scheduler):
  - `supabase/migrations/013_attendance_sheet_first_write_path.sql`
- Write-path and export hardening:
  - `supabase/migrations/018_dedupe_events_by_source_cell.sql`
  - `supabase/migrations/019_security_hardening_roles_and_rpc_privileges.sql`
  - `supabase/migrations/020_queue_reclaim_stale_processing.sql`
  - `supabase/migrations/021_supporting_indexes_export_queue_and_attendance.sql`
  - `supabase/migrations/022_harden_dedupe_queue_preservation.sql`
  - `supabase/migrations/023_atomic_enqueue_batch_rpc.sql`
- Supabase Edge Function runtime setup: `../docs/ops/sheet-sync-setup.md`
- Supabase Edge Function write path:
  - `supabase/functions/attendance_write_sheet_first/index.ts`
- Actual attendance writes (section/board/admin panel):
  - member RSVP on event screen is read-only preview
  - write path is used by dedicated management page (`Profil -> Rejestr faktycznej obecności`)
  - gate switch: `EXPO_PUBLIC_ATTENDANCE_WRITE_ENABLED` (default disabled; enable after pipeline deploy)
  - optional explicit URL: `EXPO_PUBLIC_ATTENDANCE_WRITE_FUNCTION_URL`
  - if omitted, app derives function URL from `EXPO_PUBLIC_SUPABASE_URL`
- Function CORS allowlist (for GitHub Pages / web app):
  - `ATTENDANCE_WRITE_CORS_ALLOWED_ORIGINS` (comma-separated, default `*`)
- Post-write DB sync policy:
  - default: `attendance_write_sheet_first` expects `SHEET_TO_SUPABASE_SYNC_URL` and marks worker run failed if sync trigger cannot run
  - optional fallback: set `ATTENDANCE_WRITE_ALLOW_CRON_SYNC_FALLBACK=true` to allow relying only on scheduled `sheet_to_supabase_sync`
  - write path is management-only (`section/board/admin`)

Scheduling / trigger:

- Manual trigger: run `npm.cmd run forum:sync:publish` from the `app` directory.
- Scheduled trigger (Windows Task Scheduler): run `cmd.exe /d /c "cd /d C:\Users\Waysker\Documents\New project\app && npm.cmd run forum:sync:publish >> .cache\forum-sync\scheduler.log 2>&1"` on your preferred cadence.
- Cloud trigger (recommended): use GitHub Actions workflow at `.github/workflows/forum-sync-publish.yml`.

GitHub Actions setup:

1. Push this repo to GitHub.
2. In repository settings, add secrets:
   - `ORAGH_FORUM_USERNAME`
   - `ORAGH_FORUM_PASSWORD`
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
3. Optional repository variable: `ORAGH_SNAPSHOT_KEY` (defaults to `forum`).
4. Optional repository variable: `ORAGH_INSTRUMENT_OVERRIDES_KEY` (defaults to `ORAGH_SNAPSHOT_KEY`, then `forum`).
5. Enable Actions and run workflow `Forum Sync Publish` manually once.
6. Keep or edit the cron (`17 */4 * * *`, UTC) in the workflow file.

Attendance sync (`reference -> DB -> copy`) is intentionally Supabase-only (Edge Functions + `pg_cron`).
Use `../docs/ops/sheet-sync-setup.md` for setup and runbook.

## Web Hosting (GitHub Pages)

This repo includes `.github/workflows/web-deploy-pages.yml` which exports Expo web (`app/dist`) and deploys it to GitHub Pages on every push to `main` (and manually with `workflow_dispatch`).
The workflow uses `npm run web:build:pages`, which patches exported `index.html` asset paths to work under GitHub Pages repo subpaths.

One-time setup in GitHub:

1. `Settings -> Pages -> Source`: select **GitHub Actions**
2. Add repository secrets:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

After first successful run, the site will be available under your Pages URL (usually `https://<user>.github.io/<repo>/`).

Instrument override note:

- prefer `byUid` for production stability
- `byFullName` is useful as a bridge when uid mapping is incomplete
- `byUsername` still works as a fallback for cases where the full name is unknown
- current PoC source of truth is workbook copy (`Obecności`) and its Supabase mirror
- `forum_instrument_overrides` is refreshed from workbook upload/publish for forum sync compatibility
- local JSON mapping remains a fallback/bootstrap path

Temporary limitation:

- the forum exposes attendance voters and member names cleanly
- it does not expose instruments in the same way
- instrument mapping is currently DB-managed via JSON payload rows (`attendance_sheet_cache` + `forum_instrument_overrides`)
- PoC admin UI exists (web) for workbook upload, but still needs audited edit history and stronger governance

## Next Build Targets

1. Replace temporary route state with real routing when we are ready.
2. Swap legacy fixture reads for real forum parsing or fetch logic.
3. Keep the adapter boundary intact so the final backend can replace the temporary source cleanly.
