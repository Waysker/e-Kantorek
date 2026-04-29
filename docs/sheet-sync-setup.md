# Sheet -> Supabase Sync Setup (Dry-Run)

This document describes how to run the new dry-run sync pipeline:

- Google Sheet CSV source
- Supabase Edge Function `sheet_to_supabase_sync`
- Supabase Cron every 5 minutes

Current baseline expects migrations through `023_atomic_enqueue_batch_rpc.sql` to be applied.

## 1. Apply migrations

Run migrations so required tables/functions exist:

- `app/supabase/migrations/010_attendance_sync_foundation.sql`
- `app/supabase/migrations/011_sheet_sync_scheduler_helpers.sql`

## 2. Deploy Edge Function

From `app` directory:

```bash
supabase functions deploy sheet_to_supabase_sync --no-verify-jwt
```

Recommended env vars for the function:

- `ATTENDANCE_SHEET_ID`
- `ATTENDANCE_SHEET_GID`
- `ATTENDANCE_SHEET_SOURCES_JSON` (optional; JSON array of `{ "sheetId": "...", "gid": "...", "label": "..." }`)
- `ATTENDANCE_SHEET_AUTO_DISCOVER_SOURCES` (optional; `true/false`, default `false`)
- `GOOGLE_SHEETS_API_KEY` (optional; recommended for robust auto-discovery via Sheets API)
- `ATTENDANCE_SHEET_DISCOVER_INCLUDE_HIDDEN` (optional; include hidden tabs when auto-discovering)
- `ATTENDANCE_EVENT_DATE_OVERRIDES_JSON` (optional; JSON array with forced `eventDate` by `sourceRef + columnRef`)
- `SHEET_SYNC_FUNCTION_AUTH_TOKEN` (shared secret for manual + cron calls)
- `SHEET_SYNC_DRY_RUN_ONLY=true`
- `SHEET_SYNC_DEFAULT_DRY_RUN=true`

When `ATTENDANCE_SHEET_SOURCES_JSON` is provided, it takes precedence over single `ATTENDANCE_SHEET_ID/GID`.

Auto-discovery mode:

- set `ATTENDANCE_SHEET_AUTO_DISCOVER_SOURCES=true`
- set `ATTENDANCE_SHEET_ID=<spreadsheet-id>`
- function discovers all tabs (`gid`) via Google Sheets API (when key is present) or public `htmlview` fallback (without key)
- tabs that do not look like attendance are skipped with warning `source_skipped_non_attendance_layout`
- parser also supports `YYYY-DD` tokens (month inferred from tab context); warnings are logged as `event_month_inferred`
- if month still cannot be inferred and token looks like `YYYY-MM`, parser falls back to `YYYY-MM-01` with warning `event_month_interpreted_from_yyyy_mm_token`
- parser auto-detects day-month style (`YYYY-DD-MM`) on a per-sheet basis and normalizes ambiguous tokens (`event_date_style_inferred_day_month`)
- if a single header column has no date token but both neighboring columns have close dates in the same month, parser infers date from neighbors (`event_date_inferred_from_neighbors`)

Immutable reference sheet workaround:

- if a column has no parseable date token (example: `Warsztaty TILL AGH`), define override via
  `ATTENDANCE_EVENT_DATE_OVERRIDES_JSON`
- format:

```json
[
  {
    "sourceRef": "1CGIEDfRTiNVKDllaVCZGh3TcseN9udtkKIyjKgskjEM:675114180",
    "columnRef": "M",
    "eventDate": "2025-11-15",
    "title": "Warsztaty TILL AGH"
  }
]
```

## 3. Smoke test manual invocation

```bash
curl -sS \
  -X POST \
  "https://<project-ref>.functions.supabase.co/sheet_to_supabase_sync" \
  -H "Authorization: Bearer <SHEET_SYNC_FUNCTION_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"trigger":"manual"}'
```

Optional manual override for many tabs:

```bash
curl -sS \
  -X POST \
  "https://<project-ref>.functions.supabase.co/sheet_to_supabase_sync" \
  -H "Authorization: Bearer <SHEET_SYNC_FUNCTION_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "trigger":"manual",
    "sources":[
      {"sheetId":"<id>","gid":"<gid-1>","label":"2025-09"},
      {"sheetId":"<id>","gid":"<gid-2>","label":"2025-10"}
    ]
  }'
```

Expected:

