-- Make enqueue-batch write path atomic at DB level.
-- This prevents partial queue writes when one row in the batch fails.

create or replace function public.enqueue_attendance_change_batch(
  p_event_id text,
  p_requested_by_profile_id uuid,
  p_requested_by_label text,
  p_source text,
  p_source_sheet_id text,
  p_source_gid text,
  p_source_column text,
  p_changes jsonb
)
returns setof public.attendance_change_queue
language plpgsql
security definer
set search_path = public
as $$
declare
  processing_conflicts integer;
  invalid_member_ids integer;
begin
  if p_event_id is null or char_length(btrim(p_event_id)) = 0 then
    raise exception 'missing_event_id';
  end if;

  if p_requested_by_profile_id is null then
    raise exception 'missing_requested_by_profile_id';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'missing_changes';
  end if;

  with raw_changes as (
    select
      change_item.ordinality,
      nullif(btrim(change_item.change_json ->> 'member_id'), '') as member_id
    from jsonb_array_elements(p_changes) with ordinality as change_item(change_json, ordinality)
  )
  select count(*)
    into invalid_member_ids
  from raw_changes
  where member_id is null;

  if invalid_member_ids > 0 then
    raise exception 'invalid_batch_member_id';
  end if;

  with raw_changes as (
    select
      change_item.ordinality,
      nullif(btrim(change_item.change_json ->> 'member_id'), '') as member_id
    from jsonb_array_elements(p_changes) with ordinality as change_item(change_json, ordinality)
  ),
  deduped_changes as (
    select distinct on (member_id)
      member_id
    from raw_changes
    order by member_id, ordinality desc
  )
  select count(*)
    into processing_conflicts
  from public.attendance_change_queue q
  join deduped_changes c on c.member_id = q.member_id
  where q.event_id = p_event_id
    and q.status = 'processing';

  if processing_conflicts > 0 then
    raise exception 'attendance_change_already_processing';
  end if;

  return query
  with raw_changes as (
    select
      change_item.ordinality,
      nullif(btrim(change_item.change_json ->> 'member_id'), '') as member_id,
      (change_item.change_json ->> 'attendance_ratio')::numeric(5, 4) as attendance_ratio,
      nullif(btrim(change_item.change_json ->> 'requested_raw_value'), '') as requested_raw_value,
      nullif(btrim(change_item.change_json ->> 'request_note'), '') as request_note
    from jsonb_array_elements(p_changes) with ordinality as change_item(change_json, ordinality)
  ),
  deduped_changes as (
    select distinct on (member_id)
      member_id,
      attendance_ratio,
      requested_raw_value,
      request_note
    from raw_changes
    order by member_id, ordinality desc
  ),
  upserted as (
    insert into public.attendance_change_queue (
      status,
      member_id,
      event_id,
      attendance_ratio,
      requested_raw_value,
      requested_by_profile_id,
      requested_by_label,
      request_note,
      source,
      source_sheet_id,
      source_gid,
      source_column,
      source_row_number,
      last_error,
      processed_at,
      claimed_at,
      worker_run_id,
      applied_cell_ref,
      enqueued_at
    )
    select
      'queued',
      c.member_id,
      p_event_id,
      c.attendance_ratio,
      c.requested_raw_value,
      p_requested_by_profile_id,
      nullif(btrim(p_requested_by_label), ''),
      c.request_note,
      coalesce(nullif(btrim(p_source), ''), 'manager_panel'),
      nullif(btrim(p_source_sheet_id), ''),
      nullif(btrim(p_source_gid), ''),
      nullif(upper(btrim(p_source_column)), ''),
      null,
      null,
      null,
      null,
      null,
      null,
      now()
    from deduped_changes c
    on conflict (member_id, event_id)
      where status in ('queued', 'processing')
    do update
      set
        status = excluded.status,
        attendance_ratio = excluded.attendance_ratio,
        requested_raw_value = excluded.requested_raw_value,
        requested_by_profile_id = excluded.requested_by_profile_id,
        requested_by_label = excluded.requested_by_label,
        request_note = excluded.request_note,
        source = excluded.source,
        source_sheet_id = excluded.source_sheet_id,
        source_gid = excluded.source_gid,
        source_column = excluded.source_column,
        source_row_number = excluded.source_row_number,
        last_error = excluded.last_error,
        processed_at = excluded.processed_at,
        claimed_at = excluded.claimed_at,
        worker_run_id = excluded.worker_run_id,
        applied_cell_ref = excluded.applied_cell_ref,
        enqueued_at = excluded.enqueued_at
    returning public.attendance_change_queue.*
  )
  select *
  from upserted
  order by id asc;
end;
$$;

revoke execute on function public.enqueue_attendance_change_batch(
  text, uuid, text, text, text, text, text, jsonb
) from public;
grant execute on function public.enqueue_attendance_change_batch(
  text, uuid, text, text, text, text, text, jsonb
) to service_role;
