// Runs migrations 010, 013, 029 and 030 on an in-process Postgres (PGlite) and checks that
// app-entered attendance (app_attendance_entries) is readable by every signed-in
// member, writable only server-side, and kept apart from attendance_entries
// (the original sheet). See docs/reference/attendance-model.md.
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

const BOARD = "00000000-0000-0000-0000-000000000001";

let db;

async function as(role, sql) {
  await db.exec(`set role ${role}`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role");
  }
}

async function errorOf(role, sql) {
  try {
    await as(role, sql);
  } catch (error) {
    return error.message;
  }
  return null;
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls; -- as in Supabase
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create table public.profiles (id uuid primary key, full_name text, role text);
  `);
  // PGlite ships without pgcrypto; gen_random_uuid() is built in since Postgres 13.
  await db.exec(migration("010_attendance_sync_foundation.sql").replace(/create extension[^;]*;/i, ""));
  await db.exec(migration("013_attendance_sheet_first_write_path.sql"));
  await db.exec(migration("029_app_attendance_entries.sql"));
  await db.exec(migration("030_sheet_member_rows_read.sql"));
  await db.exec(`
    insert into profiles values ('${BOARD}', 'Zarząd', 'board');
    insert into members (member_id, first_name, last_name, full_name, instrument)
      values ('m1', 'Ala', 'Flet', 'Ala Flet', 'Flety'), ('m2', 'Ola', 'Klarnet', 'Ola Klarnet', 'Klarnety');
    insert into events (event_id, title, event_date)
      values ('evt-2026-12-01-proba', 'Próba', '2026-12-01'), ('evt-2026-12-03-gwarek', 'Gwarek', '2026-12-03');
  `);
});

after(async () => {
  await db?.close();
});

describe("app_attendance_entries", () => {
  it("stores app entries without touching the original-sheet table", async () => {
    await db.exec(`
      insert into attendance_entries (member_id, event_id, attendance_ratio) values ('m1', 'evt-2026-12-01-proba', 1);
      insert into app_attendance_entries (member_id, event_id, attendance_ratio, recorded_by_profile_id, source)
        values ('m1', 'evt-2026-12-01-proba', 0.5, '${BOARD}', 'manager_panel');
    `);
    const sheet = await db.query("select attendance_ratio::float8 as r from attendance_entries where member_id = 'm1'");
    const app = await db.query("select attendance_ratio::float8 as r, source from app_attendance_entries where member_id = 'm1'");
    assert.deepEqual(sheet.rows, [{ r: 1 }]);
    assert.deepEqual(app.rows, [{ r: 0.5, source: "manager_panel" }]);
  });

  it("lets every signed-in member read app entries", async () => {
    const { rows } = await as("authenticated", "select member_id from app_attendance_entries");
    assert.deepEqual(rows, [{ member_id: "m1" }]);
  });

  it("refuses writes from app clients and anonymous users", async () => {
    for (const sql of [
      "insert into app_attendance_entries (member_id, event_id, attendance_ratio) values ('m2', 'evt-2026-12-01-proba', 1)",
      "update app_attendance_entries set attendance_ratio = 0",
      "delete from app_attendance_entries",
    ]) {
      assert.match(await errorOf("authenticated", sql), /permission denied/);
    }
    assert.match(await errorOf("anon", "select * from app_attendance_entries"), /permission denied/);
  });

  it("allows the server role to upsert", async () => {
    await as(
      "service_role",
      `insert into app_attendance_entries (member_id, event_id, attendance_ratio)
         values ('m1', 'evt-2026-12-01-proba', 0.75)
       on conflict (member_id, event_id) do update set attendance_ratio = excluded.attendance_ratio`,
    );
    const { rows } = await db.query("select attendance_ratio::float8 as r from app_attendance_entries where member_id = 'm1'");
    assert.deepEqual(rows, [{ r: 0.75 }]);
  });

  it("accepts bonus points up to 4 and rejects values outside 0..4", async () => {
    await db.exec("insert into app_attendance_entries (member_id, event_id, attendance_ratio) values ('m2', 'evt-2026-12-03-gwarek', 2)");
    await assert.rejects(
      db.exec("insert into app_attendance_entries (member_id, event_id, attendance_ratio) values ('m2', 'evt-2026-12-01-proba', 4.5)"),
      /check constraint/,
    );
  });

  it("touches updated_at on change", async () => {
    await db.exec("update app_attendance_entries set updated_at = now() - interval '1 day' where member_id = 'm2'");
    await db.exec("update app_attendance_entries set attendance_ratio = 1 where member_id = 'm2'");
    const { rows } = await db.query(
      "select updated_at > now() - interval '1 minute' as fresh from app_attendance_entries where member_id = 'm2'",
    );
    assert.deepEqual(rows, [{ fresh: true }]);
  });

  it("drops app entries together with their event", async () => {
    await db.exec("delete from events where event_id = 'evt-2026-12-03-gwarek'");
    const { rows } = await db.query("select count(*)::int as n from app_attendance_entries where event_id = 'evt-2026-12-03-gwarek'");
    assert.deepEqual(rows, [{ n: 0 }]);
  });
});

describe("sheet_member_rows (030)", () => {
  it("lets signed-in members read rows but not change them", async () => {
    await db.exec(`insert into sheet_member_rows (member_id, source_sheet_id, source_gid, source_row_number)
      values ('m1', 'sheet-2026', '70324873', 2), ('m2', 'sheet-2025', '70324873', 2)`);
    const { rows } = await as(
      "authenticated",
      "select member_id from sheet_member_rows where source_sheet_id = 'sheet-2026'",
    );
    assert.deepEqual(rows, [{ member_id: "m1" }]);
    // In Supabase the default grant lets the update run and RLS filters every row;
    // here it is refused outright. Either way nothing changes.
    await errorOf("authenticated", "update sheet_member_rows set source_row_number = 9");
    const { rows: unchanged } = await db.query("select count(*)::int as n from sheet_member_rows where source_row_number = 9");
    assert.deepEqual(unchanged, [{ n: 0 }]);
  });
});
