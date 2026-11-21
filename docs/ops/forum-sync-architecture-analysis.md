# Forum sync: analiza i rekomendacja

Data: 2026-11-21. Ograniczenie: forum ORAGH (MyBB, bez API, bez wpływu na nie) jest jedynym źródłem prawdy; czytamy je jako zalogowany użytkownik. Cel: dane w miarę na bieżąco i stabilnie.

## 1. Stan obecny (fakty z repo i historii przebiegów)

- Pipeline: `forum:sync` (login + scrape HTML cheerio: lista członków, fora fid=27/50, do 24 wątków, profile) -> `snapshot.json` -> `forum:publish` (upsert do `forum_snapshot_cache`, trigger ustawia `updated_at`). Pełny re-scrape za każdym razem.
- Uruchamia go GitHub Actions `schedule`. Sam przebieg trwa **~30-40 s** (kod ma retry HTTP 429/5xx z backoffem, 2 równoległe profile).
- Supabase jest self-hosted na serwerze `orbit` (Ubuntu); Cloud to tylko fallback. Dla arkusza już działa wzorzec `pg_cron` + Edge Function co 5 min.
- Historia ostatnich ~60 przebiegów: **~95% sukcesów**, 4 porażki skupione 10-12.11 (prawdopodobnie forum/sieć, retry je nie uratował). Ale **częstotliwość: ~3 przebiegi na dobę zamiast 24**, przerwy do ~9 h. Główny problem to harmonogram, nie scraper.

## 2. Kryteria

| Kryterium | Znaczenie |
|---|---|
| Świeżość | max ~1 h opóźnienia (dziś bywa 9 h) |
| Stabilność | odporność na chwilowe awarie forum i infrastruktury |
| Uprzejmość wobec forum | nie obciążać, nie wyglądać jak atak; jeden użytkownik, rozsądne tempo |
| Koszt operacyjny | mało ruchomych części, jeden właściciel |
| Obserwowalność | wiadomo, kiedy dane są stare i dlaczego |

## 3. Opcje

### A. Zostać na GitHub `schedule` (stan po moich zmianach)
Trzy cron-y/godz. + bramka wieku. Tanie, ale GitHub nie gwarantuje wykonania.

**Krytyk (niezawodność):** to nadal best-effort. Nie wiemy, czy 3 triggery poprawią sytuację; jeśli GitHub drosuje workflow jako całość, 3x zero to zero. Brak SLA.
**Krytyk (pragmatyk):** zero nowej infrastruktury, jest odwracalne, wystarczy zmierzyć po 24 h. Rozsądny punkt wyjścia, nie rozwiązanie docelowe.

### B. Scheduler na `orbit` (systemd timer lub cron) uruchamia ten sam skrypt
Serwer już istnieje, jest własnością zespołu i stoi 24/7. `npm run forum:sync:publish` co 15-30 min; GitHub Actions zostaje jako ręczny `workflow_dispatch` i zapasowy.

**Krytyk (niezawodność):** pojedynczy serwer = pojedynczy punkt awarii (prąd, sieć domowa, tunel Cloudflare). Ale Supabase i tak tam stoi: jeśli orbit leży, aplikacja i tak nie ma bazy, więc zależność nie jest nowa.
**Krytyk (forum / IP):** ruch z jednego stałego, domowego/serwerowego adresu jest dla forum bardziej naturalny niż rotujące IP runnerów GitHuba. Plus, nie ma ryzyka blokady zakresów datacenter.
**Krytyk (bezpieczeństwo):** hasło do forum musi leżeć na serwerze; trzymać w pliku `0600`, osobny użytkownik systemowy, konto forum o minimalnych uprawnieniach.
**Krytyk (ops):** trzeba zadbać o logi i alert przy błędzie. Rozwiązanie: `OnFailure=` w systemd -> mail/webhook, albo healthchecks.io ping po udanym syncu (alert, gdy ping nie przyjdzie).

### C. Supabase `pg_cron` -> Edge Function robi scrape
Spójne z istniejącym sync arkusza.

**Krytyk (techniczny):** Edge Functions mają limity czasu i pamięci; scrape z loginem i cookie jar w Deno jest do zrobienia, ale to przepisanie 1400 linii i nowy kod do utrzymania. Zysk względem B minimalny, bo B daje ten sam harmonogram bez przepisywania.
**Krytyk (YAGNI):** odrzucić, chyba że chcemy pozbyć się Node z serwera.

### D. pg_cron -> GitHub `workflow_dispatch` (token GitHub w Supabase)
Niezawodny wyzwalacz + istniejący workflow.

**Krytyk (bezpieczeństwo):** długowieczny token GitHub w bazie. **Krytyk (złożoność):** dwa systemy, a GitHub nadal bywa kolejkowany i może być niedostępny. Dodaje zależność zamiast ją usuwać.

### E. Event-driven / webhook z forum
MyBB bez zmian po naszej stronie: niemożliwe. Odpada przez założenie projektu.

### F. Przyrostowy scrape (tylko zmienione wątki)
Dziś pełny re-scrape trwa ~35 s, więc to optymalizacja bez problemu do rozwiązania. Ma sens dopiero przy częstotliwości <5 min albo gdy forum zacznie limitować. **Krytyk:** komplikuje poprawność (usunięte posty, edycje); nie robić teraz.

## 4. Rekomendacja

1. **Zmierzyć A przez 24-48 h** (zrobione: 3 triggery + bramka). Jeśli przebiegów `schedule` nadal jest <10/dobę, uznać GitHub cron za niewystarczający.
2. **Wdrożyć B** jako wyzwalacz główny: systemd timer na `orbit`, co 20-30 min z losowym jitterem (`RandomizedDelaySec`), ten sam skrypt, `Persistent=true`. GitHub workflow zostaje jako ręczny i awaryjny.
3. **Obserwowalność zamiast watchdoga w tym samym schedulerze:** ping zewnętrzny (healthchecks.io lub podobne) po sukcesie; brak pingu w oczekiwanym oknie -> powiadomienie. Baner w aplikacji dalej pokazuje wiek danych użytkownikom.
4. **Higiena wobec forum:** stały, zwykły User-Agent, jitter, backoff (już jest), brak równoległości >2, nigdy retry-burst po 429/403; przy kilku porażkach z rzędu wydłużać interwał zamiast uderzać mocniej. Rozważyć wykrywanie "login failed" osobno od błędów sieci.
5. **Zmiana atomowości publish:** dziś sync nadpisuje snapshot także wtedy, gdy scrape zwróci podejrzanie mało danych (np. forum zwróciło stronę błędu z HTTP 200). Dodać sanity-check (liczba wydarzeń/członków nie spada o >50% względem poprzedniego snapshotu), inaczej nie publikować i zgłosić błąd. To jest największe realne ryzyko stabilności danych, ważniejsze niż sam harmonogram.
6. **Spójne progi:** baner (`expectedSyncIntervalHours`) i alert muszą używać tej samej wartości, najlepiej 2 h przy syncu co 30 min.

## 5. Czego nie wiemy / do decyzji

- Czy `orbit` jest dostępny 24/7 i kto ma na nim dostęp (potrzebny `sudo` do instalacji timera).
- Czy właściciel forum akceptuje częstość co 15-30 min (jedna sesja, ~dziesiątki żądań). To nasza reputacja na forum, nie kwestia techniczna.
- Jaki kanał alertów (mail, Discord, healthchecks.io).