- response includes `run_id`
- `sync_runs` gets a row with status `dry_run` or `failed`
- `sync_issues` includes validation findings when data is malformed

## 3a. Automated regression check (db_first write path)

Manual SQL/curl checks are still useful for debugging, but default regression path should be automated.

Recommended model is hybrid:

- smoke execution is inside Supabase function `smoke_attendance_db_first`,
- GitHub Actions only triggers that function via bearer token.

The smoke run performs:

1. login with a manager account (`section`, `board`, or `admin`),
2. `attendance_write_sheet_first` call in `enqueue_batch` mode with `eventId`-only request,
3. DB assertion (`attendance_entries` value changed),
4. rollback assertion (original value restored).

Supabase function secrets:

- `SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN`
- `SMOKE_ATTENDANCE_TEST_EMAIL`
- `SMOKE_ATTENDANCE_TEST_PASSWORD`
- `SMOKE_ATTENDANCE_EVENT_ID`
- `SMOKE_ATTENDANCE_MEMBER_ID`
- optional `SMOKE_ATTENDANCE_REQUIRE_EXPORT_TRIGGER_OK=true`

Deploy:

```bash
supabase functions deploy smoke_attendance_db_first --no-verify-jwt
```

GitHub workflow inputs:

- secret: `SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN`
- variable: `SUPABASE_PROJECT_REF`
- optional variable: `SMOKE_REQUIRE_EXPORT_TRIGGER_OK`

Manual trigger:

```bash
curl -sS -X POST \
  "https://<project-ref>.functions.supabase.co/smoke_attendance_db_first" \
  -H "Authorization: Bearer <SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"requireExportTriggerOk":false}'
```

Local fallback smoke (debug only):

- `app/scripts/smoke-attendance-db-first.mjs`
- `npm run smoke:attendance:db-first`

## 4. Schedule every 5 minutes

Run in SQL editor:

```sql
select public.schedule_sheet_to_supabase_sync(
  function_url := 'https://<project-ref>.functions.supabase.co/sheet_to_supabase_sync',
  bearer_token := '<SHEET_SYNC_FUNCTION_AUTH_TOKEN>',
  cron_expression := '*/5 * * * *',
  job_name := 'sheet_to_supabase_sync_5m'
);
```

To remove the schedule:

```sql
select public.unschedule_sheet_to_supabase_sync('sheet_to_supabase_sync_5m');
```

## 5. Observe run health

Quick checks:

```sql
select id, status, started_at, finished_at, summary
from public.sync_runs
order by started_at desc
limit 20;

select run_id, severity, code, message, row_number, column_ref
from public.sync_issues
order by created_at desc
limit 100;
```

## Enable write mode (next phase)

When ready to write canonical tables:

1. Apply `app/supabase/migrations/012_sheet_sync_upsert_enablement.sql`
2. Set function env:
   - `SHEET_SYNC_DRY_RUN_ONLY=false`
   - `SHEET_SYNC_DEFAULT_DRY_RUN=false`
3. Re-deploy function:

```bash
supabase functions deploy sheet_to_supabase_sync --no-verify-jwt
```

4. Recreate cron schedule (unschedule + schedule) so new payload (`dryRun=false`) is used.

After this, successful runs should end with `status='success'` and upsert into:

- `public.members`
- `public.events`
- `public.attendance_entries`

Stale attendance cleanup:

- write-mode run now prunes stale `attendance_entries` for events touched in the current sync
- this means blanked cells in source sheets are reflected in Supabase for those events

## Phase A write path: management panel -> queue -> Google Sheet -> sync

Google Sheet remains source of truth. Event RSVP screen stays read-only; actual attendance is written by leader/admin panel.

### 1. Apply migration

Run:

- `app/supabase/migrations/013_attendance_sheet_first_write_path.sql`

This adds:

- `events.source_sheet_id/source_gid`
- `sheet_member_rows` mapping
- `profile_member_links`
- `attendance_change_queue`
- scheduler SQL helpers for queue worker

### 2. Deploy/refresh Edge Functions

From `app`:

```bash
supabase functions deploy sheet_to_supabase_sync --no-verify-jwt
supabase functions deploy attendance_write_sheet_first --no-verify-jwt
```

### 3. Required function secrets

Set on project:

