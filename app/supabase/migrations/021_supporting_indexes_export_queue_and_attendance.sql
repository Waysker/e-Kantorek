-- Supporting indexes for cleanup phase:
-- - faster event-centric attendance reads
-- - faster sheet_member_rows lookups for DB->Sheet export
-- - faster stale processing reclaim scans

create index if not exists idx_attendance_entries_event_member
  on public.attendance_entries (event_id, member_id);

create index if not exists idx_sheet_member_rows_source_sheet_gid_member
  on public.sheet_member_rows (source_sheet_id, source_gid, member_id);

create index if not exists idx_sheet_member_rows_source_sheet_recency
  on public.sheet_member_rows (source_sheet_id, source_updated_at desc, updated_at desc);

create index if not exists idx_attendance_change_queue_processing_claimed
  on public.attendance_change_queue (claimed_at, id)
  where status = 'processing';
