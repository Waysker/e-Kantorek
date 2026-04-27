alter table public.change_journal enable row level security;

drop policy if exists "Allow service role manage change journal" on public.change_journal;
create policy "Allow service role manage change journal"
on public.change_journal
for all
to service_role
using (true)
with check (true);

revoke all on public.change_journal from anon;
revoke all on public.change_journal from authenticated;
grant all on public.change_journal to service_role;
