# ORAGH App Prototype

## Current Phase

This app is a read-only visual prototype.

Current data setup:

- `Feed` uses local fixture content
- `Events`, `Users`, and `Attendance` currently come from a normalized local snapshot
- that snapshot is the boundary between the app UI and the temporary forum integration
- leader/admin users now have a web-only PoC setup screen for attendance workbook import

That boundary is intentional.

The UI should not depend directly on legacy forum fields or markup.

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
- `npm run forum:sync`
- `npm run forum:publish:attendance`
- `npm run forum:publish`
- `npm run forum:publish:overrides`
- `npm run forum:sync:publish`

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

## Runtime Note

The scaffold was created successfully, `npm run typecheck` passes, and the web runtime now boots locally.

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
- `scripts/publish-attendance-sheet-to-supabase.mjs`: publish workbook-based attendance payload to Supabase
- `scripts/publish-instrument-overrides-to-supabase.mjs`: bootstrap/update instrument overrides row in Supabase
- `scripts/publish-snapshot-to-supabase.mjs`: upload latest snapshot payload to Supabase
- `forum-sync.config.json`: local sync config
- `forum-sync.instrument-overrides.json`: local/bootstrap fallback mapping
- `forum-sync.instrument-overrides.example.json`: optional template/reference
- `.env.example`: required env variable names for client and publisher scripts

To prepare a real sync:

1. Set `ORAGH_FORUM_USERNAME` and `ORAGH_FORUM_PASSWORD`
2. Review `forum-sync.config.json`
3. Apply `supabase/migrations/005_forum_instrument_overrides.sql`
4. Apply `supabase/migrations/006_attendance_sheet_cache.sql`
5. Optional local source file for PoC/backward compatibility: `../Copy of Obecności 25'-26'.xlsx`
6. Optionally publish workbook payload with `npm.cmd run forum:publish:attendance`
7. Bootstrap DB overrides from workbook/JSON with `npm.cmd run forum:publish:overrides`
8. Run `npm.cmd run forum:sync`
9. Optionally publish snapshot with `npm.cmd run forum:publish`
10. Recommended one-shot trigger: `npm.cmd run forum:sync:publish`

The current sync auto-discovers dated concert threads from both `Dzial Koncert` (`fid=27`) and `Propozycje koncertow` (`fid=50`), filtered to the configured `eventYear`, unless `eventThreadUrls` is filled explicitly. It writes authenticated raw HTML into `.cache/forum-sync`, fetches poll results from `Ankieta`, parses setlist-like posts, and writes `.cache/forum-sync/snapshot.json`.
To explicitly refresh local fallback TypeScript snapshot, run sync with `FORUM_SYNC_WRITE_LOCAL_SNAPSHOT=1`.

Cloud-ready mode:

- If `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are set, the app reads from `forum_snapshot_cache` in Supabase.
- If they are missing or the cloud row is unavailable, the app falls back to local `forumSnapshot.ts`.
- Profile screen shows data source and `Last synced` timestamp from snapshot metadata.
- Leader/admin profile includes an Attendance Setup PoC screen (web) to upload workbook and publish to Supabase.
- `forum:publish:attendance` publishes parsed workbook payload into `attendance_sheet_cache` (`ORAGH_ATTENDANCE_KEY`, fallback `ORAGH_SNAPSHOT_KEY`).
- `forum:sync` reads instrument overrides from `forum_instrument_overrides` first (key: `ORAGH_INSTRUMENT_OVERRIDES_KEY`, fallback `ORAGH_SNAPSHOT_KEY`, default `forum`).
- If DB overrides are missing/unavailable, `forum:sync` falls back to local/env overrides.
- `forum:publish:overrides` bootstraps the DB row from workbook/file or `ORAGH_FORUM_INSTRUMENT_OVERRIDES_JSON`.
- `forum:publish` expects `SUPABASE_URL` and a server key (`SUPABASE_SECRET_KEY` preferred, `SUPABASE_SERVICE_ROLE_KEY` legacy fallback) in your local shell and pushes `.cache/forum-sync/snapshot.json`.
- `forum:publish`, `forum:publish:attendance`, and `forum:publish:overrides` read `.env.local` and `.env` automatically before checking env variables.
- SQL bootstrap for the cloud table is in `supabase/migrations/001_forum_snapshot_cache.sql`.
- Authenticated-only reads are enforced by `supabase/migrations/004_snapshot_cache_authenticated_only.sql`.
- SQL bootstrap for override storage is in `supabase/migrations/005_forum_instrument_overrides.sql`.
- SQL bootstrap for attendance workbook payload + privileged writer policies is in `supabase/migrations/006_attendance_sheet_cache.sql`.

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
4. Optional repository variable: `ORAGH_ATTENDANCE_KEY` (defaults to `ORAGH_SNAPSHOT_KEY`, then `forum`).
5. Optional repository variable: `ORAGH_INSTRUMENT_OVERRIDES_KEY` (defaults to `ORAGH_SNAPSHOT_KEY`, then `forum`).
6. Enable Actions and run workflow `Forum Sync Publish` manually once.
7. Keep or edit the cron (`17 */4 * * *`, UTC) in the workflow file.

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