- `ATTENDANCE_WRITE_FUNCTION_AUTH_TOKEN` (used by worker mode + cron)
- `ATTENDANCE_APPS_SCRIPT_WEBHOOK_URL` (Apps Script Web App URL)
- `ATTENDANCE_APPS_SCRIPT_WEBHOOK_TOKEN` (shared secret for webhook auth)
- `SHEET_TO_SUPABASE_SYNC_URL` (full URL to `sheet_to_supabase_sync`)
- `SHEET_TO_SUPABASE_SYNC_TOKEN` (same token used by sync function)
- optional:
  - `ATTENDANCE_SHEET_ID` + `ATTENDANCE_SHEET_GID` (emergency fallback only; normal flow resolves `gid` by event date/month from existing mapped events)
  - `ATTENDANCE_WRITE_PROCESS_BATCH_SIZE` (default `25`)
  - `ATTENDANCE_WRITE_MAX_ATTEMPTS` (default `5`)
  - `ATTENDANCE_WRITE_ALLOW_CRON_SYNC_FALLBACK` (default `false`; when `false`, process mode fails if sync trigger cannot run)

`sheet_to_supabase_sync` still needs:

- `SHEET_SYNC_DRY_RUN_ONLY=false`
- `SHEET_SYNC_DEFAULT_DRY_RUN=false`

### 3a. Minimal Apps Script webhook (no Google Cloud project required)

Create a script in Google Apps Script attached to the workbook and deploy as Web App.

