create table if not exists public.forum_snapshot_cache (
  snapshot_key text primary key,
  payload jsonb not null,
  generated_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create or replace function public.touch_forum_snapshot_cache_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_forum_snapshot_cache_updated_at on public.forum_snapshot_cache;
create trigger trg_forum_snapshot_cache_updated_at
before update on public.forum_snapshot_cache
for each row
execute function public.touch_forum_snapshot_cache_updated_at();

alter table public.forum_snapshot_cache enable row level security;

drop policy if exists "Allow authenticated read snapshot cache" on public.forum_snapshot_cache;
create policy "Allow authenticated read snapshot cache"
on public.forum_snapshot_cache
for select
to authenticated
using (true);

