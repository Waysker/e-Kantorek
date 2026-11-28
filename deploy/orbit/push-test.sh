#!/usr/bin/env bash
# Ręczne wywołanie push_new_events na orbit z tokenem z .env (bez wypisywania go).
# Użycie:
#   bash push-test.sh dry            co by poszło teraz (nic nie zapisuje)
#   bash push-test.sh test <uuid>    "Powiadomienia działają" na urządzenia tego konta
#   bash push-test.sh run            normalny przebieg (jak z crona)
set -euo pipefail
cd /home/waysker/supabase-selfhost-test
mode="${1:-dry}"
case "$mode" in
  dry) body='{"dryRun":true}' ;;
  run) body='{}' ;;
  test)
    profile="${2:?podaj uuid konta (profiles.id)}"
    [[ "$profile" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "To nie jest uuid." >&2; exit 1; }
    body="{\"testProfileId\":\"${profile}\"}"
    ;;
  *) echo "Tryb: dry | test <uuid> | run" >&2; exit 1 ;;
esac
token="$(grep '^PUSH_NEW_EVENTS_FUNCTION_AUTH_TOKEN=' .env | tail -1 | cut -d= -f2-)"
curl -sS -m 60 -X POST http://127.0.0.1:18080/functions/v1/push_new_events \
  -H "Authorization: Bearer ${token}" \
  -H "Content-Type: application/json" \
  -d "$body"
echo
