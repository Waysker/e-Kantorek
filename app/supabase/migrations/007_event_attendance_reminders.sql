create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('feed_post', 'event_update', 'attendance_reminder', 'event_reminder')),
  title text not null check (char_length(trim(title)) > 0),
  body text not null check (char_length(trim(body)) > 0),
  ref_type text,
  ref_id text,
  created_by uuid references public.profiles(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_created_at
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "Users can read own notifications" on public.notifications;
create policy "Users can read own notifications"
on public.notifications
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can update own notifications" on public.notifications;
create policy "Users can update own notifications"
on public.notifications
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;

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
