// Runs migrations 001, 005 and 027 on an in-process Postgres (PGlite) with a
// minimal stand-in for Supabase's auth schema and checks the board-panel RPCs.
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

const USERS = {
  board: "00000000-0000-0000-0000-000000000001",
  member: "00000000-0000-0000-0000-000000000002",
  admin: "00000000-0000-0000-0000-000000000003",
};
const member = (id, fullName) => ({ id, fullName });
const UNMAPPED = "Instrument not mapped yet";

const SNAPSHOT = {
  eventDetailsById: {
    e1: {
      squad: {
        groups: [
          { instrument: "Flety", confirmedMembers: [member("forum-user-10", "Ala Flet")], maybeMembers: [] },
          {
            instrument: UNMAPPED,
            confirmedMembers: [member("forum-user-888", "Maja Osewska")],
            maybeMembers: [member("forum-username-jan-nowak", "Jan Nowak")],
          },
        ],
      },
    },
    e2: {
      squad: {
        groups: [
          {
            instrument: UNMAPPED,
            confirmedMembers: [member("forum-user-888", "Maja Osewska")],
            maybeMembers: [member("forum-user-889", "Karol Malik")],
          },
        ],
      },
    },
  },
};

let db;

async function as(uid, role, sql) {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role");
  }
}

async function errorOf(uid, role, sql) {
  try {
    await as(uid, role, sql);
  } catch (error) {
    return error.message;
  }
  return null;
}

async function overrides() {
  const { rows } = await db.query(
    "select payload from forum_instrument_overrides where overrides_key = 'forum'",
  );
  return rows[0]?.payload;
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, full_name text, role text);
  `);
  await db.exec(migration("001_forum_snapshot_cache.sql"));
  await db.exec(migration("005_forum_instrument_overrides.sql"));
  await db.exec(migration("027_forum_instrument_mapping_rpc.sql"));
  await db.exec(`insert into profiles values
    ('${USERS.board}', 'B', 'board'), ('${USERS.member}', 'M', 'member'), ('${USERS.admin}', 'A', 'admin')`);
  await db.query(
    "insert into forum_snapshot_cache (snapshot_key, payload, generated_at) values ('forum', $1, now())",
    [JSON.stringify(SNAPSHOT)],
  );
});

after(async () => {
  await db?.close();
});

describe("list_unmapped_forum_members", () => {
  it("returns each unmapped member once, with the forum uid when numeric", async () => {
    const { rows } = await as(USERS.board, "authenticated", "select * from list_unmapped_forum_members()");

    assert.deepEqual(
      rows.map((row) => row.member_id).sort(),
      ["forum-user-888", "forum-user-889", "forum-username-jan-nowak"],
    );
    assert.equal(rows.find((row) => row.member_id === "forum-user-888").forum_uid, "888");
    assert.equal(rows.find((row) => row.member_id === "forum-username-jan-nowak").forum_uid, null);
  });

  it("rejects members, anonymous callers and the anon role", async () => {
    assert.match(await errorOf(USERS.member, "authenticated", "select * from list_unmapped_forum_members()"), /Only board or admin/);
    assert.match(await errorOf(null, "authenticated", "select * from list_unmapped_forum_members()"), /Unauthorized/);
    assert.match(await errorOf(USERS.board, "anon", "select * from list_unmapped_forum_members()"), /permission denied/);
  });

  it("keeps the internal helper away from clients", async () => {
    assert.match(await errorOf(USERS.board, "authenticated", "select * from forum_unmapped_members_raw()"), /permission denied/);
  });
});

describe("set_forum_member_instrument", () => {
  it("rejects members and invalid input", async () => {
    assert.match(await errorOf(USERS.member, "authenticated", "select * from set_forum_member_instrument('forum-user-888','Flety')"), /Only board or admin/);
    assert.match(await errorOf(USERS.board, "authenticated", "select * from set_forum_member_instrument('forum-user-888','Kazoo')"), /Invalid instrument/);
    assert.match(await errorOf(USERS.board, "authenticated", "select * from set_forum_member_instrument('forum-user-10','Flety')"), /not currently unmapped/);
    assert.match(await errorOf(USERS.board, "authenticated", "select * from set_forum_member_instrument('forum-user-99999','Flety')"), /not currently unmapped/);
  });

  it("writes byUid for numeric uids and byFullName otherwise, keeping existing entries", async () => {
    await db.exec(`insert into forum_instrument_overrides (overrides_key, payload)
      values ('forum', '{"byUid":{"232":"Gitary"},"byFullName":{},"byUsername":{}}')
      on conflict (overrides_key) do update set payload = excluded.payload`);

    const byUid = await as(USERS.board, "authenticated", "select * from set_forum_member_instrument('forum-user-888','Oboje')");
    assert.deepEqual([byUid.rows[0].override_bucket, byUid.rows[0].override_key], ["byUid", "888"]);

    const byName = await as(USERS.admin, "authenticated", "select * from set_forum_member_instrument('forum-username-jan-nowak','Trąbki')");
    assert.deepEqual([byName.rows[0].override_bucket, byName.rows[0].override_key], ["byFullName", "Jan Nowak"]);

    assert.deepEqual(await overrides(), {
      byUid: { 232: "Gitary", 888: "Oboje" },
      byFullName: { "Jan Nowak": "Trąbki" },
      byUsername: {},
    });
  });

  it("reports saved entries as pending until the snapshot catches up", async () => {
    const { rows } = await as(USERS.board, "authenticated", "select member_id, pending_instrument from list_unmapped_forum_members()");
    const pending = Object.fromEntries(rows.map((row) => [row.member_id, row.pending_instrument]));

    assert.equal(pending["forum-user-888"], "Oboje");
    assert.equal(pending["forum-username-jan-nowak"], "Trąbki");
    assert.equal(pending["forum-user-889"], null);
  });

  it("lets a saved value be changed before the next sync", async () => {
    await as(USERS.board, "authenticated", "select * from set_forum_member_instrument('forum-user-888','Flety')");
    assert.equal((await overrides()).byUid["888"], "Flety");
  });

  it("creates the overrides row when it is missing", async () => {
    await db.exec("delete from forum_instrument_overrides");
    await as(USERS.board, "authenticated", "select * from set_forum_member_instrument('forum-user-888','Flety')");
    assert.deepEqual((await overrides()).byUid, { 888: "Flety" });
  });
});

describe("empty snapshot", () => {
  it("yields an empty list", async () => {
    await db.exec("update forum_snapshot_cache set payload = '{}'::jsonb");
    const { rows } = await as(USERS.board, "authenticated", "select * from list_unmapped_forum_members()");
    assert.equal(rows.length, 0);
  });
});
