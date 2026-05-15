create or replace function public.send_event_attendance_reminders_detailed(
  p_event_id text,
  p_event_title text,
  p_declared_full_names text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_instrument public.oragh_instrument;
  v_notified_count integer := 0;
  v_notified_names text[] := array[]::text[];
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
    select
      profile.id,
      coalesce(nullif(trim(profile.full_name), ''), profile.id::text) as full_name
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
  ),
  inserted as (
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
    from recipients as recipient
    returning user_id
  ),
  notified as (
    select recipient.full_name
    from recipients recipient
    join inserted i
      on i.user_id = recipient.id
  )
  select
    count(*),
    coalesce(array_agg(notified.full_name order by notified.full_name), array[]::text[])
  into v_notified_count, v_notified_names
  from notified;

  raise log 'send_event_attendance_reminders_detailed actor=% role=% event=% recipients=% recipients_count=%',
    v_actor_id,
    v_actor_role,
    trim(p_event_id),
    v_notified_names,
    v_notified_count;

  return jsonb_build_object(
    'notified_count',
    v_notified_count,
    'notified_full_names',
    to_jsonb(v_notified_names)
  );
end;
$$;

revoke all on function public.send_event_attendance_reminders_detailed(text, text, text[]) from public;
grant execute on function public.send_event_attendance_reminders_detailed(text, text, text[]) to authenticated;
