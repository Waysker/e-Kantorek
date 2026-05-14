# Attendance Sheet Contract (PoC v1)

This contract defines how the workbook/Google Sheet is interpreted before publishing attendance and instrument data to Supabase.

## Input Layout

Expected first row (header):

- Column `A`: section/instrument label (`Flety`, `Klarnety`, etc.)
- Column `B`: list position (`L.p.`)
- Column `C`: last name (`Nazwisko`)
- Column `D`: first name (`Imię`)
- Columns `E+`: events (one event per column)

Section rules:

- A non-empty value in column `A` sets active section for following rows.
- Empty `A` means “use previous section”.
- Rows with no name in `C` and `D` are skipped.

## Attendance Semantics

Attendance is stored as attendance ratio + percentage:

- `1` => `ratio=1.0`, `percent=100`
- `0.75` => `ratio=0.75`, `percent=75`
- `0,5` => `ratio=0.5`, `percent=50`
- `75%` => `ratio=0.75`, `percent=75`
- `75` => interpreted as `75%` with warning
- empty cell => `no declaration` (`null`)

Valid range is `0..1` after normalization.

## Event Header Rules

Event header is parsed from each non-empty column in `E+`.

Supported date tokens:

- `YYYY-MM-DD` (preferred)
- `DD.MM` (year inferred from dominant year in sheet, warning emitted)
- `YYYY-DD` (month inferred from tab/month context, warning emitted)
- ambiguous day-month headers are normalized using per-sheet day-month style inference (warning emitted)

Additional parser behavior:

- if a single event column has no explicit date token, parser may infer date from neighboring event columns in the same month (warning emitted)
- if date is still not parseable, provide a manual override via runtime secret `ATTENDANCE_EVENT_DATE_OVERRIDES_JSON` keyed by `sourceRef` + `columnRef`

Invalid date tokens (without successful inference or override) produce validation issues and should be treated as contract violations.

## Function Response Contract (Pinned Fields)

`sheet_to_supabase_sync` response MUST include:

- top-level:
  - `run_id` (string UUID)
  - `status` (`success` | `dry_run` | `failed`)
  - `dry_run` (boolean)
  - `summary` (object when `status != failed`)
- summary core fields:
  - `errors_count` (number)
  - `warnings_count` (number)
  - `attendance_entries_skipped_due_to_invalid_events` (number, `0` in dry-run)
  - `source_resolution_mode`
  - `sources_count`
  - `sources_total_count`
  - `source_slice_applied`
  - `source_slice_offset`
  - `source_slice_limit`

Pinned example (`dry_run=true`):

```json
{
  "run_id": "c5e9e607-d2e8-411d-9909-6fcafe2974e2",
  "status": "dry_run",
  "dry_run": true,
  "summary": {
    "trigger": "smoke_contract",
    "source_resolution_mode": "auto_discovered",
    "sources_count": 9,
    "sources_total_count": 9,
    "source_slice_applied": false,
    "source_slice_offset": 0,
    "source_slice_limit": null,
    "errors_count": 0,
    "warnings_count": 65,
    "attendance_entries_skipped_due_to_invalid_events": 0
  }
}
```

`smoke_attendance_db_first` response MUST include:

- `status` = `ok` for successful run
- rollback proof fields:
  - `original_ratio`
  - `temporary_ratio`
- when `checkSyncContract=true`:
  - `sync_contract_check.http_status`
  - `sync_contract_check.status`
  - `sync_contract_check.errors_count`
  - `sync_contract_check.attendance_entries_skipped_due_to_invalid_events`

Pinned smoke example:

```json
{
  "status": "ok",
  "smoke_run_tag": "smoke_attendance_db_first:83c5b39f-82c6-4af4-9898-41da91e9fa6e",
  "mode": "db_first",
  "event_id": "evt-2026-04-14-proba",
  "member_id": "member-depczynska-julia-flety",
  "original_ratio": 1,
  "temporary_ratio": 0.5,
  "require_export_trigger_ok": true,
  "check_sync_contract": true,
  "sync_contract_check": {
    "http_status": 200,
    "status": "dry_run",
    "dry_run": true,
    "errors_count": 0,
    "attendance_entries_skipped_due_to_invalid_events": 0,
    "warnings_count": 65
  }
}
```

## Data Quality Checklist

Run this checklist before each publish:

1. Header row has expected base columns (`L.p.`, `Nazwisko`, `Imię`).
2. All event columns have a parseable date token, or an explicit override entry for known immutable headers.
3. No invalid attendance values (`text`, negative values, values above 100%).
4. Names are complete (`Nazwisko` + `Imię` both set).
5. Section context is present for each participant row.
6. Duplicate participant keys are reviewed.
7. Warnings are acknowledged before publish.

## Preflight Script

Script path:

- `app/scripts/attendance-sheet-preflight.mjs`

Examples:

```bash
# Validate Google Sheet tab directly
node ./scripts/attendance-sheet-preflight.mjs \
  --sheet-id 1pEq8Yd9G_ChaEelVk5IHm62yVBvQ5Nk1Myfq-_pAYyA \
  --gid 1159271380 \
  --strict \
  --out .cache/forum-sync/attendance-preflight.json

# Validate local CSV export
node ./scripts/attendance-sheet-preflight.mjs \
  --csv ./attendance.csv \
  --strict \
  --out ./attendance-preflight.json
```

If `--strict` is enabled, the script exits with code `1` when validation errors are present.
