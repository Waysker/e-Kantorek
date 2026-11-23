# e-Kantorek

## Infrastruktura: orbit (self-hosted Supabase)

- Supabase działa **self-hosted na serwerze orbit**, NIE w chmurze supabase.com. Nie odsyłaj do dashboardu supabase.com ani nie zakładaj `*.supabase.co`.
- Dostęp: `ssh -o BatchMode=yes orbit` (user `waysker`, grupy `adm` i `sudo`).
- Docker: zwykły `docker` daje permission denied. `sudo` wymaga hasła, poza wąską listą NOPASSWD (sprawdź `sudo -l`): `docker compose` z plikami `/home/waysker/supabase-selfhost-test/docker-compose.yml` + `docker-compose.orbit-quick.yml` dla `ps`, `logs --tail=100 auth|db`, `up -d auth`, `restart auth`. Bez hasła nie da się więc `docker exec ... psql`.
- Kontener bazy: `supabase-db` (Postgres 17). Studio: `supabase-studio`.
- Zapisy do bazy: przygotuj SQL i poproś użytkownika o uruchomienie na orbit, chyba że dostałeś NOPASSWD dla `docker exec`.
- Nie wklejaj do czatu ani do repo haseł i kluczy (service-role, login do forum).

## Forum sync

- Timer systemd `ekantorek-forum-sync` na orbit co ~20 min uruchamia `npm run forum:sync:publish` w kontenerze Docker. Szczegóły: `deploy/orbit/forum-sync/README.md`.
- Logi czytelne bez sudo: `journalctl -u ekantorek-forum-sync`.
- Checkout używany przez sync: `/home/waysker/e-Kantorek-sync`. Snapshot i cache: `app/.cache/forum-sync/snapshot.json` (czytelne bez sudo). Lokalny `app/src/data/generated/forumSnapshot.ts` jest stary i nie odzwierciedla produkcji.

## Mapping instrumentów forum

Pełny opis procesu: `docs/ops/forum-instrument-mapping.md`.

- Osoby bez instrumentu trafiają do grupy „Instrument not mapped yet". Sync zapisuje je do `app/.cache/forum-sync/unmapped.json` i loguje ostrzeżenie.
- Alerty: push ntfy (`notify.sh unmapped`, powtarzany co 24 h) oraz baner w aplikacji dla `section`/`board`/`admin` (sekcyjni tylko widzą, przypisuje zarząd).
- Mapping to tabela `forum_instrument_overrides` (klucz `forum`, payload `{ byUid, byFullName, byUsername }`), a nie plik. `app/forum-sync.instrument-overrides.example.json` to tylko szablon.
- Przypisanie i poprawianie robi zarząd w zakładce „Instrumenty" (podzakładki: Do przypisania, Zmapowani, Historia; migracje 027 i 028). Każda zmiana trafia do `forum_instrument_mapping_audit`. Wpis działa po następnym syncu (do ~20 min).
- Awaryjnie: SQL na orbit (przykład w docs/ops/forum-instrument-mapping.md).
- Instrumentu nie ma w profilach forum, więc podaje go człowiek.
- `publish-instrument-overrides-to-supabase.mjs` z `FORUM_SYNC_FORCE_OVERRIDE_PUBLISH=1` scala dane (wpisy z panelu zostają) i robi kopię w `.cache/forum-sync/`. Pełne nadpisanie tylko z dodatkowym `FORUM_SYNC_OVERRIDE_REPLACE=1`.
