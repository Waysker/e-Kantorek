-- Harden event dedupe flow:
-- - keep queue intent history for open conflicts instead of dropping rows via cascade delete
-- - dead-letter unresolved open rows and re-point them to canonical event id
-- - then proceed with canonical merge/delete

-- Normalize source coordinates so dedupe/index logic treats empty strings as NULL.
update public.events
set
  source_sheet_id = nullif(btrim(source_sheet_id), ''),
  source_gid = nullif(btrim(source_gid), ''),
  source_column = nullif(upper(btrim(source_column)), '');

create temporary table tmp_event_source_dedupe_map (
  old_event_id text primary key,
  keep_event_id text not null
) on commit drop;

insert into tmp_event_source_dedupe_map (old_event_id, keep_event_id)
with ranked as (
  select
    e.event_id,
    first_value(e.event_id) over (
      partition by e.source_sheet_id, e.source_gid, e.source_column
      order by
        case when e.title ~* '(19|20)[0-9]{2}[./-][0-9]{1,2}([./-][0-9]{1,2})?' then 1 else 0 end asc,
        char_length(btrim(e.title)) asc,
        coalesce(e.source_updated_at, e.updated_at, e.created_at) desc,
        e.event_id asc
    ) as keep_event_id,
    row_number() over (
      partition by e.source_sheet_id, e.source_gid, e.source_column
      order by
        case when e.title ~* '(19|20)[0-9]{2}[./-][0-9]{1,2}([./-][0-9]{1,2})?' then 1 else 0 end asc,
        char_length(btrim(e.title)) asc,
        coalesce(e.source_updated_at, e.updated_at, e.created_at) desc,
        e.event_id asc
    ) as rn
  from public.events e
  where e.source_sheet_id is not null
    and e.source_gid is not null
    and e.source_column is not null
)
select
  event_id as old_event_id,
  keep_event_id
from ranked
where rn > 1;

-- Move attendance rows to canonical event ids.
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
  ae.member_id,
  map.keep_event_id,
  ae.attendance_ratio,
  ae.source_raw_value,
  ae.source_updated_at,
  ae.created_at,
  ae.updated_at
from public.attendance_entries ae
join tmp_event_source_dedupe_map map on map.old_event_id = ae.event_id
on conflict (member_id, event_id) do update
set
  attendance_ratio = excluded.attendance_ratio,
  source_raw_value = coalesce(excluded.source_raw_value, public.attendance_entries.source_raw_value),
  source_updated_at = greatest(
    coalesce(public.attendance_entries.source_updated_at, '-infinity'::timestamptz),
    coalesce(excluded.source_updated_at, '-infinity'::timestamptz)
  ),
  updated_at = greatest(public.attendance_entries.updated_at, excluded.updated_at);

delete from public.attendance_entries ae
using tmp_event_source_dedupe_map map
where ae.event_id = map.old_event_id;

-- Preserve unresolved open queue conflicts instead of losing them on cascade.
update public.attendance_change_queue q
set
  status = 'dead_letter',
  event_id = map.keep_event_id,
  processed_at = coalesce(q.processed_at, now()),
  last_error = concat_ws(
    E'\n',
    nullif(q.last_error, ''),
    format(
      'dedupe_conflict_dead_letter: open queue row already exists for member_id=%s on canonical event_id=%s (old_event_id=%s).',
      q.member_id,
      map.keep_event_id,
      map.old_event_id
    )
  )
from tmp_event_source_dedupe_map map
where q.event_id = map.old_event_id
  and q.status in ('queued', 'processing')
  and exists (
    select 1
    from public.attendance_change_queue existing_open
    where existing_open.member_id = q.member_id
      and existing_open.event_id = map.keep_event_id
      and existing_open.status in ('queued', 'processing')
      and existing_open.id <> q.id
  );

-- Move remaining queue rows to canonical event ids.
update public.attendance_change_queue q
set event_id = map.keep_event_id
from tmp_event_source_dedupe_map map
where q.event_id = map.old_event_id;

-- Remove duplicate event rows after dependent data has been preserved/moved.
delete from public.events e
using tmp_event_source_dedupe_map map
where e.event_id = map.old_event_id;

-- Keep source-cell identity unique for future imports.
create unique index if not exists uniq_events_source_cell
  on public.events (source_sheet_id, source_gid, source_column)
  where source_sheet_id is not null
    and source_gid is not null
    and source_column is not null;
