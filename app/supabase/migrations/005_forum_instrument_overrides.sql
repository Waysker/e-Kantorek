create table if not exists public.forum_instrument_overrides (
  overrides_key text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint forum_instrument_overrides_payload_shape check (
    jsonb_typeof(payload) = 'object'
    and jsonb_typeof(coalesce(payload -> 'byUid', '{}'::jsonb)) = 'object'
    and jsonb_typeof(coalesce(payload -> 'byFullName', '{}'::jsonb)) = 'object'
    and jsonb_typeof(coalesce(payload -> 'byUsername', '{}'::jsonb)) = 'object'
  )
);

create or replace function public.touch_forum_instrument_overrides_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_forum_instrument_overrides_updated_at on public.forum_instrument_overrides;
create trigger trg_forum_instrument_overrides_updated_at
before update on public.forum_instrument_overrides
for each row
execute function public.touch_forum_instrument_overrides_updated_at();

alter table public.forum_instrument_overrides enable row level security;

drop policy if exists "Allow authenticated read forum instrument overrides" on public.forum_instrument_overrides;
create policy "Allow authenticated read forum instrument overrides"
on public.forum_instrument_overrides
for select
to authenticated
using (true);

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
