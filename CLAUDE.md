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

- Osoby bez instrumentu trafiają do grupy „Instrument not mapped yet".
- Mapping to tabela `forum_instrument_overrides` (klucz `forum`, payload `{ byUid, byFullName, byUsername }`), a nie plik. Szablon: `app/forum-sync.instrument-overrides.example.json`.
- Lista niezmapowanych: wyciągnij z `snapshot.json` na orbit (grupy `instrument == "Instrument not mapped yet"` w `confirmedMembers` i `maybeMembers`).
- Instrumentu nie ma w profilach forum, więc podaje go użytkownik. Nowe wpisy dopisuj do `byUid`, bez nadpisywania istniejących.
