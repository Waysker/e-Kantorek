# Kopia arkusza obecności (wpisy z aplikacji)

Kopia pokazuje to, co zarząd wpisał w aplikacji (`app_attendance_entries`),
w tym samym układzie co oryginał. Oryginał nigdy nie dostaje zapisów z aplikacji.
Model: `docs/reference/attendance-model.md`.

## Jak to działa

1. Zapis w panelu → `attendance_write_sheet_first` (`db_first`) zapisuje do
   `app_attendance_entries`.
2. Przy `ATTENDANCE_WRITE_TRIGGER_DB_EXPORT=true` woła `supabase_to_sheet_export`
   (`DB_TO_SHEET_EXPORT_URL`, token `DB_TO_SHEET_EXPORT_AUTH_TOKEN`) dla zmienionych osób.
3. Eksport woła webhook Apps Script w kopii (`ATTENDANCE_APPS_SCRIPT_WEBHOOK_URL`,
   token `ATTENDANCE_APPS_SCRIPT_WEBHOOK_TOKEN`):
   - `ensure_attendance_sheet`: zakładka miesiąca, najpierw po `gid` z oryginału
     („Utwórz kopię” zachowuje `gid`), potem po nazwie („Grudzień 26”). Nowy miesiąc
     powstaje z kopii zakładki-wzoru, bez jej kolumn wydarzeń.
   - `ensure_attendance_column`: kolumna po dacie RRRR-MM-DD w nagłówku; brak →
     nowa kolumna na końcu z nagłówkiem „Tytuł⏎RRRR-MM-DD”.
   - `set_attendance_cell`: wartość w wierszu osoby (wiersze jak w oryginale).

Kod skryptu: `deploy/google-apps-script/attendance-copy-webhook.gs`.

## Założenie kopii (jednorazowo, na początku sezonu)

1. Oryginał → **Plik → Utwórz kopię**. Nazwa np. „Obecności — z aplikacji 2026/27”.
   Udostępnij tylko zarządowi.
2. W każdej zakładce zaznacz kolumny od **E** do ostatniej i **Usuń kolumny**.
   Zostają sekcje, `L.p.`, nazwiska i imiona. Kolumny wydarzeń doda skrypt.
3. **Rozszerzenia → Apps Script**. Wklej całą zawartość
   `deploy/google-apps-script/attendance-copy-webhook.gs` zamiast domyślnego kodu,
   zapisz.
4. **Ustawienia projektu → Właściwości skryptu → Dodaj**: `WEBHOOK_TOKEN` =
   hasło wpisu KeePassXC `orbit/ekantorek-apps-script-webhook`.
5. **Wdróż → Nowe wdrożenie → Aplikacja internetowa**: wykonaj jako „Ja”,
   dostęp „Każdy”. Autoryzuj. Skopiuj adres aplikacji (`…/exec`).
6. Adres do KeePassXC i na orbit (bez wklejania do czatu):
   `secret.ps1 clip -Entry orbit/ekantorek-apps-script-webhook -Field URL`, potem
   `secret.ps1 push -Entry orbit/ekantorek-apps-script-webhook -Field URL -Target /home/waysker/supabase-selfhost-test/.env -Key ATTENDANCE_APPS_SCRIPT_WEBHOOK_URL`.
7. ID kopii (z adresu `/d/<ID>/edit`) do `ATTENDANCE_EXPORT_TARGET_SHEET_ID`.

Po zmianie kodu skryptu: **Wdróż → Zarządzaj wdrożeniami → Edytuj → Nowa wersja**
(adres zostaje ten sam).

## Zmienne funkcji na orbit

W `docker-compose.orbit-quick.yml`, usługa `functions`, sekrety z `.env`:

```yaml
      - ATTENDANCE_EXPORT_TARGET_SHEET_ID=<ID kopii>
      - ATTENDANCE_APPS_SCRIPT_WEBHOOK_URL=${ATTENDANCE_APPS_SCRIPT_WEBHOOK_URL}
      - ATTENDANCE_APPS_SCRIPT_WEBHOOK_TOKEN=${ATTENDANCE_APPS_SCRIPT_WEBHOOK_TOKEN}
      - DB_TO_SHEET_EXPORT_AUTH_TOKEN=${DB_TO_SHEET_EXPORT_AUTH_TOKEN}
      - DB_TO_SHEET_EXPORT_URL=http://api-gw:8000/functions/v1/supabase_to_sheet_export
      - ATTENDANCE_WRITE_TRIGGER_DB_EXPORT=true
```

Wpisy KeePassXC: `orbit/ekantorek-apps-script-webhook` (token + adres),
`orbit/ekantorek-db-to-sheet-export` (token eksportu).

## Test

Na orbit (token czytany z `.env`, nie jest wypisywany):

```bash
bash /home/waysker/attendance-export-test.sh 2026-12-01        # na sucho
bash /home/waysker/attendance-export-test.sh 2026-12-01 write  # wpisuje wartości z aplikacji
```

Skrypt: `deploy/orbit/attendance-export-test.sh`. Uruchamiaj go plikiem, nie
wklejaj `curl` z cudzysłowami w `ssh '…'` z PowerShella 5.1 (gubi cudzysłowy).

## Wiadomo

- Zapisy z aplikacji na wydarzenie, którego nie ma w oryginale (np. wirtualny
  wtorek), dostają kolumnę na końcu zakładki, więc kolejność kolumn w kopii może
  nie być chronologiczna.
- Domyślny eksport ręczny (`overwriteMissingWithZero=true`) wpisuje 0 osobom bez
  wpisu w aplikacji. Eksport po zapisie z panelu zmienia tylko zapisane osoby.
