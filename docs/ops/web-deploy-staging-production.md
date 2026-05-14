# Web Deploy Flow: Staging -> Production

## Goal

Stop auto-publishing `main` directly to production.

Current model:

- `main` updates staging automatically.
- production is promoted manually from a chosen ref.

## Workflows

- `.github/workflows/web-deploy-staging.yml`
  - triggers: push to `main`, or manual dispatch
  - deploy target: `gh-pages/staging`
  - URL: `https://<owner>.github.io/<repo>/staging/`

- `.github/workflows/web-deploy-pages.yml`
  - triggers: manual dispatch only
  - deploy target: `gh-pages` root
  - URL: `https://<owner>.github.io/<repo>/`

## GitHub Setup (One-Time)

1. `Settings -> Pages`
   - Source: **Deploy from a branch**
   - Branch: **gh-pages**
   - Folder: **/ (root)**
2. `Settings -> Environments`
   - create `staging`
   - create `production`
   - recommended for `production`: required reviewers
3. `Settings -> Secrets and variables -> Actions`
   - required:
     - `EXPO_PUBLIC_SUPABASE_URL`
     - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - optional staging overrides:
     - `EXPO_PUBLIC_SUPABASE_URL_STAGING`
     - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY_STAGING`
4. `Settings -> Actions -> General -> Workflow permissions`
   - set **Read and write permissions** (required for pushing deploy commits to `gh-pages`)

Migration tip (from old `GitHub Actions` Pages source):

1. Run `Deploy Web Production` once to seed `gh-pages`.
2. Then switch Pages source to `Deploy from a branch` (`gh-pages` / root).

## Promotion Procedure

1. Open PR and merge to `main`.
2. Wait for `Deploy Web Staging` success.
3. Validate staging URL.
4. Trigger `Deploy Web Production` manually.
5. Set `ref` to the validated commit SHA (or `main` if latest merge is validated).
6. Wait for `Deploy Web Production` success.

Guardrail:

- production workflow rejects refs that are not in `origin/main` history.

## Rollback

1. Trigger `Deploy Web Production` again.
2. Use previous known-good commit SHA in `ref`.
3. Confirm production URL after deploy.

## Notes

- Both workflows run `npm ci`, `npm run typecheck`, `npm run web:build:pages`.
- Build output path patching (`web:build:pages`) keeps static assets valid under repo subpaths.
- Production deploy preserves `/staging` files in `gh-pages` (`clean-exclude: staging`).
- Workflows enforce `.nojekyll` on `gh-pages`, required for Expo assets under `/_expo/**`.
