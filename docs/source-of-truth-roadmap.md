# Source of Truth Roadmap (Google Sheet -> Supabase -> Google Sheet View)

## Goal

Build a safe migration path:

1. **Phase A**: Google Sheet is the source of truth, Supabase is synchronized read model.
2. **Phase B**: Supabase becomes the source of truth, Google Sheet remains a synchronized export/view layer.

This plan avoids hard cutovers and keeps rollback options available.

---

## Guiding principles

- Keep writes single-path for each phase (no dual-write from clients).
- Make every sync idempotent and observable.
- Add stable identifiers early (`member_id`, `event_id`) to avoid migration pain later.
- Use feature flags for source switching (`SHEET_PRIMARY` vs `SUPABASE_PRIMARY`).

---

## Phase A: Sheet primary, Supabase replica

### A1. Data contract and validation

- Freeze sheet contract (columns, date format, attendance semantics `0..1`).
- Keep preflight validation as a required gate before sync.
- Reject invalid batches (do not partially publish malformed data).

Deliverables:

- `docs/attendance-sheet-contract.md`
- `scripts/attendance-sheet-preflight.mjs`

### A2. Canonical Supabase schema

Create normalized tables:

- `members` (`member_id`, names, instrument, active flags, timestamps)
- `events` (`event_id`, title, event_date, metadata)
- `attendance_entries` (`member_id`, `event_id`, `attendance_ratio`, source metadata, timestamps)

Operational tables:

- `sync_runs` (status, started/finished, counters)
- `sync_issues` (validation/sync errors)
- `change_journal` (write history + actor)

### A3. Scheduled sync (sheet -> supabase)

- Supabase Cron every 5 minutes invokes Edge Function `sheet_to_supabase_sync`.
- Function flow:
  1. fetch sheet CSV
  2. run preflight parser/validator
  3. if valid: upsert normalized data in one logical batch
  4. record `sync_runs` + `sync_issues`

### A4. Write path in Phase A (sheet-first)

- App writes through one backend endpoint/function:
  - `attendance_write_sheet_first`
- Backend writes to Google Sheet first.
- Then triggers immediate or near-immediate sync to Supabase.
- App never writes canonical attendance rows directly in Phase A.

### A5. Security and permissions

- RLS: app clients get read-only access to canonical attendance tables.
- Service role only for sync/write functions.
- Store Google credentials only in server-side secrets.

### A6. Monitoring and operations

- Metrics:
  - last successful sync timestamp
  - sync duration
  - error count
  - staleness SLA (e.g. >15 min alert)
- Add on-call runbook for:
  - invalid sheet headers
  - malformed dates
  - credential failure
  - partial data mismatch

---

## Phase B preparation: dual consistency checks

Before flipping source of truth:

- Build exporter `supabase_to_sheet_export` (dry-run first).
- Add diff checker:
  - compare sheet-derived model vs supabase model
  - report mismatches by `member_id` + `event_id`
- Run shadow mode for at least 1-2 weeks with no critical drift.

Recommended sheet structure at this stage:

- `Input` tab (current editable source during Phase A)
- `View` tab (generated from Supabase, read-only style)

---

## Phase B: Supabase primary, Sheet as export/view

### B1. Flip source mode

- Change config flag to `SUPABASE_PRIMARY`.
- Client writes now go directly to backend -> Supabase canonical tables.
- Google Sheet updated via exporter job only.

### B2. Keep Google Sheet as user-facing view

- Scheduled export job (`supabase_to_sheet_export`) updates `View` tab.
- Optional: lock or archive `Input` tab to prevent accidental edits.

### B3. Rollback strategy

- Keep `SHEET_PRIMARY` path functional for one release window.
- Rollback condition examples:
  - export lag above SLA
  - high write failure rate
  - unresolved drift in diff checker

Rollback action:

- Toggle source flag back to `SHEET_PRIMARY`.
- Continue sheet-first writes while investigating.

---

## Milestones and acceptance criteria

### Milestone 1: Phase A operational

Acceptance:

- sheet->supabase sync runs automatically every 5 min
- no invalid data enters canonical tables
- app reads from Supabase successfully
- operators can trace failures via `sync_runs`/`sync_issues`

### Milestone 2: Flip readiness

Acceptance:

- stable IDs present across all active members/events
- exporter dry-run and diff checker stable
- no severe drift for defined observation period

### Milestone 3: Phase B live

Acceptance:

- writes persist in Supabase and appear in sheet export on schedule
- user workflows continue without regression
- rollback tested and documented

---

## Immediate next actions (recommended order)

1. Fix current sheet date header errors flagged by preflight.
2. Add normalized Supabase tables + migration scripts.
3. Implement `sheet_to_supabase_sync` Edge Function + Supabase Cron.
4. Add `sync_runs` / `sync_issues` logging.
5. Route app writes through one backend path (`attendance_write_sheet_first`).
6. Add source mode flag and scaffolding for future flip.

---

## Notes

- Attendance values are interpreted as **percentage ratios** (`0..1`), e.g. `0.5` = 50%.
- Date format should be normalized to `YYYY-MM-DD` in event headers for deterministic parsing.
