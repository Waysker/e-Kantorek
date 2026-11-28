#!/usr/bin/env bash
# Wdrożenie powiadomień push na orbit (docs/ops/push-notifications.md).
# Uruchamia użytkownik (prosi o hasło sudo). Nie wypisuje sekretów.
#
# Wymaga w .env (wysłane wcześniej przez secret.ps1):
#   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_NEW_EVENTS_FUNCTION_AUTH_TOKEN
#
# Użycie: bash /home/waysker/e-Kantorek-sync/deploy/orbit/push-setup.sh
set -euo pipefail

STACK=/home/waysker/supabase-selfhost-test
SYNC=/home/waysker/e-Kantorek-sync
COMPOSE=(sudo docker compose -f "$STACK/docker-compose.yml" -f "$STACK/docker-compose.orbit-quick.yml")
OVERRIDE="$STACK/docker-compose.orbit-quick.yml"

echo "== 1. Sekrety w .env (tylko długości)"
missing=0
for key in VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY PUSH_NEW_EVENTS_FUNCTION_AUTH_TOKEN; do
  value="$(grep "^${key}=" "$STACK/.env" | tail -1 | cut -d= -f2- || true)"
  echo "   ${key}: ${#value} znaków"
  [ -n "$value" ] || missing=1
done
if [ "$missing" = 1 ]; then
  echo "Brakuje sekretu w .env; przerwano przed zmianami." >&2
  exit 1
fi

echo "== 2. Kod funkcji"
cd "$SYNC"
git log -1 --oneline
test -f app/supabase/functions/push_new_events/index.ts || { echo "Brak push_new_events w checkoucie (git pull?)." >&2; exit 1; }
rm -rf "$STACK/volumes/functions/push_new_events"
cp -r app/supabase/functions/push_new_events "$STACK/volumes/functions/push_new_events"
ls "$STACK/volumes/functions/push_new_events"

echo "== 3. Zmienne funkcji w docker-compose.orbit-quick.yml"
if grep -q "PUSH_NEW_EVENTS_FUNCTION_AUTH_TOKEN" "$OVERRIDE"; then
  echo "   już są"
else
  cp "$OVERRIDE" "$OVERRIDE.bak-push"
  anchor="      - ATTENDANCE_HEALTH_CHECK_FUNCTION_AUTH_TOKEN=\${ATTENDANCE_HEALTH_CHECK_FUNCTION_AUTH_TOKEN}"
  grep -qF "$anchor" "$OVERRIDE" || { echo "Nie znaleziono miejsca na zmienne w $OVERRIDE." >&2; exit 1; }
  python3 - "$OVERRIDE" "$anchor" <<'PY'
import sys
path, anchor = sys.argv[1], sys.argv[2]
text = open(path, encoding="utf-8").read()
extra = "".join(
    f"\n      - {key}=${{{key}}}"
    for key in ("PUSH_NEW_EVENTS_FUNCTION_AUTH_TOKEN", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY")
)
open(path, "w", encoding="utf-8").write(text.replace(anchor, anchor + extra, 1))
PY
  echo "   dodane (kopia: docker-compose.orbit-quick.yml.bak-push)"
fi

echo "== 4. Migracja 034"
sudo docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < "$SYNC/app/supabase/migrations/034_push_notifications.sql"

echo "== 5. Restart funkcji"
"${COMPOSE[@]}" up -d functions
sleep 5

token="$(grep '^PUSH_NEW_EVENTS_FUNCTION_AUTH_TOKEN=' "$STACK/.env" | tail -1 | cut -d= -f2-)"

echo "== 6. Próba na sucho"
curl -sS -m 60 -X POST http://127.0.0.1:18080/functions/v1/push_new_events \
  -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \
  -d '{"dryRun":true}'
echo

echo "== 7. Harmonogram (pg_cron co 5 min)"
sudo docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v token="$token" <<'SQL'
select public.schedule_push_new_events(
  'http://api-gw:8000/functions/v1/push_new_events',
  :'token'
) as job_id;
select jobname, schedule, active from cron.job where jobname = 'push_new_events_5m';
SQL

echo "Gotowe."
