do $$
begin
  if exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'oragh_instrument'
  ) then
    alter type public.oragh_instrument add value if not exists 'Gitary';
    alter type public.oragh_instrument add value if not exists 'Tuby';
  end if;
end
$$;

create or replace function public.canonicalize_instrument_label(raw_value text)
returns text
language plpgsql
immutable
as $$
declare
  normalized text;
begin
  normalized := regexp_replace(
    translate(lower(trim(coalesce(raw_value, ''))), 'ąćęłńóśźż', 'acelnoszz'),
    '\s+',
    ' ',
    'g'
  );

  if normalized = '' then
    return null;
  end if;

  if normalized in ('flet', 'flety') then
    return 'Flety';
  elsif normalized in ('oboj', 'oboje') then
    return 'Oboje';
  elsif normalized in ('klarnet', 'klarnety') then
    return 'Klarnety';
  elsif normalized in ('fagot', 'fagoty') then
    return 'Fagoty';
  elsif normalized in ('saksofon', 'saksofony') then
    return 'Saksofony';
  elsif normalized in ('waltornia', 'waltornie') then
    return 'Waltornie';
  elsif normalized in ('trabka', 'trabki') then
    return 'Trąbki';
  elsif normalized in ('puzon', 'puzony') then
    return 'Puzony';
  elsif normalized in ('tuba', 'tuby') then
    return 'Tuby';
  elsif normalized in ('eufonia', 'eufonie') then
    return 'Eufonia';
  elsif normalized = 'perkusja' then
    return 'Perkusja';
  elsif normalized in ('gitara', 'gitary', 'bas', 'basy') then
    return 'Gitary';
  end if;

  return trim(raw_value);
end;
$$;

create or replace function public.normalize_profile_record()
returns trigger
language plpgsql
as $$
begin
  new.first_name := trim(new.first_name);
  new.last_name := trim(new.last_name);
  new.full_name := trim(new.first_name || ' ' || new.last_name);
  new.instrument := public.canonicalize_instrument_label(new.instrument::text)::public.oragh_instrument;
  new.updated_at := now();
  return new;
end;
$$;

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
  parsed_instrument := public.canonicalize_instrument_label(
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'instrument'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'primaryInstrument'), '')
    )
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

update public.profiles
set instrument = public.canonicalize_instrument_label(instrument::text)::public.oragh_instrument
where public.canonicalize_instrument_label(instrument::text) is not null
  and instrument::text is distinct from public.canonicalize_instrument_label(instrument::text);

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
  public.canonicalize_instrument_label(
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
and public.canonicalize_instrument_label(
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'instrument'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'primaryInstrument'), '')
  )
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
  'Gitary',
  'Tuby'
);

create or replace function public.normalize_member_instrument_record()
returns trigger
language plpgsql
as $$
declare
  canonical text;
begin
  canonical := public.canonicalize_instrument_label(new.instrument);
  if canonical is null then
    new.instrument := trim(new.instrument);
  else
    new.instrument := canonical;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_members_normalize_instrument on public.members;
create trigger trg_members_normalize_instrument
before insert or update on public.members
for each row
execute function public.normalize_member_instrument_record();

update public.members
set instrument = public.canonicalize_instrument_label(instrument)
where public.canonicalize_instrument_label(instrument) is not null
  and instrument is distinct from public.canonicalize_instrument_label(instrument);
