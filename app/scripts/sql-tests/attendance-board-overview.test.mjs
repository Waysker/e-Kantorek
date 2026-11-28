// Runs migrations 010, 013 and 031 on PGlite and checks attendance_board_overview:
// board/admin only, sheet links, recent saves with the copy-sheet export result.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);
const migration = (name) => readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");

const ADMIN = "00000000-0000-0000-0000-000000000001";
const SECTION = "00000000-0000-0000-0000-000000000002";

let db;

async function as(uid, sql, params = []) {
  await db.exec("set role authenticated");
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}

async function overview(uid) {
  const { rows } = await as(uid, "select public.attendance_board_overview(10) as o");
  return rows[0].o;
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls; -- as in Supabase
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, full_name text, role text);
  `);
  await db.exec(migration("010_attendance_sync_foundation.sql").replace(/create extension[^;]*;/i, ""));
  await db.exec(migration("013_attendance_sheet_first_write_path.sql"));
  await db.exec(migration("031_attendance_board_overview.sql"));
  await db.exec(`
    insert into profiles values ('${ADMIN}', 'Wojciech Stańczak', 'admin'), ('${SECTION}', 'Szef Sekcji', 'section');
    insert into events (event_id, title, event_date, source_sheet_id) values
      ('evt-2025-12-02-proba', 'Próba', '2025-12-02', 'sheet-2025'),
      ('evt-2026-11-27-barborka-pbi', 'Barbórka PBI', '2026-11-27', 'sheet-2026'),
      ('evt-2026-12-01-proba', 'Próba', '2026-12-01', 'sheet-2026');
    insert into change_journal (entity_type, entity_id, action, actor, payload, created_at) values
      ('app_attendance_entries', 'evt-2026-11-27-barborka-pbi', 'attendance_write_db_applied_batch', 'profile:${ADMIN}',
       '{"changed_members_count": 2, "export_trigger": {"triggered": true, "ok": true, "missing_rows_count": 1}}', now() - interval '2 hours'),
      ('app_attendance_entries', 'evt-2026-12-01-proba', 'attendance_write_db_applied_batch', 'profile:${ADMIN}',
       '{"changed_members_count": 5, "export_trigger": {"triggered": true, "ok": false, "message": "boom"}}', now() - interval '1 hour'),
      ('app_attendance_entries', 'evt-2025-12-02-proba', 'attendance_write_db_applied_batch', 'profile:${ADMIN}',
       '{"changed_members_count": 1}', now() - interval '3 hours'),
      ('app_attendance_entries', 'evt-2026-12-01-proba:m1', 'manual_delete', 'owner:orbit-sql', '{}', now()),
      ('attendance_entries', 'x', 'attendance_write_db_applied_batch', 'profile:${ADMIN}', '{}', now());
  `);
});

after(async () => {
  await db?.close();
});

describe("attendance_board_overview", () => {
  it("refuses callers outside board/admin", async () => {
    await assert.rejects(as(SECTION, "select public.attendance_board_overview(10)"), /Only board or admin/);
    await assert.rejects(as(null, "select public.attendance_board_overview(10)"), /Unauthorized/);
  });

  it("links the current season's original and no copy until it is configured", async () => {
    const o = await overview(ADMIN);
    assert.equal(o.original_sheet_id, "sheet-2026");
    assert.equal(o.copy_sheet_id, null);
  });

  it("returns the copy sheet id once set", async () => {
    await db.exec("insert into attendance_settings (key, value) values ('copy_sheet_id', 'copy-2026')");
    assert.equal((await overview(ADMIN)).copy_sheet_id, "copy-2026");
  });

  it("lists only panel saves, newest first, with who saved and the export result", async () => {
    const saves = (await overview(ADMIN)).recent_saves;
    assert.deepEqual(
      saves.map((s) => [s.event_title, s.changed_count, s.saved_by, s.export_triggered, s.export_ok, s.export_missing_rows]),
      [
        ["Próba", 5, "Wojciech Stańczak", true, false, null],
        ["Barbórka PBI", 2, "Wojciech Stańczak", true, true, 1],
        ["Próba", 1, "Wojciech Stańczak", null, null, null],
      ],
    );
  });

  it("keeps the settings table closed to clients", async () => {
    await assert.rejects(as(ADMIN, "select * from attendance_settings"), /permission denied/);
  });
});
