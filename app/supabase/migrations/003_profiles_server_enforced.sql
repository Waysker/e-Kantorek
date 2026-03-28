do $$
begin
  if not exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'oragh_instrument'
  ) then
    create type public.oragh_instrument as enum (
      'Flety',
      'Oboje',
      'Klarnety',
      'Saksofony',
      'Fagoty',
      'Waltornie',
      'Trąbki',
      'Eufonia',
      'Puzony',
      'Perkusja',
      'Gitara',
      'Bas',
      'Tuba'
    );
  end if;
end
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (char_length(trim(first_name)) > 0),
  last_name text not null check (char_length(trim(last_name)) > 0),
  full_name text not null check (char_length(trim(full_name)) > 0),
  instrument public.oragh_instrument not null,
  role text not null default 'member' check (role in ('member', 'leader', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.normalize_profile_record()
returns trigger
language plpgsql
as $$
begin
  new.first_name := trim(new.first_name);
  new.last_name := trim(new.last_name);
  new.full_name := trim(new.first_name || ' ' || new.last_name);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_normalize_record on public.profiles;
create trigger trg_profiles_normalize_record
before insert or update on public.profiles
for each row
execute function public.normalize_profile_record();

create or replace function public.prevent_client_profile_role_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and new.role is distinct from old.role
     and coalesce(auth.role(), 'service_role') <> 'service_role' then
    raise exception 'Only service role can change profile role.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_prevent_client_role_change on public.profiles;
create trigger trg_profiles_prevent_client_role_change
before update on public.profiles
for each row
execute function public.prevent_client_profile_role_change();

create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parsed_first_name text;
  parsed_last_name text;
  parsed_instrument text;
  parsed_role text;
begin
  parsed_first_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'firstName'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'first_name'), '')
  );
  parsed_last_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'lastName'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'last_name'), '')
  );
  parsed_instrument := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'instrument'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'primaryInstrument'), '')
  );
  parsed_role := lower(coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'role'), ''),
    'member'
  ));

  if parsed_first_name is null or parsed_last_name is null or parsed_instrument is null then
    raise exception 'Missing required user metadata: firstName, lastName, instrument.';
  end if;

  if parsed_role not in ('member', 'leader', 'admin') then
    parsed_role := 'member';
  end if;

  insert into public.profiles (id, first_name, last_name, full_name, instrument, role)
  values (
    new.id,
    parsed_first_name,
    parsed_last_name,
    trim(parsed_first_name || ' ' || parsed_last_name),
    parsed_instrument::public.oragh_instrument,
    parsed_role
  )
  on conflict (id) do update
    set first_name = excluded.first_name,
        last_name = excluded.last_name,
        full_name = excluded.full_name,
        instrument = excluded.instrument,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_auth_user_created_profile on auth.users;
create trigger trg_auth_user_created_profile
after insert on auth.users
for each row
execute function public.handle_new_auth_user_profile();

insert into public.profiles (id, first_name, last_name, full_name, instrument, role)
select
  u.id,
  trim(
    coalesce(
      nullif(u.raw_user_meta_data ->> 'firstName', ''),
      nullif(u.raw_user_meta_data ->> 'first_name', '')
    )
  ) as first_name,
  trim(
    coalesce(
      nullif(u.raw_user_meta_data ->> 'lastName', ''),
      nullif(u.raw_user_meta_data ->> 'last_name', '')
    )
  ) as last_name,
  trim(
    concat_ws(' ',
      coalesce(
        nullif(u.raw_user_meta_data ->> 'firstName', ''),
        nullif(u.raw_user_meta_data ->> 'first_name', '')
      ),
      coalesce(
        nullif(u.raw_user_meta_data ->> 'lastName', ''),
        nullif(u.raw_user_meta_data ->> 'last_name', '')
      )
    )
  ) as full_name,
  (
    coalesce(
      nullif(u.raw_user_meta_data ->> 'instrument', ''),
      nullif(u.raw_user_meta_data ->> 'primaryInstrument', '')
    )
  )::public.oragh_instrument as instrument,
  case
    when lower(coalesce(u.raw_user_meta_data ->> 'role', 'member')) in ('member', 'leader', 'admin')
      then lower(coalesce(u.raw_user_meta_data ->> 'role', 'member'))
    else 'member'
  end as role
from auth.users u
where not exists (
  select 1
  from public.profiles p
  where p.id = u.id
)
and coalesce(
  nullif(trim(u.raw_user_meta_data ->> 'firstName'), ''),
  nullif(trim(u.raw_user_meta_data ->> 'first_name'), '')
) is not null
and coalesce(
  nullif(trim(u.raw_user_meta_data ->> 'lastName'), ''),
  nullif(trim(u.raw_user_meta_data ->> 'last_name'), '')
) is not null
and coalesce(
  nullif(trim(u.raw_user_meta_data ->> 'instrument'), ''),
  nullif(trim(u.raw_user_meta_data ->> 'primaryInstrument'), '')
) in (
  'Flety',
  'Oboje',
  'Klarnety',
  'Saksofony',
  'Fagoty',
  'Waltornie',
  'Trąbki',
  'Eufonia',
  'Puzony',
  'Perkusja',
  'Gitara',
  'Bas',
  'Tuba'
);

alter table public.profiles enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

grant select, insert, update on table public.profiles to authenticated;
