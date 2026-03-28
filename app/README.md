# ORAGH App Prototype

## Current Phase

This app is a read-only visual prototype.

Current data setup:

- `Feed` uses local fixture content
- `Events`, `Users`, and `Attendance` currently come from a normalized local snapshot
- that snapshot is the boundary between the app UI and the temporary forum integration

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
- `npm run forum:publish`
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
- `scripts/publish-snapshot-to-supabase.mjs`: upload latest snapshot payload to Supabase
- `forum-sync.config.json`: local sync config
- `forum-sync.instrument-overrides.example.json`: tracked template for optional instrument mapping
- `.env.example`: required env variable names for client and publisher scripts

To prepare a real sync:

1. Set `ORAGH_FORUM_USERNAME` and `ORAGH_FORUM_PASSWORD`
2. Review `forum-sync.config.json`
3. Optionally copy `forum-sync.instrument-overrides.example.json` to `forum-sync.instrument-overrides.json` and fill your local mappings
4. Run `npm.cmd run forum:sync`
5. Optionally publish to cloud with `npm.cmd run forum:publish`
6. Recommended one-shot trigger: `npm.cmd run forum:sync:publish`

The current sync auto-discovers dated concert threads from both `Dzial Koncert` (`fid=27`) and `Propozycje koncertow` (`fid=50`), filtered to the configured `eventYear`, unless `eventThreadUrls` is filled explicitly. It writes authenticated raw HTML into `.cache/forum-sync`, fetches poll results from `Ankieta`, parses setlist-like posts, and writes `.cache/forum-sync/snapshot.json`.
To explicitly refresh local fallback TypeScript snapshot, run sync with `FORUM_SYNC_WRITE_LOCAL_SNAPSHOT=1`.

Cloud-ready mode:

- If `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are set, the app reads from `forum_snapshot_cache` in Supabase.
- If they are missing or the cloud row is unavailable, the app falls back to local `forumSnapshot.ts`.
- Profile screen shows data source and `Last synced` timestamp from snapshot metadata.
- `forum:publish` expects `SUPABASE_URL` and a server key (`SUPABASE_SECRET_KEY` preferred, `SUPABASE_SERVICE_ROLE_KEY` legacy fallback) in your local shell and pushes `.cache/forum-sync/snapshot.json`.
- `forum:publish` reads `.env.local` and `.env` automatically before checking env variables.
- SQL bootstrap for the cloud table is in `supabase/migrations/001_forum_snapshot_cache.sql`.
- Authenticated-only reads are enforced by `supabase/migrations/004_snapshot_cache_authenticated_only.sql`.

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
4. Enable Actions and run workflow `Forum Sync Publish` manually once.
5. Keep or edit the cron (`17 */4 * * *`, UTC) in the workflow file.

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

- prefer `byFullName` for manual mapping
- `byUsername` still works as a fallback for cases where the full name is unknown
- `byUid` remains the most stable option if you ever want it later

Temporary limitation:

- the forum exposes attendance voters and member names cleanly
- it does not expose instruments in the same way
- `forum-sync.instrument-overrides.json` (local, gitignored) is the temporary bridge for squad composition until the real backend exists

## Next Build Targets

1. Replace temporary route state with real routing when we are ready.
2. Swap legacy fixture reads for real forum parsing or fetch logic.
3. Keep the adapter boundary intact so the final backend can replace the temporary source cleanly.
