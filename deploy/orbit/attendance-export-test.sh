#!/usr/bin/env bash
# Wywołuje supabase_to_sheet_export na orbit z tokenem z .env (bez wypisywania go).
# Użycie: bash attendance-export-test.sh <RRRR-MM-DD> [dry|write]
#   dry   (domyślnie): tworzy zakładkę/kolumnę w kopii, nie wpisuje wartości
#   write: wpisuje wartości z app_attendance_entries (brak wpisu = bez zmian)
set -euo pipefail
cd /home/waysker/supabase-selfhost-test
event_date="${1:?podaj datę RRRR-MM-DD}"
mode="${2:-dry}"
dry_run=true
[ "$mode" = "write" ] && dry_run=false
token="$(grep '^DB_TO_SHEET_EXPORT_AUTH_TOKEN=' .env | tail -1 | cut -d= -f2-)"
curl -sS -m 120 -X POST http://127.0.0.1:18080/functions/v1/supabase_to_sheet_export \
  -H "Authorization: Bearer ${token}" \
  -H "Content-Type: application/json" \
  -d "{\"eventDate\":\"${event_date}\",\"dryRun\":${dry_run},\"overwriteMissingWithZero\":false}"
echo
