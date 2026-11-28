-- Links an app account (profile) to one person on the forum, by forum uid.
-- Declarations come from forum polls, keyed by forum uid ("forum-user-<uid>"),
-- so matching by the name typed at registration ("Kasia" vs "Katarzyna") fails.
--
-- status:
--   proposed  the member (or the exact-name match) linked it; the app reads with it
--   verified  the board confirmed it; required before anything is written in the
--             member's name
-- no_forum_account: the member said they have no forum account (no prompt again).
--
-- Writes go through security definer RPCs only; every change lands in
-- forum_identity_link_audit. Also: list_profiles_for_role_admin now says whether
-- the account's e-mail is confirmed, so the board can tell real members from
-- abandoned sign-ups.

create table if not exists public.profile_forum_links (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  forum_uid text check (forum_uid ~ '^[0-9]+$'),
  forum_full_name text,
  no_forum_account boolean not null default false,
  status text not null check (status in ('proposed', 'verified')),
  method text not null check (method in ('self', 'board', 'auto_exact')),
  linked_by uuid,
  verified_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((forum_uid is null) = no_forum_account)
);

create unique index if not exists uniq_profile_forum_links_forum_uid
  on public.profile_forum_links (forum_uid)
  where forum_uid is not null;

create table if not exists public.forum_identity_link_audit (
  id bigserial primary key,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  action text not null check (action in ('auto_exact', 'claim', 'no_forum_account', 'board_link', 'board_verify', 'board_clear')),
  profile_id uuid not null,
  profile_full_name text,
  old_forum_uid text,
  new_forum_uid text,
  old_forum_full_name text,
  new_forum_full_name text,
  old_status text,
  new_status text
);

create index if not exists idx_forum_identity_link_audit_changed_at
  on public.forum_identity_link_audit (changed_at desc);

alter table public.profile_forum_links enable row level security;
alter table public.forum_identity_link_audit enable row level security;

drop policy if exists "Members read own forum link" on public.profile_forum_links;
create policy "Members read own forum link"
on public.profile_forum_links
for select
to authenticated
using (auth.uid() = profile_id);

revoke all on table public.profile_forum_links from public, anon, authenticated;
revoke all on table public.forum_identity_link_audit from public, anon, authenticated;
grant select on table public.profile_forum_links to authenticated;

-- Everyone who answered any poll in the current snapshot, one row per forum uid.
-- attendanceGroups carries every answer (going and not going) with the mapped
-- instrument; squad groups add the instrument for going/maybe answers.
create or replace function public.forum_snapshot_people_raw()
returns table (
  forum_uid text,
  full_name text,
  instrument text
)
language sql
stable
security definer
set search_path = public
as $$
  with raw as (
    select
      substring(p ->> 'id' from '^forum-user-([0-9]+)$') as forum_uid,
      nullif(trim(p ->> 'fullName'), '') as full_name,
      nullif(trim(p ->> 'primaryInstrument'), '') as instrument,
      1 as priority
    from public.forum_snapshot_cache c
    cross join lateral jsonb_each(coalesce(c.payload -> 'eventDetailsById', '{}'::jsonb)) as d(event_id, detail)
    cross join lateral jsonb_array_elements(coalesce(d.detail -> 'attendanceGroups', '[]'::jsonb)) as g(grp)
    cross join lateral jsonb_array_elements(coalesce(g.grp -> 'participants', '[]'::jsonb)) as part(p)
    where c.snapshot_key = 'forum'
    union all
    select
      substring(m ->> 'id' from '^forum-user-([0-9]+)$'),
      nullif(trim(m ->> 'fullName'), ''),
      nullif(trim(g.grp ->> 'instrument'), ''),
      2
    from public.forum_snapshot_cache c
    cross join lateral jsonb_each(coalesce(c.payload -> 'eventDetailsById', '{}'::jsonb)) as d(event_id, detail)
    cross join lateral jsonb_array_elements(coalesce(d.detail -> 'squad' -> 'groups', '[]'::jsonb)) as g(grp)
    cross join lateral jsonb_array_elements(
      coalesce(g.grp -> 'confirmedMembers', '[]'::jsonb) || coalesce(g.grp -> 'maybeMembers', '[]'::jsonb)
    ) as mem(m)
    where c.snapshot_key = 'forum'
  )
  select distinct on (raw.forum_uid)
    raw.forum_uid,
    raw.full_name,
    nullif(raw.instrument, 'Instrument not mapped yet')
  from raw
  where raw.forum_uid is not null and raw.full_name is not null
  order by raw.forum_uid, raw.priority, (raw.instrument is null or raw.instrument = 'Instrument not mapped yet'), raw.instrument
