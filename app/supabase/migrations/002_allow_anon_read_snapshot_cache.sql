drop policy if exists "Allow authenticated read snapshot cache" on public.forum_snapshot_cache;

create policy "Allow anon read snapshot cache"
on public.forum_snapshot_cache
for select
to anon, authenticated
using (true);

