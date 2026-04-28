-- Security hardening:
-- 1) do not trust user-editable metadata for profile role assignment,
-- 2) restrict privileged RPC functions to service_role.

create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parsed_first_name text;
  parsed_last_name text;
  parsed_instrument text;
  parsed_role text;
begin
  parsed_first_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'firstName'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'first_name'), '')
  );
  parsed_last_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'lastName'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'last_name'), '')
  );
  parsed_instrument := public.canonicalize_instrument_label(
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'instrument'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'primaryInstrument'), '')
    )
  );
  -- Role comes only from app metadata (admin-controlled) or defaults to member.
  parsed_role := public.normalize_profile_role(
    coalesce(
      nullif(trim(new.raw_app_meta_data ->> 'role'), ''),
      'member'
    )
  );

  if parsed_first_name is null or parsed_last_name is null or parsed_instrument is null then
    raise exception 'Missing required user metadata: firstName, lastName, instrument.';
  end if;

  insert into public.profiles (id, first_name, last_name, full_name, instrument, role)
  values (
    new.id,
    parsed_first_name,
    parsed_last_name,
    trim(parsed_first_name || ' ' || parsed_last_name),
    parsed_instrument::public.oragh_instrument,
    parsed_role
  )
  on conflict (id) do update
    set first_name = excluded.first_name,
        last_name = excluded.last_name,
        full_name = excluded.full_name,
        instrument = excluded.instrument,
        updated_at = now();

  return new;
end;
$$;

revoke execute on function public.schedule_sheet_to_supabase_sync(text, text, text, text) from public;
revoke execute on function public.unschedule_sheet_to_supabase_sync(text) from public;
revoke execute on function public.claim_attendance_change_queue_items(integer) from public;
revoke execute on function public.schedule_attendance_write_sheet_first_worker(text, text, text, text) from public;
revoke execute on function public.unschedule_attendance_write_sheet_first_worker(text) from public;

grant execute on function public.schedule_sheet_to_supabase_sync(text, text, text, text) to service_role;
grant execute on function public.unschedule_sheet_to_supabase_sync(text) to service_role;
grant execute on function public.claim_attendance_change_queue_items(integer) to service_role;
grant execute on function public.schedule_attendance_write_sheet_first_worker(text, text, text, text) to service_role;
grant execute on function public.unschedule_attendance_write_sheet_first_worker(text) to service_role;

