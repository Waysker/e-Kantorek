-- Allow bonus attendance points above 1.0 (e.g. 2.0), while still keeping sane limits.
alter table public.attendance_entries
  drop constraint if exists attendance_entries_attendance_ratio_check;

alter table public.attendance_entries
  add constraint attendance_entries_attendance_ratio_check
  check (attendance_ratio >= 0 and attendance_ratio <= 4);

alter table public.attendance_change_queue
  drop constraint if exists attendance_change_queue_attendance_ratio_check;

alter table public.attendance_change_queue
  add constraint attendance_change_queue_attendance_ratio_check
  check (attendance_ratio >= 0 and attendance_ratio <= 4);
