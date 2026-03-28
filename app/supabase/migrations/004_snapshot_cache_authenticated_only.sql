drop policy if exists "Allow anon read snapshot cache" on public.forum_snapshot_cache;
drop policy if exists "Allow authenticated read snapshot cache" on public.forum_snapshot_cache;

create policy "Allow authenticated read snapshot cache"
on public.forum_snapshot_cache
for select
to authenticated
using (true);
