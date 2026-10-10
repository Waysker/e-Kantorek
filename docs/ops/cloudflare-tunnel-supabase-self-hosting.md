# Self-hosted Supabase on Orbit

## Current state

The e-Kantorek Supabase project is running as a self-hosted copy on the Ubuntu server `orbit`. The original Supabase Cloud project has been retained as a fallback; this setup does not delete or modify it. The production web app and forum sync now target the self-hosted copy.

| Component | Current configuration |
| --- | --- |
| Server | `orbit` (Ubuntu; LAN address can change) |
| Compose project directory | `/home/waysker/supabase-selfhost-test` |
| Public API hostname | `https://e-kantorek-supabase.waysker.fyi` |
| Cloudflare Tunnel | `orbit-supabase` (managed in Cloudflare dashboard; connected) |
| Tunnel origin | `http://127.0.0.1:18080` on Orbit |
| Local API filter | Caddy; publishes only selected Supabase API paths |
| Postgres | Supabase Postgres 17 container; port 5432 remains private |
| Studio | Private; do not publish through the tunnel |

Public routing is:

```text
e-Kantorek web / GitHub Actions
  -> HTTPS e-kantorek-supabase.waysker.fyi
  -> Cloudflare DNS and named Tunnel
  -> cloudflared on Orbit (outbound connection)
  -> 127.0.0.1:18080 Caddy API filter
  -> private Docker network / Supabase API gateway
  -> private Postgres
```

Cloudflare Tunnel is outbound-only; no router port forwarding is needed. Do not expose Postgres, Studio, Docker socket, or other host services. Do not replace Orbit's existing Nginx, Pterodactyl, or playit setup as part of Supabase maintenance.

## Data copy and fallback

The Cloud project was copied into the self-hosted database using a logical dump. The dump files were `cloud-roles.sql`, `cloud-schema.sql`, and `cloud-data.sql` (the data dump was about 155 MB). The import completed after granting the local `postgres` role the necessary rights to the `storage` schema through `supabase_admin`.

The following checks were observed after import:

- `auth.users`: 17 users.
- Public application tables included 3,646 `attendance_entries`, 31,973 `change_journal` rows, 49,171 `sync_runs`, 22,041 `sync_issues`, and 85 `members`.
- `storage.buckets` and `storage.objects`: 0 rows at the time checked. There were no Storage objects to copy then.
- `forum_snapshot_cache` and `forum_instrument_overrides` exist in the local database and are used by sync/publish.

These are point-in-time counts, not ongoing expected values. The Cloud project remains available as the rollback/reference copy. If returning to Cloud, restore the app URL and publishable key to Cloud values and update the server-side `SUPABASE_URL` and key to Cloud values before re-running jobs. Do not delete the Cloud project until the self-hosted backup and restore have been independently verified.

## GitHub Actions configuration

The repository-level Actions secrets are used by the production build and forum sync:

| Secret | Purpose | Value/source |
| --- | --- | --- |
| `SUPABASE_URL` | Shared project URL for the web build and server-side sync workflows | `https://e-kantorek-supabase.waysker.fyi` |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public client access from the web app | Self-hosted project's publishable/anon key |
| `SUPABASE_SECRET_KEY` | Privileged server-side sync/publish access | Self-hosted `SERVICE_ROLE_KEY` (or equivalent server secret) from Orbit's private `.env` |
| `ORAGH_FORUM_USERNAME` / `ORAGH_FORUM_PASSWORD` | Authenticate the forum scraper | Repository secrets; never commit |

`SUPABASE_URL` is intentionally the single GitHub secret for the project URL. The production and staging web workflows pass it to Expo under the build-time variable name `EXPO_PUBLIC_SUPABASE_URL`. The local app still uses `EXPO_PUBLIC_SUPABASE_URL` in the ignored `app/.env`, because Expo reads that client-side variable when building/running locally.

The publishable key is safe to embed in the client. `SUPABASE_SECRET_KEY` is privileged: never use it as an Expo variable, put it in `app/.env` for a client build, commit it, or paste it into chat. Do not confuse the database password with the Supabase service key. Do not use the Cloud project's old secret for the self-hosted database.

Forum sync workflow: `.github/workflows/forum-sync-publish.yml` (`Forum Sync Publish`). It runs on a four-hour schedule and can be started manually from GitHub Actions. It reads `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, fetches instrument overrides, syncs the forum snapshot, and upserts the snapshot to Supabase. The first run that still used the Cloud URL failed with `exceed_db_size_quota`; rerunning after updating the server-side GitHub secrets is required. Secret changes do not alter a workflow run that is already in progress.

Production web deploy is manual: `.github/workflows/web-deploy-pages.yml` (`Deploy Web Production`). After changing its workflow configuration on `main`, run the workflow to rebuild the deployed client with the shared URL. Staging deploys automatically on pushes to `main` matching the configured paths.

## Operating commands

Run on Orbit from the Compose directory. Use `sudo` if the account cannot access the Docker daemon directly:

```bash
cd /home/waysker/supabase-selfhost-test
sudo docker compose -f docker-compose.yml -f docker-compose.orbit-quick.yml ps
sudo docker compose -f docker-compose.yml -f docker-compose.orbit-quick.yml up -d --wait
```

Check the public API health endpoint in a browser:

```text
https://e-kantorek-supabase.waysker.fyi/auth/v1/health
```

GoTrue may answer `Unauthorized` to a bare request. That alone does not indicate the API is down. A successful response with the API key includes the GoTrue version and service description. The local Supabase Studio is an admin interface and is not exposed via the public API hostname.

To inspect GitHub Actions sync results, open **Actions → Forum Sync Publish**. Successful logs should show the snapshot publish completing without the Cloud `exceed_db_size_quota` error. Never add secret values to troubleshooting logs or documentation.

## Backups and routine care

- Keep regular encrypted, off-host backups of the self-hosted database and store backup credentials separately. A logical SQL dump is useful for portability; it is not a substitute for a tested restore.
- Keep Orbit's Compose files, `.env`, and dump files out of Git. Restrict `.env` and backup permissions; do not print secret values into chat or CI logs.
- Back up Supabase Storage object files separately if buckets are added. A database dump does not include object bytes.
- Keep the original Cloud project until a restore from a self-hosted backup has been tested and the application has operated successfully through an agreed observation period.
- Review Auth site URL/redirect URLs, SMTP/provider configuration, Edge Function secrets, scheduled jobs, and Google integrations when changing the public hostname or restoring to a new server.
- If Orbit's LAN IP changes, the Cloudflare Tunnel should continue to connect outbound. The tunnel origin remains loopback `127.0.0.1:18080`; check the `cloudflared` service and local API filter rather than changing the public DNS record to the LAN address.

## Related files

- `ops/orbit/supabase/docker-compose.quick-tunnel.yml` — API filter Compose override kept in the repository.
- `ops/orbit/supabase/Caddyfile.quick-tunnel` — Caddy path filter configuration.
- `.github/workflows/forum-sync-publish.yml` — forum sync and snapshot publish.
- `.github/workflows/web-deploy-pages.yml` — production web deployment.
- `.github/workflows/web-deploy-staging.yml` — staging web deployment.
- `app/.env.example` — local environment variable names; contains no real keys.

## Context for future agents

Treat this document as the current operational baseline. The self-hosted database is the active target; the Cloud database is retained as fallback. Read this runbook before changing Supabase URLs, tunnel routing, GitHub secrets, or database restore procedures. Ask the project owner to execute privileged Orbit commands when interactive `sudo` is required. Never infer or request secret values in chat.
