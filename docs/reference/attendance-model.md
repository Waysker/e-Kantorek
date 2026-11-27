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

- **Referencja**: obecność wczytana z oryginału (`sheet_to_supabase_sync`).
- **Aplikacja**: obecność wpisana przez zarząd w aplikacji.

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
- Dokumentacja wymienia inne identyfikatory arkuszy (`1pEq8Yd9…`,
  `1CGIEDf…`). Trzeba sprawdzić, co jest ustawione w sekretach funkcji na orbit.

## Zmiany do zrobienia (kolejność)

1. ~~Adres funkcji w aplikacji~~ (zrobione: zapis i eksport CSV idą pod
   `<SUPABASE_URL>/functions/v1/<nazwa>`, `app/src/auth/edgeFunctionUrl.ts`).
   Workflowy health-check i smoke oraz skrypty `smoke-attendance-db-first.mjs`
   i `export-attendance-csv.mjs` nadal liczą adres z `SUPABASE_PROJECT_REF`
   (chmura) — do poprawy razem z krokiem 2.
2. Orbit: sprawdzić zadania `pg_cron`, świeżość `sync_runs` i sekrety funkcji
   (adresy, ID arkuszy). Przygotować SQL do uruchomienia przez właściciela.
3. Rozdzielić zbiory „referencja” i „aplikacja” (migracja + sync + zapis + eksport).
4. Założyć nową kopię: arkusz, Apps Script webhook (`docs/ops/sheet-sync-setup.md`,
   sekcja 3a), sekrety `ATTENDANCE_EXPORT_TARGET_SHEET_ID` i webhooka.
5. Backend: zapis tylko dla `board`/`admin`.
6. Kalendarz wpisywania: wydarzenia z forum zamiast z kolumn oryginału (dziś
   `AttendanceManagerScreen` czyta tabelę `events` z syncu arkusza).
7. Panel zarządu: odnośniki do arkuszy i lista ostatnich zapisów.
8. Podsumowanie: przełącznik referencja / aplikacja; dostęp dla wszystkich.
9. Później: lista osób z forum.
