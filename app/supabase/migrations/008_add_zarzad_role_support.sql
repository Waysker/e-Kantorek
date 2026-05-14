alter table public.profiles
drop constraint if exists profiles_role_check;

alter table public.profiles
add constraint profiles_role_check
check (role in ('member', 'leader', 'zarzad', 'admin'));

update public.profiles
set role = 'zarzad'
where translate(lower(coalesce(role, '')), 'ąćęłńóśźż', 'acelnoszz') in ('zarzad', 'board', 'management');

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
  parsed_role := translate(
    lower(
      coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'role'), ''),
        'member'
      )
    ),
    'ąćęłńóśźż',
    'acelnoszz'
  );

  if parsed_first_name is null or parsed_last_name is null or parsed_instrument is null then
    raise exception 'Missing required user metadata: firstName, lastName, instrument.';
  end if;

  if parsed_role in ('board', 'management') then
    parsed_role := 'zarzad';
  end if;

  if parsed_role not in ('member', 'leader', 'zarzad', 'admin') then
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

drop policy if exists "Allow privileged insert attendance sheet cache" on public.attendance_sheet_cache;
create policy "Allow privileged insert attendance sheet cache"
on public.attendance_sheet_cache
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('board', 'zarzad', 'admin')
  )
);

drop policy if exists "Allow privileged update attendance sheet cache" on public.attendance_sheet_cache;
create policy "Allow privileged update attendance sheet cache"
on public.attendance_sheet_cache
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('board', 'zarzad', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('board', 'zarzad', 'admin')
  )
);

drop policy if exists "Allow privileged insert forum instrument overrides" on public.forum_instrument_overrides;
create policy "Allow privileged insert forum instrument overrides"
on public.forum_instrument_overrides
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('board', 'zarzad', 'admin')
  )
);

drop policy if exists "Allow privileged update forum instrument overrides" on public.forum_instrument_overrides;
create policy "Allow privileged update forum instrument overrides"
on public.forum_instrument_overrides
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('board', 'zarzad', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('board', 'zarzad', 'admin')
  )
);

create or replace function public.send_event_attendance_reminders(
  p_event_id text,
  p_event_title text,
  p_declared_full_names text[] default '{}'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_instrument public.oragh_instrument;
  v_notified_count integer := 0;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.';
  end if;

  select p.role, p.instrument
  into v_actor_role, v_actor_instrument
  from public.profiles p
  where p.id = v_actor_id;

  if v_actor_role not in ('section', 'board', 'admin', 'leader', 'zarzad') then
    raise exception 'Only section/board/admin roles can send attendance reminders.';
  end if;

  if p_event_id is null or length(trim(p_event_id)) = 0 then
    raise exception 'Event id is required.';
  end if;

  if p_event_title is null or length(trim(p_event_title)) = 0 then
    raise exception 'Event title is required.';
  end if;

  with declared_names as (
    select distinct
      regexp_replace(
        trim(lower(coalesce(declared.name, ''))),
        '\s+',
        ' ',
        'g'
      ) as normalized_full_name
    from unnest(coalesce(p_declared_full_names, array[]::text[])) as declared(name)
    where length(trim(coalesce(declared.name, ''))) > 0
  ),
  recipients as (
    select profile.id
    from public.profiles profile
    left join declared_names declared
      on declared.normalized_full_name = regexp_replace(
        trim(lower(coalesce(profile.full_name, ''))),
        '\s+',
        ' ',
        'g'
      )
    where declared.normalized_full_name is null
      and profile.id <> v_actor_id
      and (
        v_actor_role in ('admin', 'board', 'zarzad')
        or (
          v_actor_role in ('section', 'leader')
          and profile.instrument = v_actor_instrument
        )
      )
  )
  insert into public.notifications (
    user_id,
    kind,
    title,
    body,
    ref_type,
    ref_id,
    created_by
  )
  select
    recipient.id,
    'attendance_reminder',
    'Ponaglenie obecnosci',
    format('Prosimy o deklaracje obecnosci dla wydarzenia: %s.', trim(p_event_title)),
    'event',
    trim(p_event_id),
    v_actor_id
  from recipients as recipient;

  get diagnostics v_notified_count = row_count;
  return v_notified_count;
end;
$$;

revoke all on function public.send_event_attendance_reminders(text, text, text[]) from public;
grant execute on function public.send_event_attendance_reminders(text, text, text[]) to authenticated;