```javascript
function columnRefToNumber(columnRef) {
  var normalized = String(columnRef || "").toUpperCase();
  var col = 0;
  for (var i = 0; i < normalized.length; i++) {
    col = col * 26 + (normalized.charCodeAt(i) - 64);
  }
  return col;
}

function numberToColumnRef(columnNumber) {
  var n = Number(columnNumber || 0);
  var label = "";
  while (n > 0) {
    var remainder = (n - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function normalizeIsoDate(raw) {
  var value = String(raw || "").trim();
  var exact = value.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (exact) return exact[1];
  var fromIso = value.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (fromIso) return fromIso[1];
  return "";
}

function monthKeyFromIsoDate(isoDate) {
  return String(isoDate || "").slice(0, 7);
}

function monthLabelFromIsoDate(isoDate) {
  var monthKey = monthKeyFromIsoDate(isoDate);
  if (!monthKey) return "";
  return "Obecnosc " + monthKey;
}

function normalizeSearchText(value) {
  var text = String(value || "");
  if (typeof text.normalize === "function") {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

var MONTH_KEYWORDS = [
  { month: 1, keywords: ["styczen", "stycznia", "jan", "january"] },
  { month: 2, keywords: ["luty", "lutego", "feb", "february"] },
  { month: 3, keywords: ["marzec", "marca", "mar", "march"] },
  { month: 4, keywords: ["kwiecien", "kwietnia", "apr", "april"] },
  { month: 5, keywords: ["maj", "maja", "may"] },
  { month: 6, keywords: ["czerwiec", "czerwca", "jun", "june"] },
  { month: 7, keywords: ["lipiec", "lipca", "jul", "july"] },
  { month: 8, keywords: ["sierpien", "sierpnia", "aug", "august"] },
  { month: 9, keywords: ["wrzesien", "wrzesnia", "sep", "september"] },
  { month: 10, keywords: ["pazdziernik", "pazdziernika", "oct", "october"] },
  { month: 11, keywords: ["listopad", "listopada", "nov", "november"] },
  { month: 12, keywords: ["grudzien", "grudnia", "dec", "december"] }
];

function parseYearToken(token) {
  var value = String(token || "").trim();
  if (!/^\d{2,4}$/.test(value)) return null;
  if (value.length === 4) return Number(value);
  var yy = Number(value);
  return yy >= 70 ? (1900 + yy) : (2000 + yy);
}

function parseMonthKey(monthKey) {
  var match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  var year = Number(match[1]);
  var month = Number(match[2]);
  if (!year || month < 1 || month > 12) return null;
  return { year: year, month: month };
}

function resolveMonthFromName(normalizedName) {
  for (var i = 0; i < MONTH_KEYWORDS.length; i++) {
    var entry = MONTH_KEYWORDS[i];
    for (var j = 0; j < entry.keywords.length; j++) {
      if (normalizedName.indexOf(entry.keywords[j]) >= 0) {
        return entry.month;
      }
    }
  }
  return null;
}

function parseYearMonthFromSheetName(sheetName) {
  var raw = String(sheetName || "").trim();
  if (!raw) return null;

  var isoLike = raw.match(/\b(20\d{2})[.\-_/ ](0?[1-9]|1[0-2])\b/);
  if (isoLike) {
    return { year: Number(isoLike[1]), month: Number(isoLike[2]) };
  }

  var reversedIsoLike = raw.match(/\b(0?[1-9]|1[0-2])[.\-_/ ](20\d{2})\b/);
  if (reversedIsoLike) {
    return { year: Number(reversedIsoLike[2]), month: Number(reversedIsoLike[1]) };
  }

  var normalized = normalizeSearchText(raw);
  if (!normalized) return null;
  var month = resolveMonthFromName(normalized);
  if (!month) return null;

  var tokens = normalized.split(" ");
  var year = null;
  for (var idx = 0; idx < tokens.length; idx++) {
    var parsedYear = parseYearToken(tokens[idx]);
    if (parsedYear) {
      year = parsedYear;
      break;
    }
  }
  if (!year) return null;

  return { year: year, month: month };
}

function headerContainsMonth(sheet, targetYear, targetMonth) {
  var lastColumn = sheet.getLastColumn();
  if (lastColumn < 5) return false;

  var headerRow = sheet.getRange(1, 5, 1, lastColumn - 4).getDisplayValues()[0] || [];
  for (var i = 0; i < headerRow.length; i++) {
    var header = String(headerRow[i] || "").trim();
    if (!header) continue;

    var isoDate = normalizeIsoDate(header);
    var dateText = isoDate || header;
    var dateMatch = dateText.match(/\b(20\d{2})[.\-_/](0?[1-9]|1[0-2])[.\-_/](0?[1-9]|[12]\d|3[01])\b/);
    if (!dateMatch) continue;

    var year = Number(dateMatch[1]);
    var month = Number(dateMatch[2]);
    if (year === targetYear && month === targetMonth) {
      return true;
    }
  }

  return false;
}

function findMonthlyAttendanceSheet(ss, monthKey) {
  var parsedMonthKey = parseMonthKey(monthKey);
  if (!parsedMonthKey) return null;

  var directLabel = "Obecnosc " + monthKey;
  var direct = ss.getSheets().find(function (sheet) {
    return String(sheet.getName() || "").trim() === directLabel;
  });
  if (direct) return direct;

  var regex = new RegExp(monthKey.replace("-", "\\\\-"));
  var byMonthKeyInName = ss.getSheets().find(function (sheet) {
    return regex.test(String(sheet.getName() || "").trim());
  }) || null;
  if (byMonthKeyInName) return byMonthKeyInName;

  var byMonthNameAndYear = ss.getSheets().find(function (sheet) {
    var parsed = parseYearMonthFromSheetName(sheet.getName());
    return parsed &&
      parsed.year === parsedMonthKey.year &&
      parsed.month === parsedMonthKey.month;
  }) || null;
  if (byMonthNameAndYear) return byMonthNameAndYear;

  var byHeaderMonth = ss.getSheets().find(function (sheet) {
    return headerContainsMonth(sheet, parsedMonthKey.year, parsedMonthKey.month);
  }) || null;
  if (byHeaderMonth) return byHeaderMonth;

  return null;
}

function pickTemplateSheet(ss, suggestedGid, monthKey) {
  var allSheets = ss.getSheets();

  if (suggestedGid) {
    var fromGid = allSheets.find(function (sheet) {
      return String(sheet.getSheetId()) === String(suggestedGid);
    });
    if (fromGid) return fromGid;
  }

  var target = parseMonthKey(monthKey);
  if (!target) return allSheets[0] || null;

  var candidates = allSheets
    .map(function (sheet) {
      var parsed = parseYearMonthFromSheetName(sheet.getName());
      if (!parsed) return null;
      var distance = Math.abs((parsed.year - target.year) * 12 + (parsed.month - target.month));
      return { sheet: sheet, distance: distance };
    })
    .filter(function (item) { return item !== null; })
    .sort(function (a, b) { return a.distance - b.distance; });

  if (candidates.length > 0) {
    return candidates[0].sheet;
  }

  return allSheets[0] || null;
}

function ensureAttendanceMonthSheet(ss, eventDate, suggestedGid) {
  var monthKey = monthKeyFromIsoDate(eventDate);
  if (!monthKey) {
    throw new Error("invalid_event_date");
  }

  var existing = findMonthlyAttendanceSheet(ss, monthKey);
  if (existing) {
    return { sheet: existing, created: false };
  }

  var templateSheet = pickTemplateSheet(ss, suggestedGid, monthKey);
  if (!templateSheet) {
    throw new Error("template_sheet_not_found");
  }

  var created = templateSheet.copyTo(ss);
  var targetName = monthLabelFromIsoDate(eventDate);
  var finalName = targetName;
  var suffix = 2;
  while (ss.getSheets().some(function (sheet) { return sheet.getName() === finalName; })) {
    finalName = targetName + " (" + suffix + ")";
    suffix += 1;
  }
  created.setName(finalName);

  return { sheet: created, created: true };
}

function findColumnByDateToken(sheet, eventDate) {
  var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0] || [];
  for (var i = 4; i < headerRow.length; i++) {
    var header = String(headerRow[i] || "").trim();
    if (!header) continue;
    if (header.indexOf(eventDate) >= 0) {
      return { columnNumber: i + 1, header: header, created: false };
    }
  }
  return null;
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildCanonicalHeader(eventDate, eventTitle, sourceHeader) {
  var normalizedEventDate = String(eventDate || "").trim();
  var preferred = String(sourceHeader || "").trim();
  var fallbackTitle = String(eventTitle || "").trim();
  var base = preferred || fallbackTitle;
  var dateRegex = normalizedEventDate
    ? new RegExp("\\b" + escapeRegex(normalizedEventDate) + "\\b", "g")
    : null;

  var titleWithoutDate = String(base || "")
    .replace(dateRegex || /$^/, " ")
    .replace(/\s+/g, " ")
    .trim();
  var fallbackTitleWithoutDate = String(fallbackTitle || "")
    .replace(dateRegex || /$^/, " ")
    .replace(/\s+/g, " ")
    .trim();
  var resolvedTitle = titleWithoutDate || fallbackTitleWithoutDate || "Proba";

  if (!normalizedEventDate) {
    return resolvedTitle;
  }

  return resolvedTitle + "\n" + normalizedEventDate;
}

function applyHeaderCellStyle(cell) {
  cell.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  cell.setFontWeight("bold");
  cell.setHorizontalAlignment("center");
  cell.setVerticalAlignment("middle");
}

function ensureAttendanceColumn(sheet, eventDate, eventTitle, sourceHeader) {
  var existing = findColumnByDateToken(sheet, eventDate);
  var canonicalHeader = buildCanonicalHeader(eventDate, eventTitle, sourceHeader);

  if (existing) {
    var existingCell = sheet.getRange(1, existing.columnNumber);
    if (String(existing.header || "").trim() !== canonicalHeader) {
      existingCell.setValue(canonicalHeader);
    }
    applyHeaderCellStyle(existingCell);
    return { columnNumber: existing.columnNumber, header: canonicalHeader, created: false };
  }

  var lastColumn = Math.max(sheet.getLastColumn(), 4);
  var newColumn = lastColumn + 1;
  var headerCell = sheet.getRange(1, newColumn);
  headerCell.setValue(canonicalHeader);
  applyHeaderCellStyle(headerCell);
  return { columnNumber: newColumn, header: canonicalHeader, created: true };
}

function doPost(e) {
  try {
    var token = PropertiesService.getScriptProperties().getProperty("WEBHOOK_TOKEN");
    var auth = (e && e.parameter && e.parameter.token) || "";
    var body = JSON.parse(e.postData.contents || "{}");
    var providedToken = body.webhookToken || auth;
    if (!token || providedToken !== token) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "unauthorized" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var action = String(body.action || "").trim();
    var sheetId = String(body.sheetId || "");
    var gid = String(body.gid || "");
    var suggestedGid = String(body.suggestedGid || body.suggested_gid || gid || "");

    if (!action || !sheetId) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "invalid_payload" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var ss = SpreadsheetApp.openById(sheetId);

    if (action === "ensure_attendance_sheet") {
      var ensuredEventDate = normalizeIsoDate(body.eventDate || body.event_date);
      if (!ensuredEventDate) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, error: "invalid_event_date" }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      var ensuredSheetResult = ensureAttendanceMonthSheet(ss, ensuredEventDate, suggestedGid);
      SpreadsheetApp.flush();
      return ContentService
        .createTextOutput(JSON.stringify({
          ok: true,
          action: action,
          gid: String(ensuredSheetResult.sheet.getSheetId()),
          title: ensuredSheetResult.sheet.getName(),
          created: ensuredSheetResult.created
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (!gid) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "missing_gid" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var targetSheet = ss.getSheets().find(function (s) {
      return String(s.getSheetId()) === gid;
    });
    if (!targetSheet) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "sheet_not_found" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "ensure_attendance_column") {
      var eventDate = normalizeIsoDate(body.eventDate || body.event_date);
      if (!eventDate) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, error: "invalid_event_date" }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      var eventTitle = String(body.eventTitle || body.event_title || "");
      var sourceHeader = String(body.sourceHeader || body.source_header || "");
      var ensured = ensureAttendanceColumn(targetSheet, eventDate, eventTitle, sourceHeader);
      SpreadsheetApp.flush();

      return ContentService
        .createTextOutput(JSON.stringify({
          ok: true,
          action: action,
          columnRef: numberToColumnRef(ensured.columnNumber),
          header: ensured.header,
          created: ensured.created
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action !== "set_attendance_cell") {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "unsupported_action" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var rowNumber = Number(body.rowNumber || 0);
    var attendanceRatio = Number(body.attendanceRatio);
    var eventDateHint = normalizeIsoDate(body.eventDate || body.event_date);
    var eventTitleHint = String(body.eventTitle || body.event_title || "");
    var sourceHeaderHint = String(body.sourceHeader || body.source_header || "");
    var columnRefRaw = String(body.columnRef || "").toUpperCase();

    if (!rowNumber || isNaN(attendanceRatio)) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "invalid_payload" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var columnNumber = columnRefRaw ? columnRefToNumber(columnRefRaw) : 0;
    if (!columnNumber && eventDateHint) {
      columnNumber = ensureAttendanceColumn(targetSheet, eventDateHint, eventTitleHint, sourceHeaderHint).columnNumber;
    }

    if (!columnNumber) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "missing_column_ref" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    targetSheet.getRange(rowNumber, columnNumber).setValue(attendanceRatio);
    SpreadsheetApp.flush();

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, action: action, columnRef: numberToColumnRef(columnNumber) }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

In Script Properties set:

- `WEBHOOK_TOKEN=<same value as ATTENDANCE_APPS_SCRIPT_WEBHOOK_TOKEN>`

Important:

- keep the `findMonthlyAttendanceSheet` logic exactly as above; it matches both `Obecnosc YYYY-MM` and localized month tab names (for example `Kwiecień 26`) and also checks header dates to avoid creating duplicate month tabs.

Deploy:

1. `Deploy` -> `New deployment` -> `Web app`
2. Execute as: `Me`
3. Access: `Anyone with the link` (auth is handled by token)

Manual webhook test note:

- `script.google.com/.../exec` responds with `302` to `googleusercontent.com`.
- do not force method on redirect (`-X POST` with `-L` can cause `405`):

```bash
curl -iL 'https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec' \
  -H 'Content-Type: application/json' \
  -d '{"webhookToken":"<TOKEN>","action":"set_attendance_cell","sheetId":"<SHEET_ID>","gid":"<GID>","columnRef":"E","rowNumber":6,"attendanceRatio":0.5}'
