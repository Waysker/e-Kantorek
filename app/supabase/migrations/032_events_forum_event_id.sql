-- The board's entry panel lists events from the forum (plus Tuesday/Thursday
-- rehearsals), so the forum is the one source of which events exist
-- (docs/reference/attendance-model.md, step 6). forum_event_id links a row in
-- events to its forum thread ("forum-event-<tid>").
--
-- Set by attendance_write_sheet_first on the first save for a forum event: on the
-- original-sheet event with a matching date and title, or on a new event when the
-- sheet has none. sheet_to_supabase_sync upserts only its own columns, so the link
-- survives syncs. Readable by every signed-in member like the rest of events.

alter table public.events
  add column if not exists forum_event_id text;

create unique index if not exists uniq_events_forum_event_id
  on public.events (forum_event_id)
  where forum_event_id is not null;
