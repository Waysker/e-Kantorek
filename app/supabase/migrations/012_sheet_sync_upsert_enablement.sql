grant all on table public.members to service_role;
grant all on table public.events to service_role;
grant all on table public.attendance_entries to service_role;
grant all on table public.sync_runs to service_role;
grant all on table public.sync_issues to service_role;
grant all on table public.change_journal to service_role;

grant usage, select on all sequences in schema public to service_role;

create or replace function public.schedule_sheet_to_supabase_sync(
  function_url text,
  bearer_token text,
  cron_expression text default '*/5 * * * *',
  job_name text default 'sheet_to_supabase_sync_5m'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_job_id bigint;
  new_job_id bigint;
  command_sql text;
begin
  if function_url is null or char_length(trim(function_url)) = 0 then
    raise exception 'function_url is required';
  end if;

  if bearer_token is null or char_length(trim(bearer_token)) = 0 then
    raise exception 'bearer_token is required';
  end if;

  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'pg_cron is not enabled. Enable the extension before scheduling.';
  end if;

  if not exists (
    select 1
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'net'
      and pg_proc.proname = 'http_post'
  ) then
    raise exception 'pg_net is not enabled. Enable the extension before scheduling.';
  end if;

  for existing_job_id in
    select jobid
    from cron.job
    where jobname = schedule_sheet_to_supabase_sync.job_name
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  command_sql := format(
    $sql$
    select net.http_post(
      url := %L,
      headers := %L::jsonb,
      body := %L::jsonb,
      timeout_milliseconds := 300000
    );
    $sql$,
    function_url,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || bearer_token
    )::text,
    jsonb_build_object(
      'trigger', 'cron',
      'job_name', job_name,
      'dryRun', false
    )::text
  );

  select cron.schedule(job_name, cron_expression, command_sql)
    into new_job_id;

  return new_job_id;
end;
$$;

comment on function public.schedule_sheet_to_supabase_sync(text, text, text, text)
  is 'Schedules Edge Function sheet_to_supabase_sync with pg_cron + pg_net.';
