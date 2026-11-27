-- Attendance entered by the board in the app, kept apart from attendance read
-- from the original sheet (public.attendance_entries, written only by
-- sheet_to_supabase_sync). See docs/reference/attendance-model.md.
--
-- Written only by attendance_write_sheet_first (service role) in db_first mode;
-- exported to the copy sheet by supabase_to_sheet_export. Every signed-in
-- member may read it.

create table if not exists public.app_attendance_entries (
  member_id text not null references public.members(member_id) on delete cascade,
  event_id text not null references public.events(event_id) on delete cascade,
  attendance_ratio numeric(5, 4) not null
    check (attendance_ratio >= 0 and attendance_ratio <= 4),
  source_raw_value text,
  source text not null default 'app',
  recorded_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (member_id, event_id)
);

create index if not exists idx_app_attendance_entries_event
  on public.app_attendance_entries (event_id);

create index if not exists idx_app_attendance_entries_updated_at
  on public.app_attendance_entries (updated_at desc);

drop trigger if exists trg_app_attendance_entries_touch_updated_at on public.app_attendance_entries;
create trigger trg_app_attendance_entries_touch_updated_at
before update on public.app_attendance_entries
for each row
execute function public.touch_updated_at_column();

alter table public.app_attendance_entries enable row level security;

drop policy if exists "Allow authenticated read app attendance entries" on public.app_attendance_entries;
create policy "Allow authenticated read app attendance entries"
on public.app_attendance_entries
for select
to authenticated
using (true);

revoke all on public.app_attendance_entries from anon, authenticated;
grant select on public.app_attendance_entries to authenticated;
grant all on public.app_attendance_entries to service_role;
