# Obecność faktyczna: jak ma działać (etap zaufania)

Ustalenia z 2026-11-27. Ten dokument opisuje **docelowe zachowanie**. Kod jeszcze go
w pełni nie spełnia; lista zmian jest na końcu.

## Cel etapu

Zarząd sprawdza obecność na próbach i graniach ręcznie, w arkuszu Google. Aplikacja
ma działać obok, aż zarząd uzna, że można jej zaufać. Do tego czasu nic, co robi
aplikacja, nie zmienia oryginału.

## Dwa arkusze

| Arkusz | Kto pisze | Rola |
| --- | --- | --- |
| **Oryginał** (`19iIZB7VO5XbbKYOQnrxg5yIPEVSMEKQommxrBMvgcYk`) | zarząd, ręcznie | źródło prawdy; aplikacja tylko go czyta |
| **Kopia** (nowa, do założenia od zera) | wyłącznie aplikacja | pokazuje to, co zarząd wpisał w aplikacji, w tym samym układzie co oryginał |

Układ obu: jedna zakładka na okres, sekcje w kolumnie A, potem `L.p.`, `Nazwisko`,
`Imię`, a od kolumny E jedno wydarzenie na kolumnę (szczegóły parsowania:
`docs/contracts/attendance-sheet-contract.md`).

Kopia zawiera **tylko wpisy z aplikacji**. Nie może odtwarzać oryginału, bo wtedy
zawsze wyglądałaby „zgodnie” i porównanie nic by nie dawało.

## Dwa zbiory danych w bazie

- **Referencja**: obecność wczytana z oryginału, tabela `attendance_entries`.
  Pisze do niej wyłącznie `sheet_to_supabase_sync`.
- **Aplikacja**: obecność wpisana przez zarząd w aplikacji, tabela
  `app_attendance_entries` (migracja 029, z `recorded_by_profile_id` i `source`).
  Pisze do niej wyłącznie `attendance_write_sheet_first` w trybie `db_first`;
  czytają ją panel wpisywania i `supabase_to_sheet_export`.

Obie tabele mają ten sam klucz (`member_id`, `event_id`) i te same `members`
oraz `events`. Eksport CSV (`attendance_csv_export`) i podsumowania czytają
referencję.

Zbiory się nie nadpisują. Sync z oryginału nie zmienia wpisów z aplikacji, a zapis
z aplikacji nie zmienia referencji. Eksport do kopii bierze wyłącznie zbiór
„aplikacja”.

Podsumowania obecności w aplikacji liczą się domyślnie z referencji, bo to ona
jest źródłem prawdy. Przełącznik pozwala zobaczyć ten sam agregat policzony
z danych aplikacji, żeby porównać oba wyniki.

## Kto wpisuje, kto ogląda

- Wpisuje tylko zarząd (`board`, `admin`). Szef sekcji (`section`) nie wpisuje.
  Backend też ma to egzekwować.
- Oglądać obecność wszystkich może każdy zalogowany członek (dziś podsumowanie
  widzą tylko `section`, `board`, `admin`).

## Jak wpisuje
- Skala jak w arkuszu: 0 / 0,25 / 0,5 / 0,75 / 1, punkty bonusowe do 4.
- Wydarzenia do wyboru w kalendarzu wpisywania: wszystkie wydarzenia z forum
  (te same co w zakładce Wydarzenia) oraz próby we wtorki i czwartki (zwykle się
  odbywają). Pierwszy zapis na wydarzenie dopisuje jego kolumnę w kopii. Kopię
  układa aplikacja, więc nie trzeba parować wydarzeń z kolumnami oryginału.
- Lista osób: na tym etapie zostaje lista z oryginału (`members`). Przejście na
  listę z forum to osobny, późniejszy krok (wymaga przypisania osoby z forum do
  wiersza w kopii, podobnie jak przy instrumentach).

## Jak zarząd sprawdza, czy aplikacja działa

Bez automatycznego porównywania kolumn (nagłówki w oryginale bywają różne, więc
parowanie byłoby kruche). Zamiast tego w panelu zarządu:

1. **Odnośniki do obu arkuszy**, żeby otworzyć je obok siebie.
2. **Ostatnie zapisy z aplikacji**: wydarzenie i data, ile osób odhaczono, kto
   i kiedy zapisał, czy zapis trafił do kopii (albo jaki był błąd).

## Otwarte

- Kiedy uznajemy, że aplikacji można zaufać, i co wtedy (np. oryginał staje się
  kopią). Do decyzji zarządu.
- Oryginał jest czytelny dla każdego z linkiem (eksport CSV działa bez logowania).
  Jeśli to niezamierzone, sync potrzebuje innego dostępu.
- Każdy sezon ma nowy plik arkusza (dane w bazie są z `1CGIEDf…`, sezon
  2025/26; oryginał bieżącego sezonu to `19iIZB…`). Zmiana sezonu wymaga zmiany
  `ATTENDANCE_SHEET_ID`. Do ustalenia, czy tak ma zostać.

## Zmiany do zrobienia (kolejność)

1. ~~Adres funkcji w aplikacji~~ (zrobione: zapis i eksport CSV idą pod
   `<SUPABASE_URL>/functions/v1/<nazwa>`, `app/src/auth/edgeFunctionUrl.ts`).
   Workflowy health-check i smoke oraz skrypty `smoke-attendance-db-first.mjs`
   i `export-attendance-csv.mjs` nadal liczą adres z `SUPABASE_PROJECT_REF`
   (chmura) — do poprawy razem z krokiem 2.
