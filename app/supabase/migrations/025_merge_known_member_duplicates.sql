-- Merge known duplicate member identities caused by historic sheet typos
-- and singular/plural instrument slugs.
--
-- Scope: only explicitly listed pairs.
-- Strategy:
-- 1) move dependent rows to canonical member_id
-- 2) preserve queue intent history on open-pair conflicts (dead_letter)
-- 3) remove old member rows when safe

create temporary table tmp_member_merge_map (
  old_member_id text primary key,
  keep_member_id text not null
) on commit drop;

insert into tmp_member_merge_map (old_member_id, keep_member_id)
values
  ('member-krymer-jacek-fagot', 'member-krymer-jacek-fagoty'),
  ('member-plata-franciszek-tuba', 'member-plata-franciszek-tuby'),
  ('member-gorszczak-krzysztof-tuba', 'member-gorszczak-krzysztof-tuby'),
  ('member-mazur-mateusz-tuba', 'member-mazur-mateusz-tuby'),
  ('member-pohlamnn-dawid-saksofony', 'member-pohlmann-dawid-saksofony'),
  ('member-tonods-weronika-gitary', 'member-tondos-weronika-gitary'),
  ('member-iganciuk-zuzanna-trabki', 'member-ignaciuk-zuzanna-trabki');

-- Remove invalid/self mappings and pairs missing in current DB.
delete from tmp_member_merge_map
where old_member_id = keep_member_id;

delete from tmp_member_merge_map map
where not exists (
    select 1 from public.members m where m.member_id = map.old_member_id
  )
  or not exists (
    select 1 from public.members m where m.member_id = map.keep_member_id
  );

-- If both old and keep member already have profile links, keep mapping out of scope
-- to avoid forcing two profiles onto one member_id.
create temporary table tmp_member_merge_blocked_profile_conflict (
  old_member_id text primary key,
  keep_member_id text not null
) on commit drop;

insert into tmp_member_merge_blocked_profile_conflict (old_member_id, keep_member_id)
select map.old_member_id, map.keep_member_id
from tmp_member_merge_map map
where exists (
    select 1 from public.profile_member_links pl where pl.member_id = map.old_member_id
  )
  and exists (
    select 1 from public.profile_member_links pl where pl.member_id = map.keep_member_id
  );

delete from tmp_member_merge_map map
using tmp_member_merge_blocked_profile_conflict blocked
where map.old_member_id = blocked.old_member_id;

-- Move profile links when canonical member has no profile link yet.
update public.profile_member_links pl
set
  member_id = map.keep_member_id,
  updated_at = now()
from tmp_member_merge_map map
where pl.member_id = map.old_member_id
  and not exists (
    select 1
    from public.profile_member_links existing
    where existing.member_id = map.keep_member_id
  );

-- Merge attendance rows.
insert into public.attendance_entries (
  member_id,
  event_id,
  attendance_ratio,
  source_raw_value,
  source_updated_at,
  created_at,
  updated_at
)
select
  map.keep_member_id,
  ae.event_id,
  ae.attendance_ratio,
  ae.source_raw_value,
  ae.source_updated_at,
  ae.created_at,
  ae.updated_at
from public.attendance_entries ae
join tmp_member_merge_map map on map.old_member_id = ae.member_id
on conflict (member_id, event_id) do update
set
  attendance_ratio = greatest(public.attendance_entries.attendance_ratio, excluded.attendance_ratio),
  source_raw_value = coalesce(excluded.source_raw_value, public.attendance_entries.source_raw_value),
  source_updated_at = greatest(
    coalesce(public.attendance_entries.source_updated_at, '-infinity'::timestamptz),
    coalesce(excluded.source_updated_at, '-infinity'::timestamptz)
  ),
  updated_at = greatest(public.attendance_entries.updated_at, excluded.updated_at);

delete from public.attendance_entries ae
using tmp_member_merge_map map
where ae.member_id = map.old_member_id;

-- Merge sheet row identity.
insert into public.sheet_member_rows (
  member_id,
  source_sheet_id,
  source_gid,
  source_row_number,
  source_updated_at,
  created_at,
  updated_at
)
select
  map.keep_member_id,
  smr.source_sheet_id,
  smr.source_gid,
  smr.source_row_number,
  smr.source_updated_at,
  smr.created_at,
  smr.updated_at
from public.sheet_member_rows smr
join tmp_member_merge_map map on map.old_member_id = smr.member_id
on conflict (member_id, source_sheet_id, source_gid) do update
set
  source_row_number = coalesce(excluded.source_row_number, public.sheet_member_rows.source_row_number),
  source_updated_at = greatest(
    coalesce(public.sheet_member_rows.source_updated_at, '-infinity'::timestamptz),
    coalesce(excluded.source_updated_at, '-infinity'::timestamptz)
  ),
  updated_at = greatest(public.sheet_member_rows.updated_at, excluded.updated_at);

delete from public.sheet_member_rows smr
using tmp_member_merge_map map
where smr.member_id = map.old_member_id;

-- Preserve unresolved open queue conflicts by dead-lettering them on canonical id.
update public.attendance_change_queue q
set
  status = 'dead_letter',
  member_id = map.keep_member_id,
  processed_at = coalesce(q.processed_at, now()),
  last_error = concat_ws(
    E'\n',
    nullif(q.last_error, ''),
    format(
      'member_merge_conflict_dead_letter: open queue row already exists for canonical member_id=%s event_id=%s (old_member_id=%s).',
      map.keep_member_id,
      q.event_id,
      map.old_member_id
    )
  )
from tmp_member_merge_map map
where q.member_id = map.old_member_id
  and q.status in ('queued', 'processing')
  and exists (
    select 1
    from public.attendance_change_queue existing_open
    where existing_open.member_id = map.keep_member_id
      and existing_open.event_id = q.event_id
      and existing_open.status in ('queued', 'processing')
      and existing_open.id <> q.id
  );

-- Move remaining queue rows to canonical member id.
update public.attendance_change_queue q
set member_id = map.keep_member_id
from tmp_member_merge_map map
where q.member_id = map.old_member_id;

-- Delete old member rows when no profile link still points to them.
delete from public.members m
using tmp_member_merge_map map
where m.member_id = map.old_member_id
  and not exists (
    select 1
    from public.profile_member_links pl
    where pl.member_id = m.member_id
  );