```

### 4. Ensure event/member source mappings are populated

Run one manual sync write-mode call:

```bash
curl -sS -X POST \
  "https://<project-ref>.functions.supabase.co/sheet_to_supabase_sync" \
  -H "Authorization: Bearer <SHEET_SYNC_FUNCTION_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"trigger":"manual","dryRun":false}'
```

Expected in summary:

- `events_upserted > 0`
- `sheet_member_rows_upserted > 0`

### 5. Schedule queue worker

Run in SQL editor:

```sql
select public.schedule_attendance_write_sheet_first_worker(
  function_url := 'https://<project-ref>.functions.supabase.co/attendance_write_sheet_first',
  bearer_token := '<ATTENDANCE_WRITE_FUNCTION_AUTH_TOKEN>',
  cron_expression := '*/1 * * * *',
  job_name := 'attendance_write_sheet_first_worker_1m'
);
```

To remove:

```sql
select public.unschedule_attendance_write_sheet_first_worker('attendance_write_sheet_first_worker_1m');
```

### 6. Manual smoke tests

Process mode:

```bash
curl -sS -X POST \
  "https://<project-ref>.functions.supabase.co/attendance_write_sheet_first" \
  -H "Authorization: Bearer <ATTENDANCE_WRITE_FUNCTION_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"mode":"process","trigger":"manual","maxItems":10}'