2. Orbit (sprawdzone 2026-11-27):
   - `pg_cron` i `pg_net` działają; jest tylko zadanie `sheet_to_supabase_sync_15m`
     (adres na orbit, poprawny) i retencja `sync_runs` (30 dni).
   - **Sync nigdy nie zadziałał na orbit**: każde wywołanie zwraca `400
     missing_sheet_source`, bo kontener `supabase-edge-functions` nie dostaje
     `ATTENDANCE_SHEET_ID`. `sync_runs` jest puste; ostatni udany sync był
     2026-09-29, jeszcze w chmurze, z arkusza poprzedniego sezonu (`1CGIEDf…`).
     Najnowsze wydarzenie z obecnością w bazie: 2026-06-28.
   - Kontener funkcji ma tylko zmienne `SHEET_SYNC_*` i standardowe klucze. Brakuje
     m.in. `ATTENDANCE_SHEET_ID`, `ATTENDANCE_WRITE_SOURCE_MODE` (bez niej zapis
     działa w trybie `sheet_first`), `ATTENDANCE_EXPORT_TARGET_SHEET_ID`,
     webhooka Apps Script, `DB_TO_SHEET_EXPORT_*`, `ATTENDANCE_WRITE_FUNCTION_AUTH_TOKEN`.
   - Kod funkcji na orbit (`volumes/functions`, 2026-10-08) różni się od repo
     w `sheet_to_supabase_sync` (mniej wpisów `sync_issues`, brak wpisu do
     `change_journal`) i `smoke_attendance_db_first` (adres `/functions/v1/`).
     Przeniesione do repo 2026-11-27.
   - 2026-11-27: do usługi `functions` w `docker-compose.orbit-quick.yml` na orbit
     dodano `ATTENDANCE_SHEET_ID` (oryginał), `ATTENDANCE_SHEET_AUTO_DISCOVER_SOURCES=true`
     i `SHEET_SYNC_DRY_RUN_ONLY=true` (kopia: `.bak-attendance`). Pierwszy przebieg
     na sucho (18:45 UTC): 3 zakładki, 90 osób, 25 wydarzeń, 734 wpisy, 0 błędów,
     26 ostrzeżeń (tylko wnioskowanie dat z nagłówków).
   - 2026-11-27 19:00 UTC: `SHEET_SYNC_DRY_RUN_ONLY=false`, pierwszy prawdziwy
     przebieg: 734 wpisy, 25 wydarzeń, 90 osób, 0 usuniętych, 0 błędów. Kopia
     danych sprzed zmiany: `/home/waysker/attendance-backup-2026-11-27.sql` na orbit.
   - Błąd parsera: w zakładce grudniowej „Próba 2026-01-12” (RRRR-DD-MM, 1 grudnia)
     trafiła na 2026-01-12, bo zakładka nie ma żadnej jednoznacznej daty RRRR-…
     (są tylko „03.12”, „04.12”). Parser powinien brać miesiąc z dat DD.MM w tej
     samej zakładce. Poprawione w repo: miesiąc liczony z dat jednoznacznych i DD.MM,
     a zakładka bez żadnej wskazówki bierze styl RRRR-DD-MM z całego arkusza.
     Wdrożone na orbit 2026-11-27 19:14 UTC (kopia starego kodu:
     `index.ts.bak-2026-11-27`), `evt-2026-01-12-proba` usunięte. Przebieg 19:15:
     „Próba 2026-01-12” → 2026-12-01, 734 wpisy, 0 błędów.
   - 9 osób z zeszłego sezonu nie ma w nowym arkuszu, a nadal ma `is_active=true`
     (pokazują się w panelu wpisywania).
3. ~~Rozdzielić zbiory~~ (w repo: migracja 029, zapis, eksport do kopii, panel).
   Wdrożone na orbit 2026-11-27: migracja 029, obie funkcje (kopie
   `index.ts.bak-step3`), `ATTENDANCE_WRITE_SOURCE_MODE=db_first` w
   `docker-compose.orbit-quick.yml` (kopia `.bak-step3`). Eksport do kopii jest
   wyłączony do kroku 4 (`supabase_to_sheet_export` zwraca
   `missing_target_sheet_id`).
   Smoke (`smoke_attendance_db_first`, `scripts/smoke-attendance-db-first.mjs`)
   czyta jeszcze `attendance_entries` i pisze na prawdziwych danych, więc
   zaśmieciłby zbiór „aplikacja”: do przerobienia na osobne wydarzenie testowe
   przed ponownym włączeniem.
4. ~~Założyć nową kopię~~ (2026-11-27). Kopia `1YKJYSVbeanDlp1ZSryo71ohnwYAGiukI2txsjWZ4urM`
   (3 zakładki z `gid` oryginału, tylko kolumny A–D), webhook
   `deploy/google-apps-script/attendance-copy-webhook.gs`, zmienne i tokeny na orbit
   według `docs/ops/attendance-copy-sheet.md` (kopia compose `.bak-step4`).
   Test na sucho dla 2026-12-01: kolumna E w „Grudzień 26”, 99 osób, 0 braków
   wierszy. Test ręczny: `deploy/orbit/attendance-export-test.sh`.
5. ~~Backend: zapis tylko dla `board`/`admin`~~ (w repo). Zapis zbiorczy nie
   wymaga już, żeby osoba z zarządu była w arkuszu (`actor_member_id` może być puste).
6. Kalendarz wpisywania: wydarzenia z forum zamiast z kolumn oryginału (dziś
   `AttendanceManagerScreen` czyta tabelę `events` z syncu arkusza).
7. Panel zarządu: odnośniki do arkuszy i lista ostatnich zapisów.
8. Podsumowanie: przełącznik referencja / aplikacja; dostęp dla wszystkich.
9. Później: lista osób z forum.
