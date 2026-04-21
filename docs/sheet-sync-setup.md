# Sheet -> Supabase Sync Setup (Dry-Run)

This document describes how to run the new dry-run sync pipeline:

- Google Sheet CSV source
- Supabase Edge Function `sheet_to_supabase_sync`
- Supabase Cron every 5 minutes

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
  - `ATTENDANCE_WRITE_PROCESS_BATCH_SIZE` (default `25`)
  - `ATTENDANCE_WRITE_MAX_ATTEMPTS` (default `5`)
  - `ATTENDANCE_WRITE_ALLOW_CRON_SYNC_FALLBACK` (default `false`; when `false`, process mode fails if sync trigger cannot run)

`sheet_to_supabase_sync` still needs:

- `SHEET_SYNC_DRY_RUN_ONLY=false`
- `SHEET_SYNC_DEFAULT_DRY_RUN=false`

### 3a. Minimal Apps Script webhook (no Google Cloud project required)

Create a script in Google Apps Script attached to the workbook and deploy as Web App.

```javascript
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

    var sheetId = String(body.sheetId || "");
    var gid = String(body.gid || "");
    var rowNumber = Number(body.rowNumber || 0);
    var columnRef = String(body.columnRef || "").toUpperCase();
    var attendanceRatio = Number(body.attendanceRatio);

    if (!sheetId || !gid || !rowNumber || !columnRef || isNaN(attendanceRatio)) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "invalid_payload" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var ss = SpreadsheetApp.openById(sheetId);
    var targetSheet = ss.getSheets().find(function (s) {
      return String(s.getSheetId()) === gid;
    });
    if (!targetSheet) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "sheet_not_found" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var col = 0;
    for (var i = 0; i < columnRef.length; i++) {
      col = col * 26 + (columnRef.charCodeAt(i) - 64);
    }

    targetSheet.getRange(rowNumber, col).setValue(attendanceRatio);
    SpreadsheetApp.flush();

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
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
  -d '{"webhookToken":"<TOKEN>","sheetId":"<SHEET_ID>","gid":"<GID>","columnRef":"E","rowNumber":6,"attendanceRatio":0.5}'
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