$$;

-- Lower case, Polish letters folded, single spaces.
create or replace function public.forum_identity_name_key(p_name text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
    lower(translate(coalesce(p_name, ''), 'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ', 'acelnoszzACELNOSZZ')),
    '[^a-z0-9]+', ' ', 'g'
  ))
$$;

create or replace function public.forum_identity_require_caller()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = caller_id) then
    raise exception 'Profile not found.';
  end if;
  return caller_id;
end;
$$;

-- The caller's link. With no link yet, links the one forum person with exactly
-- the same name and section, if nobody else holds them (as 'proposed').
create or replace function public.resolve_my_forum_identity()
returns table (
  forum_uid text,
  forum_full_name text,
  no_forum_account boolean,
  status text,
  method text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := public.forum_identity_require_caller();
  caller_name text;
  caller_instrument text;
  match_count integer;
  match_uid text;
  match_name text;
begin
  if not exists (select 1 from public.profile_forum_links l where l.profile_id = caller_id) then
    select p.full_name, p.instrument::text into caller_name, caller_instrument
    from public.profiles p where p.id = caller_id;

    select count(*), min(fp.forum_uid), min(fp.full_name)
      into match_count, match_uid, match_name
    from public.forum_snapshot_people_raw() fp
    where public.forum_identity_name_key(fp.full_name) = public.forum_identity_name_key(caller_name)
      and fp.instrument is not distinct from caller_instrument;

    if match_count = 1
       and not exists (select 1 from public.profile_forum_links l where l.forum_uid = match_uid) then
      insert into public.profile_forum_links (profile_id, forum_uid, forum_full_name, status, method, linked_by)
      values (caller_id, match_uid, match_name, 'proposed', 'auto_exact', caller_id);

      insert into public.forum_identity_link_audit
        (changed_by, action, profile_id, profile_full_name, new_forum_uid, new_forum_full_name, new_status)
      values (caller_id, 'auto_exact', caller_id, caller_name, match_uid, match_name, 'proposed');
    end if;
  end if;

  return query
  select l.forum_uid, l.forum_full_name, l.no_forum_account, l.status, l.method
  from public.profile_forum_links l
  where l.profile_id = caller_id;
end;
$$;

-- Forum people the caller may pick from. taken = already linked to another account.
create or replace function public.list_forum_identity_candidates()
returns table (
  forum_uid text,
  full_name text,
  instrument text,
  taken boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller_id uuid := public.forum_identity_require_caller();
begin
  return query
  select
    fp.forum_uid,
    fp.full_name,
    fp.instrument,
    exists (
      select 1 from public.profile_forum_links l
      where l.forum_uid = fp.forum_uid and l.profile_id <> caller_id
    ) as taken
  from public.forum_snapshot_people_raw() fp
  order by fp.full_name;
end;
$$;

create or replace function public.forum_identity_write_link(
  p_actor uuid,
  p_profile_id uuid,
  p_forum_uid text,
  p_no_forum_account boolean,
  p_status text,
  p_method text,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_row public.profile_forum_links%rowtype;
  new_name text;
  holder_name text;
  profile_name text;
begin
  if p_forum_uid is not null then
    select fp.full_name into new_name
    from public.forum_snapshot_people_raw() fp
    where fp.forum_uid = p_forum_uid;
    if new_name is null then
      raise exception 'Forum person % not found in the current snapshot.', p_forum_uid;
    end if;

    select p.full_name into holder_name
    from public.profile_forum_links l
    join public.profiles p on p.id = l.profile_id
    where l.forum_uid = p_forum_uid and l.profile_id <> p_profile_id;
    if holder_name is not null then
      raise exception 'Forum person is already linked to another account (%).', holder_name;
    end if;
  end if;

  select * into old_row from public.profile_forum_links l where l.profile_id = p_profile_id;
  select p.full_name into profile_name from public.profiles p where p.id = p_profile_id;

  insert into public.profile_forum_links as l
    (profile_id, forum_uid, forum_full_name, no_forum_account, status, method, linked_by, verified_by)
  values (
    p_profile_id, p_forum_uid, new_name, p_no_forum_account, p_status, p_method, p_actor,
    case when p_status = 'verified' then p_actor end
  )
  on conflict (profile_id) do update
    set forum_uid = excluded.forum_uid,
        forum_full_name = excluded.forum_full_name,
        no_forum_account = excluded.no_forum_account,
        status = excluded.status,
        method = excluded.method,
        linked_by = excluded.linked_by,
        verified_by = excluded.verified_by,
        updated_at = now();

  insert into public.forum_identity_link_audit
    (changed_by, action, profile_id, profile_full_name, old_forum_uid, new_forum_uid,
     old_forum_full_name, new_forum_full_name, old_status, new_status)
  values
    (p_actor, p_action, p_profile_id, profile_name, old_row.forum_uid, p_forum_uid,
     old_row.forum_full_name, new_name, old_row.status, p_status);
end;
$$;

-- The member picks themself. Always 'proposed': the board confirms later.
create or replace function public.claim_my_forum_identity(p_forum_uid text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := public.forum_identity_require_caller();
  existing public.profile_forum_links%rowtype;
begin
  if p_forum_uid is null or p_forum_uid !~ '^[0-9]+$' then
    raise exception 'Invalid forum uid.';
  end if;

  select * into existing from public.profile_forum_links l where l.profile_id = caller_id;
  if existing.forum_uid = p_forum_uid then
    return;
  end if;

  perform public.forum_identity_write_link(caller_id, caller_id, p_forum_uid, false, 'proposed', 'self', 'claim');
end;
$$;

create or replace function public.declare_no_forum_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := public.forum_identity_require_caller();
begin
  if exists (select 1 from public.profile_forum_links l where l.profile_id = caller_id and l.no_forum_account) then
    return;
  end if;
  perform public.forum_identity_write_link(caller_id, caller_id, null, true, 'proposed', 'self', 'no_forum_account');
end;
$$;

-- Board view: every account with a confirmed e-mail and its link.
create or replace function public.list_forum_identity_links()
returns table (
  profile_id uuid,
  full_name text,
  instrument text,
  forum_uid text,
  forum_full_name text,
  no_forum_account boolean,
  status text,
  method text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  perform public.forum_require_board_or_admin('list forum account links');

  return query
  select
    p.id,
    p.full_name,
    p.instrument::text,
    l.forum_uid,
    l.forum_full_name,
    coalesce(l.no_forum_account, false),
    l.status,
    l.method,
    l.updated_at
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.profile_forum_links l on l.profile_id = p.id
  where u.email_confirmed_at is not null
  order by lower(p.full_name), p.id;
end;
$$;

-- Board links (or confirms) an account: always 'verified'. p_forum_uid null with
-- p_no_forum_account = true records "no forum account".
create or replace function public.board_set_forum_identity(
  p_profile_id uuid,
  p_forum_uid text,
  p_no_forum_account boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := public.forum_require_board_or_admin('link forum accounts');
  existing public.profile_forum_links%rowtype;
begin
  if not exists (select 1 from public.profiles p where p.id = p_profile_id) then
    raise exception 'Profile not found.';
  end if;
  if p_no_forum_account then
    p_forum_uid := null;
  elsif p_forum_uid is null or p_forum_uid !~ '^[0-9]+$' then
    raise exception 'Invalid forum uid.';
  end if;

  select * into existing from public.profile_forum_links l where l.profile_id = p_profile_id;
  if found
     and existing.forum_uid is not distinct from p_forum_uid
     and existing.no_forum_account = coalesce(p_no_forum_account, false) then
    if existing.status = 'verified' then
      return;
    end if;
    update public.profile_forum_links
      set status = 'verified', verified_by = actor, updated_at = now()
      where profile_id = p_profile_id;
    insert into public.forum_identity_link_audit
      (changed_by, action, profile_id, profile_full_name, old_forum_uid, new_forum_uid,
       old_forum_full_name, new_forum_full_name, old_status, new_status)
    select actor, 'board_verify', p.id, p.full_name, existing.forum_uid, existing.forum_uid,
           existing.forum_full_name, existing.forum_full_name, existing.status, 'verified'
    from public.profiles p where p.id = p_profile_id;
    return;
  end if;

  perform public.forum_identity_write_link(
    actor, p_profile_id, p_forum_uid, coalesce(p_no_forum_account, false), 'verified', 'board', 'board_link'
  );
end;
$$;

create or replace function public.board_clear_forum_identity(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := public.forum_require_board_or_admin('unlink forum accounts');
  existing public.profile_forum_links%rowtype;
begin
  delete from public.profile_forum_links l where l.profile_id = p_profile_id
  returning * into existing;
  if existing.profile_id is null then
    return;
  end if;
  insert into public.forum_identity_link_audit
    (changed_by, action, profile_id, profile_full_name, old_forum_uid, old_forum_full_name, old_status)
  select actor, 'board_clear', p_profile_id, p.full_name, existing.forum_uid, existing.forum_full_name, existing.status
  from public.profiles p where p.id = p_profile_id;
end;
$$;

create or replace function public.list_forum_identity_audit(p_limit integer default 50)
returns table (
  changed_at timestamptz,
  changed_by_name text,
  action text,
  profile_full_name text,
  old_forum_full_name text,
  new_forum_full_name text,
  new_status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.forum_require_board_or_admin('read forum account history');

  return query
  select a.changed_at, p.full_name, a.action, a.profile_full_name,
         a.old_forum_full_name, a.new_forum_full_name, a.new_status
  from public.forum_identity_link_audit a
  left join public.profiles p on p.id = a.changed_by
  order by a.changed_at desc, a.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

-- Role list: add e-mail confirmation, so abandoned sign-ups stay apart.
drop function if exists public.list_profiles_for_role_admin();
create function public.list_profiles_for_role_admin()
returns table (
  id uuid,
  first_name text,
  last_name text,
  full_name text,
  instrument text,
  role text,
  created_at timestamptz,
  updated_at timestamptz,
  email_confirmed boolean
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  caller_id uuid;
  caller_role text;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'Unauthorized.';
  end if;

  select p.role
    into caller_role
  from public.profiles p
  where p.id = caller_id;

  if caller_role is distinct from 'admin' then
    raise exception 'Only admin can list profiles.';
  end if;

  return query
  select
    p.id,
    p.first_name,
    p.last_name,
    p.full_name,
    p.instrument::text,
    p.role,
    p.created_at,
    p.updated_at,
    (u.email_confirmed_at is not null)
  from public.profiles p
  left join auth.users u on u.id = p.id
  order by lower(p.full_name), p.id;
end;
$$;

revoke all on function public.forum_snapshot_people_raw() from public, anon, authenticated;
revoke all on function public.forum_identity_require_caller() from public, anon, authenticated;
revoke all on function public.forum_identity_write_link(uuid, uuid, text, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.resolve_my_forum_identity() from public, anon;
revoke all on function public.list_forum_identity_candidates() from public, anon;
revoke all on function public.claim_my_forum_identity(text) from public, anon;
revoke all on function public.declare_no_forum_account() from public, anon;
revoke all on function public.list_forum_identity_links() from public, anon;
revoke all on function public.board_set_forum_identity(uuid, text, boolean) from public, anon;
revoke all on function public.board_clear_forum_identity(uuid) from public, anon;
revoke all on function public.list_forum_identity_audit(integer) from public, anon;
revoke all on function public.list_profiles_for_role_admin() from public, anon;

grant execute on function public.resolve_my_forum_identity() to authenticated;
grant execute on function public.list_forum_identity_candidates() to authenticated;
grant execute on function public.claim_my_forum_identity(text) to authenticated;
grant execute on function public.declare_no_forum_account() to authenticated;
grant execute on function public.list_forum_identity_links() to authenticated;
grant execute on function public.board_set_forum_identity(uuid, text, boolean) to authenticated;
grant execute on function public.board_clear_forum_identity(uuid) to authenticated;
grant execute on function public.list_forum_identity_audit(integer) to authenticated;
grant execute on function public.list_profiles_for_role_admin() to authenticated, service_role;
