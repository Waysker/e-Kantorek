-- Edit existing forum instrument mappings from the board panel, with an audit trail.
-- Builds on 027: every write through the panel RPCs is recorded in
-- forum_instrument_mapping_audit (who, when, old and new value).

create table if not exists public.forum_instrument_mapping_audit (
  id bigint generated always as identity primary key,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  changed_by_name text,
  action text not null check (action in ('assign', 'change')),
  bucket text not null check (bucket in ('byUid', 'byFullName', 'byUsername')),
  entry_key text not null,
  member_name text,
  old_instrument text,
  new_instrument text not null
);

-- No policies: clients never touch the table directly, only through the
-- security definer functions below.
alter table public.forum_instrument_mapping_audit enable row level security;
revoke all on table public.forum_instrument_mapping_audit from public, anon, authenticated;

create or replace function public.forum_allowed_instruments()
returns text[]
language sql
immutable
as $$
  select array[
    'Flety', 'Oboje', 'Klarnety', 'Saksofony', 'Fagoty', 'Waltornie',
    'Trąbki', 'Eufonia', 'Puzony', 'Perkusja', 'Gitary', 'Tuby'
  ]
$$;

-- Returns the caller's id after checking that they are board or admin.
create or replace function public.forum_require_board_or_admin(p_action text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  caller_role text;
begin
  if caller_id is null then
    raise exception 'Unauthorized.';
  end if;

  select p.role into caller_role from public.profiles p where p.id = caller_id;
  if caller_role is null or caller_role not in ('board', 'admin') then
    raise exception 'Only board or admin can %.', p_action;
  end if;

  return caller_id;
end;
$$;

-- Every member the latest snapshot knows about (any squad group), used to show names.
create or replace function public.forum_snapshot_members_raw()
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
    and nullif(m ->> 'id', '') is not null
$$;

-- 027's assign function, now also writing the audit row and using the shared helpers.
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
  target record;
  bucket text;
  entry_key text;
  previous_instrument text;
begin
  caller_id := public.forum_require_board_or_admin('map forum instruments');

  if p_instrument is null or not (p_instrument = any (public.forum_allowed_instruments())) then
    raise exception 'Invalid instrument. Allowed values: %.', array_to_string(public.forum_allowed_instruments(), ', ');
  end if;

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

  -- Lock the row so concurrent edits cannot lose each other's changes.
  select o.payload -> bucket ->> entry_key
    into previous_instrument
  from public.forum_instrument_overrides o
  where o.overrides_key = 'forum'
  for update;

  update public.forum_instrument_overrides o
  set payload = jsonb_set(
    o.payload,
    array[bucket],
    coalesce(o.payload -> bucket, '{}'::jsonb) || jsonb_build_object(entry_key, p_instrument),
    true
  )
  where o.overrides_key = 'forum';

  insert into public.forum_instrument_mapping_audit (
    changed_by, changed_by_name, action, bucket, entry_key, member_name, old_instrument, new_instrument
  )
  values (
    caller_id,
    (select p.full_name from public.profiles p where p.id = caller_id),
    case when previous_instrument is null then 'assign' else 'change' end,
    bucket,
    entry_key,
    target.full_name,
    previous_instrument,
    p_instrument
  );

  return query select target.member_id, p_instrument, bucket, entry_key;
end;
$$;

create or replace function public.list_forum_instrument_mappings()
returns table (
  bucket text,
  entry_key text,
  instrument text,
  member_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.forum_require_board_or_admin('list forum instrument mappings');

  return query
  select
    b.bucket,
    e.key,
    e.value #>> '{}',
    coalesce(n.full_name, case when b.bucket = 'byUid' then null else e.key end)
  from public.forum_instrument_overrides o
  cross join lateral (values ('byUid'), ('byFullName'), ('byUsername')) as b(bucket)
  cross join lateral jsonb_each(coalesce(o.payload -> b.bucket, '{}'::jsonb)) as e(key, value)
  left join (
    select distinct on (s.forum_uid) s.forum_uid, s.full_name
    from public.forum_snapshot_members_raw() s
    where s.forum_uid is not null
    order by s.forum_uid, s.full_name
  ) n on b.bucket = 'byUid' and n.forum_uid = e.key
  where o.overrides_key = 'forum'
  order by lower(coalesce(n.full_name, case when b.bucket = 'byUid' then null else e.key end)) nulls last,
           b.bucket, e.key;
end;
$$;

create or replace function public.change_forum_instrument_mapping(
  p_bucket text,
  p_key text,
  p_instrument text
)
returns table (
  out_bucket text,
  out_key text,
  old_instrument text,
  new_instrument text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid;
  previous_instrument text;
  display_name text;
begin
  caller_id := public.forum_require_board_or_admin('change forum instrument mappings');

  if p_bucket is null or p_bucket not in ('byUid', 'byFullName', 'byUsername') then
    raise exception 'Invalid mapping bucket.';
  end if;

  if p_instrument is null or not (p_instrument = any (public.forum_allowed_instruments())) then
    raise exception 'Invalid instrument. Allowed values: %.', array_to_string(public.forum_allowed_instruments(), ', ');
  end if;

  select o.payload -> p_bucket ->> p_key
    into previous_instrument
  from public.forum_instrument_overrides o
  where o.overrides_key = 'forum'
  for update;

  if previous_instrument is null then
    raise exception 'No % mapping for %.', p_bucket, p_key;
  end if;

  if previous_instrument = p_instrument then
    return query select p_bucket, p_key, previous_instrument, p_instrument;
    return;
  end if;

  update public.forum_instrument_overrides o
  set payload = jsonb_set(
    o.payload,
    array[p_bucket],
    coalesce(o.payload -> p_bucket, '{}'::jsonb) || jsonb_build_object(p_key, p_instrument),
    true
  )
  where o.overrides_key = 'forum';

  select coalesce(
           (select s.full_name from public.forum_snapshot_members_raw() s
             where p_bucket = 'byUid' and s.forum_uid = p_key
             order by s.full_name limit 1),
           case when p_bucket = 'byUid' then null else p_key end
         )
    into display_name;

  insert into public.forum_instrument_mapping_audit (
    changed_by, changed_by_name, action, bucket, entry_key, member_name, old_instrument, new_instrument
  )
  values (
    caller_id,
    (select p.full_name from public.profiles p where p.id = caller_id),
    'change',
    p_bucket,
    p_key,
    display_name,
    previous_instrument,
    p_instrument
  );

  return query select p_bucket, p_key, previous_instrument, p_instrument;
end;
$$;

create or replace function public.list_forum_instrument_audit(p_limit integer default 50)
returns table (
  changed_at timestamptz,
  changed_by_name text,
  action text,
  member_name text,
  entry_key text,
  old_instrument text,
  new_instrument text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.forum_require_board_or_admin('read the instrument mapping history');

  return query
  select a.changed_at, a.changed_by_name, a.action, a.member_name, a.entry_key, a.old_instrument, a.new_instrument
  from public.forum_instrument_mapping_audit a
  order by a.changed_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.forum_allowed_instruments() from public, anon;
revoke all on function public.forum_require_board_or_admin(text) from public, anon, authenticated;
revoke all on function public.forum_snapshot_members_raw() from public, anon, authenticated;
revoke all on function public.set_forum_member_instrument(text, text) from public, anon;
revoke all on function public.list_forum_instrument_mappings() from public, anon;
revoke all on function public.change_forum_instrument_mapping(text, text, text) from public, anon;
revoke all on function public.list_forum_instrument_audit(integer) from public, anon;

grant execute on function public.set_forum_member_instrument(text, text) to authenticated;
grant execute on function public.list_forum_instrument_mappings() to authenticated;
grant execute on function public.change_forum_instrument_mapping(text, text, text) to authenticated;
grant execute on function public.list_forum_instrument_audit(integer) to authenticated;
