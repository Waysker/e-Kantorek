-- Reclaim stale queue rows left in processing (for example after worker crash/timeout).
-- Keep function signature unchanged for RPC compatibility.

create or replace function public.claim_attendance_change_queue_items(
  max_items integer default 25
)
returns setof public.attendance_change_queue
language plpgsql
security definer
set search_path = public
as $$
declare
  effective_limit integer;
begin
  effective_limit := least(greatest(coalesce(max_items, 25), 1), 200);

  return query
  with picked as (
    select q.id
    from public.attendance_change_queue q
    where q.status = 'queued'
      or (
        q.status = 'processing'
        and q.claimed_at is not null
        and q.claimed_at <= now() - interval '15 minutes'
      )
    order by
      case when q.status = 'queued' then 0 else 1 end asc,
      q.enqueued_at asc,
      q.id asc
    for update skip locked
    limit effective_limit
  )
  update public.attendance_change_queue q
     set status = 'processing',
         claimed_at = now(),
         attempt_count = q.attempt_count + 1,
         last_error = case
           when q.status = 'processing'
             then coalesce(q.last_error || E'\n', '') || 'Reclaimed stale processing row.'
           else q.last_error
         end
    from picked
   where q.id = picked.id
  returning q.*;
end;
$$;

comment on function public.claim_attendance_change_queue_items(integer)
  is 'Claims queued rows and reclaims stale processing rows (>15m) using FOR UPDATE SKIP LOCKED.';