```

Expected: if at least one queue row is applied to Sheet, the worker run should also include a successful `sync_trigger`.  
If `SHEET_TO_SUPABASE_SYNC_URL` is missing (and fallback flag is not enabled), process mode returns failed status by design.

Enqueue mode (leader/admin user access token, not worker token):

```bash
curl -sS -X POST \
  "https://<project-ref>.functions.supabase.co/attendance_write_sheet_first" \
  -H "Authorization: Bearer <USER_SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"eventId":"<event_id>","memberId":"<member_id>","attendanceRatio":1,"source":"manager_panel"}'
```

### 7. Observe queue + worker

```sql
select id, status, member_id, event_id, attempt_count, last_error, enqueued_at, processed_at, applied_cell_ref
from public.attendance_change_queue
order by id desc
limit 100;

select id, status, started_at, finished_at, summary, error_message
from public.sync_runs
where pipeline_name in ('attendance_write_sheet_first', 'sheet_to_supabase_sync')
order by started_at desc
limit 50;
```

## Dev mode: reference import + copy export

Use this when the reference Google Sheet is read-only (current real process), and your own copy is overwritten from DB for comparison.

### 1. Keep import source on reference sheet

Set on `sheet_to_supabase_sync`:

- `ATTENDANCE_SHEET_ID=<REFERENCE_SHEET_ID>`
- optional `ATTENDANCE_SHEET_AUTO_DISCOVER_SOURCES=true`

Example reference ID:

- `1CGIEDfRTiNVKDllaVCZGh3TcseN9udtkKIyjKgskjEM`

### 2. Switch writes to DB-first mode

Set on `attendance_write_sheet_first`:

- `ATTENDANCE_WRITE_SOURCE_MODE=db_first`
- optional `ATTENDANCE_WRITE_TRIGGER_DB_EXPORT=true`
- optional `DB_TO_SHEET_EXPORT_URL=https://<project-ref>.functions.supabase.co/supabase_to_sheet_export`
- optional `DB_TO_SHEET_EXPORT_TOKEN=<shared-token>`

