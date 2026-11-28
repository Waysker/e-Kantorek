# Konto w aplikacji ↔ osoba z forum

Deklaracje pochodzą z ankiet na forum i mają klucz `forum-user-<uid>`. Aplikacja musi wiedzieć, która osoba z forum to zalogowany członek. Do 2026-11 dopasowywała po imieniu i nazwisku z rejestracji, więc „Kasia Rech” nie widziała deklaracji „Katarzyny Rech”.

## Model (migracja `033_profile_forum_links.sql`)

- `profile_forum_links`: jedno połączenie na profil (`forum_uid` unikalny) albo `no_forum_account = true`.
  - `status = proposed`: połączył sam członek (`claim_my_forum_identity`) albo baza przy pierwszym wczytaniu (`resolve_my_forum_identity`: dokładnie jedna osoba w snapshocie z tym samym imieniem, nazwiskiem i sekcją, wolna). Aplikacja czyta z tym deklaracje.
  - `status = verified`: zatwierdził zarząd (`board_set_forum_identity`). Wymagane, zanim cokolwiek zostanie zapisane w imieniu członka.
- `forum_identity_link_audit`: każda zmiana (kto, kiedy, z czego na co).
- Kandydaci (`list_forum_identity_candidates`): wszyscy z numerycznym uid, którzy odpowiedzieli w jakiejś ankiecie w bieżącym snapshocie (`forum_snapshot_people_raw`). Kto nie głosował w tym sezonie, nie jest kandydatem.
- Zapis tylko przez RPC (security definer). Klient czyta wyłącznie własny wiersz.
- `list_profiles_for_role_admin` zwraca `email_confirmed`.

## Aplikacja

- Konto połączone: status po uid. Konto bez połączenia albo bez konta na forum: status `unknown`, bez etykiety. Brak migracji w bazie (`resolve_my_forum_identity` zwraca błąd): stary sposób, po imieniu.
- Start: karta `ForumIdentityPrompt` („Czy to Ty na forum?”, lista sekcji, „Nie mam konta na forum”). Podpowiedź: to samo nazwisko (lub jedna literówka), ta sama sekcja, imię równe, zdrobnienie albo jedna literówka; przy dwóch pasujących osobach nie zgaduje (`src/domain/forumIdentity.ts`).
- Ja → „Konto na forum”: podgląd i „Zmień”. Zmiana wraca do `proposed`.
- Zarząd → Osoby z forum → Konta: Do potwierdzenia, Bez połączenia (z podpowiedzią), Potwierdzone, Ostatnie zmiany. Licznik „N do potwierdzenia” na zakładce.
- Role: konta bez potwierdzonego e-maila w osobnej karcie „Niepotwierdzone konta”.
- Logowanie na niepotwierdzony adres: „Wyślij link ponownie” (`auth.resend`, typ `signup`).

## Wdrożenie na orbit

Migrację uruchamia użytkownik (zapis wymaga `sudo`), z checkoutu sync po `git pull --ff-only`:

```bash
sudo docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /home/waysker/e-Kantorek-sync/app/supabase/migrations/033_profile_forum_links.sql
```

Po migracji połączenia tworzą się przy kolejnym wczytaniu aplikacji przez każdego członka (dokładne dopasowania) albo przez zarząd w „Konta”. Ręczny wpis Kasi w `profile_member_links` (arkusz obecności) to inna tabela i zostaje bez zmian.

Wycofanie: `drop table public.profile_forum_links, public.forum_identity_link_audit cascade;` oraz usunięcie funkcji z migracji. Wcześniejszą wersję `list_profiles_for_role_admin` przywraca migracja 016. Aplikacja bez tych funkcji wraca do dopasowania po imieniu.
