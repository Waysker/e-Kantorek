# Forum instrument mapping

The forum does not expose which instrument a member plays, so every forum member
needs an entry in `forum_instrument_overrides` (key `forum`, payload
`{ byUid, byFullName, byUsername }`). Members without an entry land in the squad
group "Instrument not mapped yet".

## How a new member is handled

1. A new person registers on the forum and shows up in a concert poll.
2. The next forum sync (systemd timer on Orbit, every ~20 min) puts them in the
   "Instrument not mapped yet" group and writes
   `app/.cache/forum-sync/unmapped.json` (`/home/waysker/e-Kantorek-sync/app/.cache/forum-sync/unmapped.json`
   on Orbit). The sync log prints `WARNING: N forum member(s) have no instrument mapping`.
3. Alerts, so it cannot be missed:
   - ntfy push from `notify.sh unmapped` on the first sync that sees a new member,
     repeated every 24h (`UNMAPPED_REPEAT_HOURS`) while anyone is still unmapped.
   - In-app banner for `section`, `board` and `admin` roles, listing the names. Board/admin are
     pointed to the Instruments tab; section leaders (who cannot assign) are asked to tell the board
     which instrument the person plays. The banner lists all unmapped people, not only one
     section, because an unmapped member has no section yet.
4. Board/admin opens the **Instruments** tab (sub-tab "To assign"), picks an instrument for each
   person. The tab calls `set_forum_member_instrument`, which writes the entry to
   `byUid` (forum UID) or `byFullName` (when the member has no numeric UID).
5. The entry takes effect on the next sync (up to ~20 min). Until then the card shows
   "Saved, waiting for sync". Once the member is mapped, the banner and push stop.

## Fixing a mistake

Sub-tab **Mapped** lists every entry in `forum_instrument_overrides` (searchable by name, UID or
instrument). Tap an entry and pick another instrument; this calls
`change_forum_instrument_mapping`. Names come from the latest snapshot; entries for people who are
not in the current snapshot show as `UID <n>`. Entries cannot be deleted from the panel.
Sub-tab **History** shows the last 50 changes (who, when, old and new instrument).

Forum UID and full name are visible in the Instruments tab. The instrument is not
shown on forum profiles, so someone has to know it (ask the section leader).

## Allowed instruments

Flety, Oboje, Klarnety, Saksofony, Fagoty, Waltornie, Trąbki, Eufonia, Puzony,
Perkusja, Gitary, Tuby. The list is enforced in SQL (`set_forum_member_instrument`)
and offered in the UI (`CANONICAL_INSTRUMENT_OPTIONS` in `app/src/domain/instruments.ts`).
Keep the two in sync when adding an instrument.

## Components

| Piece | Where |
| --- | --- |
| Detection + `unmapped.json` | `app/scripts/sync-forum-snapshot.mjs` (`collectUnmappedMembers`) |
| ntfy alert | `deploy/orbit/forum-sync/notify.sh` (`unmapped` mode), run by `ExecStartPost` in `ekantorek-forum-sync.service`; state in `/var/lib/ekantorek-forum-sync/unmapped_state.json` |
| In-app banner | `app/src/ui/UnmappedMembersBanner.tsx`, `app/src/domain/unmappedMembers.ts` |
| Mapping panel | `app/src/screens/InstrumentMappingScreen.tsx` (tab `instruments`, route `instrumentMapping`) |
| SQL | `app/supabase/migrations/027_forum_instrument_mapping_rpc.sql` (list + assign), `028_forum_instrument_mapping_edit_audit.sql` (edit + audit trail) |
| Tests | `app/scripts/sql-tests/forum-instrument-mapping.test.mjs` (RPCs on in-process Postgres/PGlite) and `app/scripts/lib/overrides-merge.test.mjs`; run `npm test` in `app/`, also in CI (`CI Tests`) |

The RPCs are `security definer` and check `profiles.role in ('board', 'admin')`:

- `list_unmapped_forum_members()` reads the latest `forum_snapshot_cache` payload,
  returns unmapped members and any already-saved `pending_instrument`.
- `set_forum_member_instrument(p_member_id, p_instrument)` only accepts a member that the
  snapshot currently shows as unmapped and an instrument from the allowed list.
- `list_forum_instrument_mappings()` lists all saved entries with member names.
- `change_forum_instrument_mapping(p_bucket, p_key, p_instrument)` changes an existing entry only.
- `list_forum_instrument_audit(p_limit)` returns the history (max 200 rows).
- `forum_unmapped_members_raw()`, `forum_snapshot_members_raw()` and `forum_require_board_or_admin()`
  are internal helpers, not callable by clients.

Every write through `set_forum_member_instrument` and `change_forum_instrument_mapping` adds a row to
`forum_instrument_mapping_audit` (`action` = `assign` or `change`). The table has RLS enabled with no
policies and no grants, so clients can only read it through `list_forum_instrument_audit`. Changes made
outside the panel (SQL fallback, scripts, the older direct-write RLS policies for board/admin) are not audited.

## Manual fallback (SQL on Orbit)

If the panel is unavailable, add the entry directly. Supabase runs on Orbit (not Cloud);
`sudo` needs a password there:

```bash
sudo docker exec -i supabase-db psql -U postgres -d postgres <<'SQL'
update public.forum_instrument_overrides
set payload = jsonb_set(payload, '{byUid}',
  coalesce(payload->'byUid', '{}'::jsonb) || '{"902": "Flety"}'::jsonb)
where overrides_key = 'forum';
SQL
```

Then optionally run `sudo systemctl start ekantorek-forum-sync` instead of waiting for the timer.

## Pitfalls

- `app/scripts/publish-instrument-overrides-to-supabase.mjs` rebuilds overrides from the
  attendance workbook (`byFullName` only, `byUid` empty). It skips when the row already exists.
  With `FORUM_SYNC_FORCE_OVERRIDE_PUBLISH=1` it **merges** into the existing row: entries added
  through the panel stay, and on a conflict the workbook value wins. Before any write it saves the
  current payload to `app/.cache/forum-sync/overrides-backup-<key>-<timestamp>.json`.
  Only `FORUM_SYNC_OVERRIDE_REPLACE=1` (together with force) replaces the whole payload and drops
  entries that are not in the source; use it deliberately.
- The panel only lists members that appear in squads of events present in the current
  snapshot. A forum member who never voted in a concert poll is not listed and needs no mapping.
- The panel can assign and change entries but not delete them; use the SQL fallback to remove one
  (the member then shows up as unmapped again after the next sync).
- Board/admin can still write `forum_instrument_overrides` directly (RLS policies from migrations
  006/008). Such writes bypass the audit trail.
- `forum-sync.instrument-overrides.example.json` is only a template. The database table is
  what production sync reads.
