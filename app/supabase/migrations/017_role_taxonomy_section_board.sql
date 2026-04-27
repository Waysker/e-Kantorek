create or replace function public.normalize_profile_role(raw_value text)
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

  if normalized = 'admin' then
    return 'admin';
  end if;

  if normalized in (
    'section',
    'leader',
    'lider',
    'sekcyjne',
    'sekcyjny',
    'sekcyjna',
    'sekcyjni'
  ) then
    return 'section';
  end if;

  if normalized in ('board', 'zarzad') then
    return 'board';
  end if;

  return 'member';
end;
$$;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
add constraint profiles_role_check
check (role in ('member', 'leader', 'section', 'board', 'admin'));

update public.profiles
set role = public.normalize_profile_role(role)
where role is distinct from public.normalize_profile_role(role);

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
add constraint profiles_role_check
check (role in ('member', 'section', 'board', 'admin'));

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
  parsed_role := public.normalize_profile_role(
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'role'), ''),
      'member'
    )
  );

  if parsed_first_name is null or parsed_last_name is null or parsed_instrument is null then
    raise exception 'Missing required user metadata: firstName, lastName, instrument.';
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
  public.normalize_profile_role(
    coalesce(
      nullif(trim(u.raw_user_meta_data ->> 'role'), ''),
      'member'
    )
  ) as role
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

create or replace function public.admin_set_profile_role(
  p_target_profile_id uuid,
  p_next_role text
)
returns table (
  id uuid,
  full_name text,
  role text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid;
  caller_role text;
  normalized_role text;
  normalized_role_key text;
  previous_role text;
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
    raise exception 'Only admin can update roles.';
  end if;

  if p_target_profile_id is null then
    raise exception 'Target profile id is required.';
  end if;

  normalized_role_key := regexp_replace(
    translate(lower(trim(coalesce(p_next_role, ''))), 'ąćęłńóśźż', 'acelnoszz'),
    '\s+',
    ' ',
    'g'
  );

  if normalized_role_key = 'admin' then
    normalized_role := 'admin';
  elsif normalized_role_key in (
    'section',
    'leader',
    'lider',
    'sekcyjne',
    'sekcyjny',
    'sekcyjna',
    'sekcyjni'
  ) then
    normalized_role := 'section';
  elsif normalized_role_key in ('board', 'zarzad') then
    normalized_role := 'board';
  elsif normalized_role_key = 'member' then
    normalized_role := 'member';
  else
    raise exception 'Invalid role. Allowed values: member, section, board, admin.';
  end if;

  if caller_id = p_target_profile_id and normalized_role <> 'admin' then
    raise exception 'Admin cannot demote self via this endpoint.';
  end if;

  select p.role
    into previous_role
  from public.profiles p
  where p.id = p_target_profile_id;

  if previous_role is null then
    raise exception 'Target profile not found.';
  end if;

  if previous_role is distinct from normalized_role then
    perform set_config('app.bypass_profile_role_guard', '1', true);

    update public.profiles
    set role = normalized_role,
        updated_at = now()
    where profiles.id = p_target_profile_id;

    insert into public.change_journal (entity_type, entity_id, action, actor, payload)
    values (
      'profile',
      p_target_profile_id::text,
      'role_changed',
      caller_id::text,
      jsonb_build_object(
        'previous_role', previous_role,
        'next_role', normalized_role
      )
    );
  end if;

  return query
  select
    p.id,
    p.full_name,
    p.role,
    p.updated_at
  from public.profiles p
  where p.id = p_target_profile_id;
end;
$$;
