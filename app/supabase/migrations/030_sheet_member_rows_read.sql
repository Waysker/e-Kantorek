-- Let signed-in members read which sheet rows (and so which season's workbook)
-- each member appears in. The attendance entry panel uses it to list only people
-- from the current original sheet, so last season's members are not offered.
-- Writes stay server-side (sheet_to_supabase_sync, service role).

alter table public.sheet_member_rows enable row level security;

drop policy if exists "Allow authenticated read sheet member rows" on public.sheet_member_rows;
create policy "Allow authenticated read sheet member rows"
on public.sheet_member_rows
for select
to authenticated
using (true);

grant select on public.sheet_member_rows to authenticated;
