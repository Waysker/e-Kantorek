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
