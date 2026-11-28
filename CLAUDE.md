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
- Alerty: push ntfy (`notify.sh unmapped`, powtarzany co 24 h). W aplikacji `board`/`admin` widzą licznik na zakładce „Zarząd” i przy podzakładce „Osoby z forum”, a `section` (bez prawa przypisania) widzi baner z nazwiskami.
- Mapping to tabela `forum_instrument_overrides` (klucz `forum`, payload `{ byUid, byFullName, byUsername }`), a nie plik. `app/forum-sync.instrument-overrides.example.json` to tylko szablon.
- Przypisanie i poprawianie robi zarząd w zakładce „Osoby z forum" (dawniej „Instrumenty”; „Zarząd” → „Osoby z forum”; widoki: Do przypisania, Przypisani, Historia; migracje 027 i 028). Każda zmiana trafia do `forum_instrument_mapping_audit`. Wpis działa po następnym syncu (do ~20 min).
- Awaryjnie: SQL na orbit (przykład w docs/ops/forum-instrument-mapping.md).
- Instrumentu nie ma w profilach forum, więc podaje go człowiek.
- `publish-instrument-overrides-to-supabase.mjs` z `FORUM_SYNC_FORCE_OVERRIDE_PUBLISH=1` scala dane (wpisy z panelu zostają) i robi kopię w `.cache/forum-sync/`. Pełne nadpisanie tylko z dodatkowym `FORUM_SYNC_OVERRIDE_REPLACE=1`.

## Konto w aplikacji ↔ osoba z forum

Pełny opis: `docs/ops/forum-account-links.md`.

- Deklaracje przypisuje się po uid forum z tabeli `profile_forum_links` (migracja 033), a nie po imieniu z rejestracji („Kasia” vs „Katarzyna”). Stan `proposed` (połączył sam członek albo dokładne imię+nazwisko+sekcja) wystarcza do odczytu; `verified` nadaje zarząd w „Zarząd” → „Osoby z forum” → „Konta”. Historia: `forum_identity_link_audit`.
- Konto bez połączenia nie dostaje statusu (`unknown`), a nie fałszywe „Brak deklaracji”; na Start widzi kartę „Czy to Ty na forum?”.
- Konta bez potwierdzonego e-maila są poza listą ról (osobna karta) i poza „Konta”. Przy logowaniu na niepotwierdzony adres jest „Wyślij link ponownie”.

## Design system („Partytura”)

- **Źródło prawdy to design system w Claude Design: „e-Kantorek — Partytura”** (https://claude.ai/artifact/7t7fK3rmrXjjaeqGui5EAg, slug `37b9de72-575f-43a9-9588-71a46984de75`). Decyzje (tokeny, typografia, zasady, specyfikacja komponentów, ton tekstów) żyją tam. Przed pracą nad UI przeczytaj jego `project/README.md` (narzędzia claude-artifacts: `read_file`), a przy zmianie wartości `project/tokens.json`.
- **Kod implementuje system:** `app/src/theme/tokens.ts`, `app/src/theme/text.ts` i komponenty w `app/src/ui/`. Mapa kod ↔ system i sposób sprawdzania: `docs/design-system.md`.
- **Zmiany idą w jedną stronę: najpierw system, potem kod.** Nowy kolor, rozmiar, komponent lub zasada → najpierw do systemu (za zgodą użytkownika), potem wdrożenie w kodzie. Nie zmieniaj wartości tokenów ani wyglądu komponentów tylko w kodzie. Gdy kod i system się różnią, wygrywa system: zgłoś rozbieżność, nie „naprawiaj” systemu pod kod.
- Używaj komponentów z `app/src/ui/` zamiast kopiować style.
- Najważniejsze zasady (skrót, pełne w systemie): kolor = znaczenie, bursztyn tylko dla „czeka na Twoją reakcję”; status zawsze przez `StatusPill`; deklaracje tylko przez ankietę na forum (bez liczników „może”/„brak”); tytuły z forum bez daty; listy osób po nazwisku, kolumnami z góry na dół; teksty po polsku z pełnymi znakami, bez żargonu; obrys kontrolek `controlBorder`, globalny fokus klawiatury, cele dotyku ≥ 44 px; 4 zakładki (Start, Wydarzenia, Zarząd, Ja).
- Dwa motywy (jasny i ciemny): kolory tylko przez `colors` / `themedStyles` z `app/src/theme/theme.ts`, nigdy `StyleSheet.create` z kolorem ani kolor w stałej modułu. Motyw idzie za systemem albo za wyborem w „Ja” → „Wygląd”.
- Ponaglenia ukryte flagą `ATTENDANCE_REMINDERS_ENABLED` w `app/App.tsx`.
