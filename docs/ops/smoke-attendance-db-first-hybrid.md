# Smoke obecności (`db_first`) i health-check

Oba testy działają na self-hosted Supabase na orbit. Logika i hasła są w funkcjach
na orbit, a GitHub Actions tylko je wywołuje tokenem.

## Smoke: co sprawdza

`smoke_attendance_db_first` przechodzi przez prawdziwą ścieżkę zapisu z panelu,
ale **nigdy nie dotyka prawdziwej obecności**:

1. Tworzy (albo odświeża) własne dane testowe:
   - osobę `member-smoke-fixture` („Smoke Test”, `is_active=false`, więc nie ma jej
     w panelu, podsumowaniach ani eksporcie),
   - wydarzenie `evt-smoke-fixture` (2000-01-01, bez arkusza i forum, więc nie ma go
     w kalendarzu panelu).
2. Loguje się kontem testowym z rolą `board` lub `admin`.
3. Zapisuje 0,5 przez `attendance_write_sheet_first` (`mode=enqueue_batch`,
   `skipSheetExport=true`, więc nic nie trafia do kopii arkusza).
4. Sprawdza, że:
   - wpis jest w `app_attendance_entries` z kontem testowym jako autorem,
   - `attendance_entries` (dane z oryginału) się nie zmieniło.
5. Opcjonalnie: przebieg na sucho `sheet_to_supabase_sync` i jego kontrakt odpowiedzi
   (`checkSyncContract`, domyślnie włączony w workflow).
6. Sprząta: usuwa swój wpis z `app_attendance_entries` i swoje wiersze z
   `change_journal`, więc nie widać go w „Ostatnich zapisach” panelu.

Wynik: `{"status":"ok", "sheet_data_untouched":true, "cleaned_up":true, …}`.

## Health-check: co sprawdza

`attendance_health_check` zgłasza `status: "fail"`, gdy:

- ostatni udany sync z oryginału był dawniej niż 60 min temu (`sheet_sync_stale`;
  łapie też sytuację, w której sync w ogóle nie zapisuje przebiegów),
- w ostatnich 150 min były nieudane synci,
- w kolejce zapisu są wpisy `dead_letter` albo zawieszone `processing`.

## Konfiguracja

Zmienne funkcji na orbit (`docker-compose.orbit-quick.yml`, usługa `functions`,
wartości sekretów w `.env`):

- `SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN` (wymagany; bez niego funkcja odmawia)
- `SMOKE_ATTENDANCE_TEST_EMAIL`, `SMOKE_ATTENDANCE_TEST_PASSWORD` (konto testowe
  z rolą `board`; wpisy KeePassXC `orbit/ekantorek-smoke-*`)
- `ATTENDANCE_HEALTH_CHECK_FUNCTION_AUTH_TOKEN`
- opcjonalnie `SMOKE_SYNC_MAX_WARNINGS`, `SMOKE_SYNC_FORBID_WARNING_CODES`

GitHub (tylko wywołanie):

- sekrety `SUPABASE_URL`, `SMOKE_ATTENDANCE_FUNCTION_AUTH_TOKEN`,
  `ATTENDANCE_HEALTH_CHECK_FUNCTION_AUTH_TOKEN` (te same wartości co na orbit),
- opcjonalna zmienna `SMOKE_CHECK_SYNC_CONTRACT` (domyślnie `true`).

## Workflowy

- `.github/workflows/smoke-attendance-db-first.yml`: codziennie i ręcznie.
- `.github/workflows/attendance-health-check.yml`: co 2 godziny i ręcznie.

GitHub wyłącza zaplanowane workflowy po 60 dniach bez aktywności w repo; włącza
się je `gh workflow enable <plik>`.

## Ręcznie

```bash
cd app && npm run smoke:attendance:db-first   # SUPABASE_URL + token w app/.env
```

## Rotacja

1. Nowy token: `secret.ps1 genpush` do `.env` na orbit, restart `functions`.
2. Ta sama wartość do sekretu GitHub (`gh secret set …`).
3. Hasło konta testowego: zmiana w aplikacji i `SMOKE_ATTENDANCE_TEST_PASSWORD`.
