-- Board/admin panel support for mapping forum members to instruments.
--
-- forum_instrument_overrides has read-only RLS for clients, so edits go through
-- the security definer functions below, which check the caller's profile role.

-- Internal helper: members that the latest snapshot shows without an instrument.
-- Not granted to any client role; only the functions below call it.
create or replace function public.forum_unmapped_members_raw()
returns table (
  member_id text,
  full_name text,
  forum_uid text
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct
    m ->> 'id' as member_id,
    m ->> 'fullName' as full_name,
    substring(m ->> 'id' from '^forum-user-([0-9]+)$') as forum_uid
  from public.forum_snapshot_cache c
  cross join lateral jsonb_each(coalesce(c.payload -> 'eventDetailsById', '{}'::jsonb)) as d(event_id, detail)
  cross join lateral jsonb_array_elements(coalesce(d.detail -> 'squad' -> 'groups', '[]'::jsonb)) as g(grp)
  cross join lateral jsonb_array_elements(
    coalesce(g.grp -> 'confirmedMembers', '[]'::jsonb) || coalesce(g.grp -> 'maybeMembers', '[]'::jsonb)
  ) as mem(m)
  where c.snapshot_key = 'forum'
    and g.grp ->> 'instrument' = 'Instrument not mapped yet'
    and nullif(m ->> 'id', '') is not null
$$;

create or replace function public.list_unmapped_forum_members()
returns table (
  member_id text,
  full_name text,
  forum_uid text,
  pending_instrument text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller_id uuid;
  caller_role text;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'Unauthorized.';
  end if;

  select p.role into caller_role from public.profiles p where p.id = caller_id;
  if caller_role is null or caller_role not in ('board', 'admin') then
    raise exception 'Only board or admin can list unmapped forum members.';
  end if;

  -- pending_instrument: an override was already saved but the next forum sync
  -- has not picked it up yet (the snapshot still shows the member as unmapped).
  return query
  select
    u.member_id,
    u.full_name,
    u.forum_uid,
    coalesce(
      o.payload -> 'byUid' ->> u.forum_uid,
      o.payload -> 'byFullName' ->> u.full_name
    ) as pending_instrument
  from public.forum_unmapped_members_raw() u
  left join public.forum_instrument_overrides o on o.overrides_key = 'forum'
  order by lower(u.full_name), u.member_id;
end;
$$;

create or replace function public.set_forum_member_instrument(
  p_member_id text,
  p_instrument text
)
returns table (
  member_id text,
  instrument text,
  override_bucket text,
  override_key text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid;
  caller_role text;
  target record;
  allowed_instruments constant text[] := array[
    'Flety', 'Oboje', 'Klarnety', 'Saksofony', 'Fagoty', 'Waltornie',
    'Trąbki', 'Eufonia', 'Puzony', 'Perkusja', 'Gitary', 'Tuby'
  ];
  bucket text;
  entry_key text;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'Unauthorized.';
  end if;

  select p.role into caller_role from public.profiles p where p.id = caller_id;
  if caller_role is null or caller_role not in ('board', 'admin') then
    raise exception 'Only board or admin can map forum instruments.';
  end if;

  if p_instrument is null or not (p_instrument = any (allowed_instruments)) then
    raise exception 'Invalid instrument. Allowed values: %.', array_to_string(allowed_instruments, ', ');
  end if;

  -- Only members the snapshot currently shows as unmapped can be written, so
  -- the endpoint cannot be used to put arbitrary keys into the overrides.
  select u.member_id, u.full_name, u.forum_uid
    into target
  from public.forum_unmapped_members_raw() u
  where u.member_id = p_member_id;

  if not found then
    raise exception 'Forum member % is not currently unmapped.', p_member_id;
  end if;

  if target.forum_uid is not null then
    bucket := 'byUid';
    entry_key := target.forum_uid;
  else
    bucket := 'byFullName';
    entry_key := target.full_name;
  end if;

  insert into public.forum_instrument_overrides (overrides_key, payload)
  values (
    'forum',
    jsonb_build_object(
      'byUid', jsonb_build_object(),
      'byFullName', jsonb_build_object(),
      'byUsername', jsonb_build_object()
    )
  )
  on conflict (overrides_key) do nothing;

  update public.forum_instrument_overrides o
  set payload = jsonb_set(
    o.payload,
    array[bucket],
    coalesce(o.payload -> bucket, '{}'::jsonb) || jsonb_build_object(entry_key, p_instrument),
    true
  )
  where o.overrides_key = 'forum';

  return query select target.member_id, p_instrument, bucket, entry_key;
end;
$$;

revoke all on function public.forum_unmapped_members_raw() from public, anon, authenticated;
revoke all on function public.list_unmapped_forum_members() from public, anon;
revoke all on function public.set_forum_member_instrument(text, text) from public, anon;
grant execute on function public.list_unmapped_forum_members() to authenticated;
grant execute on function public.set_forum_member_instrument(text, text) to authenticated;