In `db_first` mode:

- app writes are upserted directly to `public.attendance_entries`
- queue `process` path is skipped
- optional per-event export trigger can run after successful write (changed members only; does not rewrite whole column)

### 3. Deploy DB -> copy exporter

Deploy:

```bash
supabase functions deploy supabase_to_sheet_export --no-verify-jwt
```

Required env for `supabase_to_sheet_export`:

- `ATTENDANCE_EXPORT_TARGET_SHEET_ID=<WORKING_COPY_SHEET_ID>`
- `ATTENDANCE_APPS_SCRIPT_WEBHOOK_URL=<apps-script-webhook-url>`
- `ATTENDANCE_APPS_SCRIPT_WEBHOOK_TOKEN=<webhook-token>`
- optional `DB_TO_SHEET_EXPORT_AUTH_TOKEN=<shared-token>`

Manual export for one event date:

```bash
curl -sS \
  -X POST \
  "https://<project-ref>.functions.supabase.co/supabase_to_sheet_export" \
  -H "Authorization: Bearer <DB_TO_SHEET_EXPORT_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"eventDate":"2026-04-28","dryRun":false,"overwriteMissingWithZero":false,"writeConcurrency":6}'
```

This keeps `reference` as import-only and updates your `copy` from DB state.

Default export mode is overwrite per event column (`overwriteMissingWithZero=true`), so missing DB rows are written as `0` for active members.
If runs are slow, tune concurrency with body `writeConcurrency` or env `DB_TO_SHEET_EXPORT_WRITE_CONCURRENCY` (range `1..20`, default `6`).
For full column overwrite on large ensembles, run in windows:

```bash
curl -sS \
  -X POST \
  "https://<project-ref>.functions.supabase.co/supabase_to_sheet_export" \
  -H "Authorization: Bearer <DB_TO_SHEET_EXPORT_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"eventDate":"2026-04-28","dryRun":false,"overwriteMissingWithZero":true,"memberOffset":0,"memberLimit":25,"writeConcurrency":4}'
```

Use `next_member_offset` from response until `has_more_member_pages=false`.
