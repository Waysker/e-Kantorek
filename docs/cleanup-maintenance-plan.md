# Cleanup and Maintenance Plan

## Scope

This plan converts the current attendance system into a safer and easier-to-maintain baseline.
Priority order: security/integrity first, then flow stability, then frontend maintainability, then docs/ops hygiene.

## Phase 0: Security Hotfix (immediate)

### Goals

- Prevent role escalation from user-controlled signup metadata.
- Restrict privileged RPC execution surface.

### Tasks

1. Patch `handle_new_auth_user_profile()` so `raw_user_meta_data.role` is never trusted for authorization.
2. Revoke `EXECUTE` from `PUBLIC` for privileged scheduler/worker functions and re-grant only to `service_role`.
3. Verify `change_journal` RLS migration is applied in all environments.

### Acceptance

- New signups default to `member` role unless elevated by admin-controlled path.
- Scheduler/worker RPC cannot be executed by `anon`/`authenticated` unless explicitly granted.

## Phase 1: Write Path Integrity

### Goals

- Make queue processing crash-safe and idempotent.
- Eliminate silent DB/sheet divergence.

### Tasks

1. Add lease/reclaim semantics for `attendance_change_queue` (`processing` timeout reclaim).
2. Handle failure-path queue update errors explicitly in worker process mode.
3. Fix `db_first` export trigger path to work with `eventId`-only requests.
4. Make batch enqueue atomic via RPC/transaction.
5. Fix event identity strategy to be stable against source header normalization.

### Acceptance

- No permanently stuck queue rows after worker crash.
- No successful API response with silently failed status transitions.
- `db_first` writes always have deterministic export behavior.

## Phase 2: Sync/Export Consistency

### Goals

- Ensure DB -> sheet export maps rows correctly across tabs.
- Avoid losing pending intents during event dedupe.

### Tasks

1. Scope fallback row mapping by `(sheet_id, gid, member_id)` during export.
2. Harden dedupe migration logic to preserve or dead-letter unresolved open queue rows before delete.
3. Add missing supporting indexes for query/RLS hot paths.

### Acceptance

- Export writes to expected rows in month tabs.
- No open queue intent is dropped by dedupe flow.

## Phase 3: Frontend Stability and Performance

### Goals

- Remove critical loading/state races.
- Reduce screen complexity and rerender cost.

### Tasks

1. Fix `AttendanceManagerScreen` loading lifecycle for virtual/no-event sessions.
2. Refactor `AttendanceManagerScreen` into smaller hooks/components.
3. Replace large `ScrollView` member rendering with `FlatList`/`SectionList`.
4. Shift app bootstrap to list-first loading and lazy event-detail loading.

### Acceptance

- No infinite spinner on session switch.
- Faster startup and lower risk of regressions in attendance manager changes.

## Phase 4: Documentation and Operations Hygiene

### Goals

- Create one operational source of truth.
- Remove stale docs ambiguity.

### Tasks

1. Update `app/README.md` to current runtime (roles, write paths, migrations >= 018).
2. Split docs into `ops/`, `reference/`, `contracts/`, `archive/`.
3. Add canonical env/secrets matrix (GitHub vs Supabase).
4. Add runbooks mapping common function errors to remediation.
5. Adopt hybrid smoke model:
   - smoke logic + test-user credentials in Supabase Edge Function secrets,
   - GitHub Actions keeps only smoke trigger token + project ref.

### Acceptance

- New contributor can set up and operate pipelines without guessing.
- No conflicting statements about read-only vs write-enabled architecture.

## Phase 5: CI Quality Gates

### Goals

- Catch breakages before merge.

### Tasks

1. Add CI workflow with `npm ci` + `npm run typecheck`.
2. Add minimal smoke checks for sync function contracts.
3. Add `smoke_attendance_db_first` quality gate:
   - direct function trigger from GitHub workflow,
   - fixed smoke target row (`event_id + member_id`) to avoid random data mutation.

### Acceptance

- PRs are blocked on type/build regressions.
- Smoke regression run validates db_first write path end-to-end with rollback.

## Regression Gate (apply to every phase)

Run this checklist before merge:

1. `npm run typecheck` in `app`.
2. Manual worker smoke:
   - enqueue one change,
   - run process mode,
   - verify queue row leaves `processing`,
   - verify `sync_runs` has terminal status.
3. Verify role management still works:
   - admin can set role,
   - non-admin cannot set role.
4. Verify app attendance manager:
   - switching dates/sessions does not leave loading spinner stuck,
   - batch save feedback still appears.
5. Verify smoke guardrail:
   - `smoke_attendance_db_first` returns `status=ok`,
   - target row ratio is restored to original value after run.
