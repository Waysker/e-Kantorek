# Powiadomienia push

Aplikacja webowa (także zainstalowana z przeglądarki) wysyła powiadomienie, gdy na
forum pojawi się nowe wydarzenie. Wzorzec i teksty: Partytura → Patterns →
Notifications.

## Jak to działa

1. **Zgoda.** Po zalogowaniu Start raz pokazuje kartę „Powiadomienia” (`NotificationsPrompt`).
   „Włącz” otwiera okienko przeglądarki (musi być po stuknięciu), „Nie teraz” chowa kartę
   na tym urządzeniu (`localStorage` `ekantorek.pushPrompt.answered`). Karty nie ma razem
   z „Czy to Ty na forum?”. Później: Ja → Powiadomienia → „Nowe wydarzenia”, Włącz / Wyłącz.
2. **Subskrypcja.** Przeglądarka daje adres push i klucze; aplikacja zapisuje je przez RPC
   `register_push_subscription` w `push_subscriptions` (migracja 034), dla zalogowanego konta.
   Klucze szyfrujące nie są czytelne dla klientów.
3. **Wysyłka.** pg_cron (`push_new_events_5m`, co 5 min) woła funkcję `push_new_events`.
   Ta czyta migawkę forum (`forum_snapshot_cache`), porównuje z `push_forum_events_seen`
   i dla każdego nowego, przyszłego wydarzenia wysyła „Nowe wydarzenie: <tytuł bez daty>”,
   treść „sob. 28.11 · 10:30 · Sandomierz”. Więcej niż 3 naraz → jedno zbiorcze („5 nowych
   wydarzeń”). Każde wydarzenie najwyżej raz. Opóźnienie: sync forum (do ~20 min) + do 5 min.
4. **Stuknięcie** otwiera wydarzenie (`sw.js` → `?event=forum-event-…` albo wiadomość do
   otwartego okna; `App.tsx`).

Wydarzenia, które już były na forum w chwili migracji, są oznaczone jako widziane, więc
pierwszy przebieg niczego nie ogłasza. Subskrypcje, które usługa push zgłasza jako
nieistniejące (404/410), funkcja usuwa; po 10 nieudanych przebiegach z rzędu też.

## Gdzie działa

- Android (Chrome, Brave): tak, także bez instalacji. W Brave może być potrzebne włączenie
  „Use Google services for push messaging” (brave://settings/privacy).
- iPhone (iOS 16.4+): tylko po „Dodaj do ekranu początkowego” z Safari; w karcie
  przeglądarki karta zgody się nie pokazuje.
- Komputer: Chrome, Edge, Firefox; Brave po włączeniu tego samego ustawienia.

## Klucze i sekrety

| Co | Gdzie | Sekret? |
|---|---|---|
| `VAPID_PUBLIC_KEY` | `.env` na orbit + zmienna GitHub `VAPID_PUBLIC_KEY` (build → `EXPO_PUBLIC_VAPID_PUBLIC_KEY`) | nie |
| `VAPID_PRIVATE_KEY` | `.env` na orbit, KeePassXC `orbit/ekantorek-vapid` | tak |
| `PUSH_NEW_EVENTS_FUNCTION_AUTH_TOKEN` | `.env` na orbit, KeePassXC `orbit/ekantorek-push-token`; też w `cron.job` | tak |

Bez `VAPID_PUBLIC_KEY` w buildzie aplikacja nie pokazuje niczego o powiadomieniach.

## Wdrożenie (jednorazowo)

Szybko, bez KeePassXC (np. z telefonu): od razu krok 4. `push-setup.sh` sam wygeneruje
brakujące klucze VAPID i token prosto do `.env` (bez wypisywania), a klucz publiczny
zapisze też w `/home/waysker/supabase-selfhost-test/vapid-public-key.txt`. Potem przy
komputerze skopiuj `VAPID_PRIVATE_KEY` i token z `.env` do KeePassXC.

Z KeePassXC:

1. Klucze VAPID, lokalnie: `node app/scripts/generate-vapid-keys.mjs` (prywatny do schowka,
   publiczny na ekran), potem `secret.ps1 clip -Entry orbit/ekantorek-vapid`,
   `secret.ps1 push -Entry orbit/ekantorek-vapid -Target /home/waysker/supabase-selfhost-test/.env -Key VAPID_PRIVATE_KEY`.
2. Klucz publiczny: do `.env` jako `VAPID_PUBLIC_KEY=…` i `gh variable set VAPID_PUBLIC_KEY`.
3. Token: `secret.ps1 genpush -Entry orbit/ekantorek-push-token -Target /home/waysker/supabase-selfhost-test/.env -Key PUSH_NEW_EVENTS_FUNCTION_AUTH_TOKEN`.
4. Na orbit: `git -C /home/waysker/e-Kantorek-sync pull --ff-only`, potem
   `bash /home/waysker/e-Kantorek-sync/deploy/orbit/push-setup.sh` (kod funkcji, zmienne,
   migracja 034, restart `functions`, próba na sucho, harmonogram).
5. Deploy frontu (`Deploy Web Production`), żeby build dostał klucz publiczny.

## Sprawdzanie

- `bash deploy/orbit/push-test.sh dry`: co poszłoby teraz.
- `bash deploy/orbit/push-test.sh test <uuid konta>`: „Powiadomienia działają” na urządzenia
  tego konta.
- Baza (odczyt): `select count(*) from push_subscriptions;`,
  `select * from push_forum_events_seen order by first_seen_at desc limit 5;`.

## Wyłączenie

`select cron.unschedule('push_new_events_5m');` (zapis, przez użytkownika). Aplikacja dalej
pokazuje przełącznik, ale nic nie przychodzi; całkiem: usuń zmienną GitHub i zrób deploy.
