#!/usr/bin/env bash
# Wdrożenie Kantorka (feed) na orbit: migracje 035 i 036, nowa wersja funkcji
# push_new_events (powiadomienia o wpisach), restart funkcji, próba na sucho.
# Uruchamia użytkownik (prosi o hasło sudo). Nie wypisuje sekretów.
#
# Użycie: git -C /home/waysker/e-Kantorek-sync pull --ff-only && \
#         bash /home/waysker/e-Kantorek-sync/deploy/orbit/feed-setup.sh
set -euo pipefail

STACK=/home/waysker/supabase-selfhost-test
SYNC=/home/waysker/e-Kantorek-sync
MIGRATIONS="$SYNC/app/supabase/migrations"
COMPOSE=(sudo docker compose -f "$STACK/docker-compose.yml" -f "$STACK/docker-compose.orbit-quick.yml")

cd "$SYNC"
git log -1 --oneline
test -f "$MIGRATIONS/035_feed.sql" || { echo "Brak 035_feed.sql w checkoucie (git pull?)." >&2; exit 1; }

echo "== 1. Migracja 035 (tabele i RPC, jako postgres)"
sudo docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIGRATIONS/035_feed.sql"

echo "== 2. Migracja 036 (bucket „feed” i zasady Storage, jako supabase_admin)"
sudo docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < "$MIGRATIONS/036_feed_storage.sql"

echo "== 3. Funkcja push_new_events"
rm -rf "$STACK/volumes/functions/push_new_events"
cp -r app/supabase/functions/push_new_events "$STACK/volumes/functions/push_new_events"
"${COMPOSE[@]}" up -d functions
sleep 5

echo "== 4. Sprawdzenie"
sudo docker exec -i supabase-db psql -U postgres -d postgres -At <<'SQL'
select 'bucket feed: ' || coalesce((select id from storage.buckets where id = 'feed'), 'BRAK');
select 'zasady Storage: ' || count(*) from pg_policies where schemaname = 'storage' and policyname like 'Feed files:%';
select 'wpisy: ' || count(*) from public.feed_posts;
SQL
token="$(grep '^PUSH_NEW_EVENTS_FUNCTION_AUTH_TOKEN=' "$STACK/.env" | tail -1 | cut -d= -f2-)"
curl -sS -m 60 -X POST http://127.0.0.1:18080/functions/v1/push_new_events \
  -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \
  -d '{"dryRun":true}'
echo
echo "Gotowe."
