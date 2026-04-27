create or replace function public.prevent_client_profile_role_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and new.role is distinct from old.role
     and coalesce(current_setting('app.bypass_profile_role_guard', true), '') <> '1'
     and coalesce(auth.role(), 'service_role') <> 'service_role' then
    raise exception 'Only service role can change profile role.';
  end if;

  return new;
end;
$$;

create or replace function public.list_profiles_for_role_admin()
returns table (
  id uuid,
  first_name text,
  last_name text,
  full_name text,
  instrument text,
  role text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
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

  select p.role
    into caller_role
  from public.profiles p
  where p.id = caller_id;

  if caller_role is distinct from 'admin' then
    raise exception 'Only admin can list profiles.';
  end if;

  return query
  select
    p.id,
    p.first_name,
    p.last_name,
    p.full_name,
    p.instrument::text,
    p.role,
    p.created_at,
    p.updated_at
  from public.profiles p
  order by lower(p.full_name), p.id;
end;
$$;

create or replace function public.admin_set_profile_role(
  p_target_profile_id uuid,
  p_next_role text
)
returns table (
  id uuid,
  full_name text,
  role text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid;
  caller_role text;
  normalized_role text;
  previous_role text;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'Unauthorized.';
  end if;

  select p.role
    into caller_role
  from public.profiles p
  where p.id = caller_id;

  if caller_role is distinct from 'admin' then
    raise exception 'Only admin can update roles.';
  end if;

  if p_target_profile_id is null then
    raise exception 'Target profile id is required.';
  end if;

  normalized_role := lower(trim(coalesce(p_next_role, '')));
  if normalized_role not in ('member', 'leader', 'admin') then
    raise exception 'Invalid role. Allowed values: member, leader, admin.';
  end if;

  if caller_id = p_target_profile_id and normalized_role <> 'admin' then
    raise exception 'Admin cannot demote self via this endpoint.';
  end if;

  select p.role
    into previous_role
  from public.profiles p
  where p.id = p_target_profile_id;

  if previous_role is null then
    raise exception 'Target profile not found.';
  end if;

  if previous_role is distinct from normalized_role then
    perform set_config('app.bypass_profile_role_guard', '1', true);

    update public.profiles
    set role = normalized_role,
        updated_at = now()
    where profiles.id = p_target_profile_id;

    insert into public.change_journal (entity_type, entity_id, action, actor, payload)
    values (
      'profile',
      p_target_profile_id::text,
      'role_changed',
      caller_id::text,
      jsonb_build_object(
        'previous_role', previous_role,
        'next_role', normalized_role
      )
    );
  end if;

  return query
  select
    p.id,
    p.full_name,
    p.role,
    p.updated_at
  from public.profiles p
  where p.id = p_target_profile_id;
end;
$$;

revoke all on function public.list_profiles_for_role_admin() from public;
grant execute on function public.list_profiles_for_role_admin() to authenticated;
grant execute on function public.list_profiles_for_role_admin() to service_role;

revoke all on function public.admin_set_profile_role(uuid, text) from public;
grant execute on function public.admin_set_profile_role(uuid, text) to authenticated;
grant execute on function public.admin_set_profile_role(uuid, text) to service_role;
