-- Board panel support for checking app-entered attendance against the sheets
-- (docs/reference/attendance-model.md, step 7): links to the original and the
-- copy sheet, and the latest saves from the entry panel with the copy-sheet
-- export result.

-- Small key/value store for settings the server knows but the repo does not,
-- e.g. the copy sheet's id. Clients never read it directly.
create table if not exists public.attendance_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table public.attendance_settings enable row level security;
revoke all on public.attendance_settings from anon, authenticated;

create or replace function public.attendance_board_overview(p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller_id uuid;
  caller_role text;
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_original_sheet_id text;
  v_copy_sheet_id text;
  v_saves jsonb;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'Unauthorized.';
  end if;

  select p.role into caller_role from public.profiles p where p.id = caller_id;
  if caller_role is null or caller_role not in ('board', 'admin') then
    raise exception 'Only board or admin can read the attendance overview.';
  end if;

  -- The original of the current season: the workbook of the newest event read
  -- from a sheet (the same rule the entry panel uses for its people list).
  select e.source_sheet_id into v_original_sheet_id
  from public.events e
  where e.source_sheet_id is not null
  order by e.event_date desc
  limit 1;

  select s.value into v_copy_sheet_id
  from public.attendance_settings s
  where s.key = 'copy_sheet_id';

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.saved_at desc), '[]'::jsonb)
  into v_saves
  from (
    select
      j.created_at as saved_at,
      j.entity_id as event_id,
      e.title as event_title,
      e.event_date,
      coalesce((j.payload ->> 'changed_members_count')::integer, 0) as changed_count,
      coalesce(nullif(trim(p.full_name), ''), null) as saved_by,
      -- null: saved before the export result was recorded (unknown).
      (j.payload -> 'export_trigger' ->> 'triggered')::boolean as export_triggered,
      (j.payload -> 'export_trigger' ->> 'ok')::boolean as export_ok,
      (j.payload -> 'export_trigger' ->> 'missing_rows_count')::integer as export_missing_rows
    from public.change_journal j
    left join public.events e on e.event_id = j.entity_id
    left join public.profiles p
      on j.actor like 'profile:%'
     and p.id::text = substring(j.actor from 9)
    where j.entity_type = 'app_attendance_entries'
      and j.action = 'attendance_write_db_applied_batch'
    order by j.created_at desc
    limit v_limit
  ) x;

  return jsonb_build_object(
    'original_sheet_id', v_original_sheet_id,
    'copy_sheet_id', v_copy_sheet_id,
    'recent_saves', v_saves
  );
end;
$$;

revoke all on function public.attendance_board_overview(integer) from public, anon;
grant execute on function public.attendance_board_overview(integer) to authenticated;

create index if not exists idx_change_journal_app_attendance_saves
  on public.change_journal (created_at desc)
  where entity_type = 'app_attendance_entries' and action = 'attendance_write_db_applied_batch';
