# Kantorek (feed)

Tablica orkiestry w aplikacji, jak grupa na Facebooku: wpisy, komentarze, „Lubię to”,
ankiety, zdjęcia i pliki. Wzorzec: Partytura → Patterns → Kantorek (feed). Zakładka
„Kantorek” między Wydarzeniami a Zarządem.

## Kto co może

- Każdy zalogowany: pisze wpisy i komentarze, lubi, głosuje; edytuje i usuwa swoje.
- Zarząd i admin (`profiles.role` board / zarzad / admin): przypina, odpina i usuwa
  dowolny wpis i komentarz.

## Dane

- Migracja `035_feed.sql`: `feed_posts`, `feed_comments`, `feed_reactions`, `feed_polls`,
  `feed_poll_options`, `feed_poll_votes`, `feed_attachments`, kolumna
  `push_subscriptions.topics`. Klienci tylko czytają tabele; każdy zapis idzie przez RPC
  (`create_feed_post`, `vote_feed_poll`, `toggle_feed_reaction`, …), które biorą autora z
  `auth.uid()`. Odczyt: `list_feed`, `get_feed_post`, `feed_people`.
- Migracja `036_feed_storage.sql` (jako `supabase_admin`): prywatny bucket `feed`
  (10 MB, zdjęcia, PDF, arkusze, dokumenty) i zasady: każdy członek czyta, zapisuje i usuwa
  tylko w folderze `<swoje uid>/`. Aplikacja pokazuje pliki przez podpisane linki (1 h).
  Zdjęcia zmniejsza do 1600 px (JPEG) przed wysłaniem.
- Usunięcie wpisu przez autora kasuje też jego pliki; usunięcie przez zarząd zostawia pliki
  w Storage (bez wpisu nikt ich nie widzi).

## Powiadomienia

`push_new_events` (cron co 5 min) po wydarzeniach z forum bierze wpisy bez `notified_at`
(`claim_feed_posts_for_push`) i wysyła „Nowy wpis: <autor>” z pierwszą linią tekstu.
Nie do autora, nie o komentarzach, nie o wpisach starszych niż doba. Więcej niż 3 naraz →
jedno zbiorcze. Kto chce: `push_subscriptions.topics` (`new_event`, `new_post`),
ustawiane w Ja → Powiadomienia; karta na Start włącza oba.

## Wdrożenie

1. Scalić PR, `git -C /home/waysker/e-Kantorek-sync pull --ff-only`.
2. `bash /home/waysker/e-Kantorek-sync/deploy/orbit/feed-setup.sh` (migracje 035 i 036,
   funkcja, restart, sprawdzenie).
3. Deploy frontu (`Deploy Web Production`). Dopiero po kroku 2: front woła nowe RPC.

## Sprawdzanie (odczyt)

`select count(*) from feed_posts;`, `select id, created_at, notified_at from feed_posts order by created_at desc limit 5;`,
`select id from storage.buckets;`.

## Historia z Facebooka

Facebook nie daje eksportu całej grupy, więc wpisy z „Wirtualnego kantorka” zarząd przenosi
ręcznie: Kantorek → „Import z Facebooka” (tylko board/admin). Formularz: autor, data
(`21.10.2026 18:40`, czas Warszawy), treść (na FB najpierw „Zobacz więcej”), link do wpisu,
liczba polubień, zdjęcia i pliki, ankieta z liczbą głosów, komentarze. Po dodaniu formularz
się czyści (autor i data zostają).

Migracja `037_feed_facebook_import.sql`: `feed_posts.source = 'facebook'`, nazwisko autora z
FB, link, polubienia z FB; zamknięte ankiety z głosami z FB; RPC `import_feed_post` (tylko
zarząd, `notified_at` od razu, więc bez push). Zaimportowane wpisy nie należą do żadnego
konta; poprawia je i usuwa zarząd. Przed przenoszeniem zarząd ogłasza to w grupie; kto nie
chce, zgłasza się, a jego wpisy pomijamy albo usuwamy.

Wdrożenie 037: `sudo docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /home/waysker/e-Kantorek-sync/app/supabase/migrations/037_feed_facebook_import.sql`
(po `git pull`), potem deploy frontu.
