-- Push notifications of the web app (Partytura → Patterns → Notifications).
-- The first kind: a new event on the forum.
--
-- push_subscriptions: one row per browser/device that said yes. Written only
--   through the RPCs below (the account comes from auth.uid(), never from the
--   client); the Edge Function push_new_events reads them with service_role
--   and deletes the ones the push service reports as gone.
-- push_forum_events_seen: every forum event the notifier has seen, so each one
--   is announced at most once (an event that drops out of a scrape and comes
--   back is not "new"). Filled with the current snapshot below, so the first
--   run does not announce events that already exist.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 2048),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth_secret text not null check (char_length(auth_secret) between 10 and 100),
  user_agent text check (char_length(user_agent) <= 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sent_at timestamptz,
  failure_count integer not null default 0
);

create index if not exists idx_push_subscriptions_profile
  on public.push_subscriptions (profile_id);

create table if not exists public.push_forum_events_seen (
  event_id text primary key,
  title text,
  starts_at timestamptz,
  first_seen_at timestamptz not null default now(),
  -- null: seen but not announced (already there at install, or already past)
  notified_at timestamptz,
  recipients integer,
  failures integer
);

alter table public.push_subscriptions enable row level security;
alter table public.push_forum_events_seen enable row level security;

revoke all on table public.push_subscriptions from public, anon, authenticated;
revoke all on table public.push_forum_events_seen from public, anon, authenticated;

-- A member sees only their own devices (Ja → Powiadomienia).
drop policy if exists "Members read own push subscriptions" on public.push_subscriptions;
create policy "Members read own push subscriptions"
on public.push_subscriptions
for select
to authenticated
using (auth.uid() = profile_id);

grant select (id, endpoint, created_at, last_sent_at) on public.push_subscriptions to authenticated;

-- Saves this browser's subscription for the signed-in account. The endpoint is
-- unique per browser: if another account signed in on the same browser before,
-- the subscription moves to the current one.
create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth_secret text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth_secret, user_agent)
  values (v_uid, trim(p_endpoint), trim(p_p256dh), trim(p_auth_secret), left(p_user_agent, 400))
  on conflict (endpoint) do update
    set profile_id = excluded.profile_id,
        p256dh = excluded.p256dh,
        auth_secret = excluded.auth_secret,
        user_agent = excluded.user_agent,
        updated_at = now(),
        failure_count = 0;
end;
$$;

-- Removes this browser's subscription ("Wyłącz", sign-out). Only the caller's own.
create or replace function public.unregister_push_subscription(p_endpoint text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  delete from public.push_subscriptions
  where endpoint = trim(p_endpoint)
    and profile_id = v_uid;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.unregister_push_subscription(text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.unregister_push_subscription(text) to authenticated;

-- Everything already on the forum counts as seen.
insert into public.push_forum_events_seen (event_id, title, starts_at)
select
  event ->> 'id',
  event ->> 'title',
  nullif(event ->> 'startsAt', '')::timestamptz
from public.forum_snapshot_cache cache,
  lateral jsonb_array_elements(
    case when jsonb_typeof(cache.payload -> 'events') = 'array' then cache.payload -> 'events' else '[]'::jsonb end
  ) as event
where cache.snapshot_key = 'forum'
  and coalesce(event ->> 'id', '') <> ''
on conflict (event_id) do nothing;

-- pg_cron + pg_net: calls push_new_events every few minutes (cheap when there
-- is nothing new). Same pattern as schedule_sheet_to_supabase_sync (011).
create or replace function public.schedule_push_new_events(
  function_url text,
  bearer_token text,
  cron_expression text default '*/5 * * * *',
  job_name text default 'push_new_events_5m'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_job_id bigint;
  new_job_id bigint;
begin
  if coalesce(trim(function_url), '') = '' or coalesce(trim(bearer_token), '') = '' then
    raise exception 'function_url and bearer_token are required';
  end if;
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'pg_cron is not enabled.';
  end if;

  for existing_job_id in
    select jobid from cron.job where jobname = schedule_push_new_events.job_name
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  select cron.schedule(
    job_name,
    cron_expression,
    format(
      $sql$select net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb, timeout_milliseconds := 60000);$sql$,
      function_url,
      jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || bearer_token)::text,
      jsonb_build_object('trigger', 'cron', 'job_name', job_name)::text
    )
  ) into new_job_id;

  return new_job_id;
end;
$$;

revoke all on function public.schedule_push_new_events(text, text, text, text) from public, anon, authenticated;
grant execute on function public.schedule_push_new_events(text, text, text, text) to service_role;
