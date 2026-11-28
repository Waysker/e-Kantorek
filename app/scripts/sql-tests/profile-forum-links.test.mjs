// Runs migrations 001, 005, 027, 028 and 033 on an in-process Postgres (PGlite)
// with a minimal stand-in for Supabase's auth schema and checks linking app
// accounts to forum people.
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
  kasia: "00000000-0000-0000-0000-000000000002",
  anna: "00000000-0000-0000-0000-000000000003",
  intruder: "00000000-0000-0000-0000-000000000004",
  unconfirmed: "00000000-0000-0000-0000-000000000005",
  admin: "00000000-0000-0000-0000-000000000006",
};

const person = (uid, fullName, primaryInstrument) => ({ id: `forum-user-${uid}`, fullName, primaryInstrument });

const SNAPSHOT = {
  eventDetailsById: {
    e1: {
      attendanceGroups: [
        { status: "going", participants: [person(619, "Katarzyna Rech", "Saksofony"), person(700, "Anna Łęcka", "Flety")] },
        { status: "not_going", participants: [person(701, "Kacper Rutkowski", "Trąbki")] },
      ],
      squad: { groups: [{ instrument: "Saksofony", confirmedMembers: [{ id: "forum-user-619", fullName: "Katarzyna Rech" }], maybeMembers: [] }] },
    },
    e2: {
      attendanceGroups: [
        { status: "going", participants: [{ id: "forum-username-jan", fullName: "Jan Bez Uid", primaryInstrument: "Tuby" }] },
      ],
    },
  },
};

let db;

async function as(uid, role, sql, params) {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}

async function errorOf(uid, role, sql, params) {
  try {
    await as(uid, role, sql, params);
  } catch (error) {
    return error.message;
  }
  return null;
}

async function linkOf(profileId) {
  const { rows } = await db.query("select * from profile_forum_links where profile_id = $1", [profileId]);
  return rows[0] ?? null;
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table auth.users (id uuid primary key, email_confirmed_at timestamptz);
    create table public.profiles (
      id uuid primary key, first_name text, last_name text, full_name text, instrument text, role text,
      created_at timestamptz default now(), updated_at timestamptz default now()
    );
    grant usage on schema auth to authenticated;
  `);
  await db.exec(migration("001_forum_snapshot_cache.sql"));
  await db.exec(migration("005_forum_instrument_overrides.sql"));
  await db.exec(migration("027_forum_instrument_mapping_rpc.sql"));
  await db.exec(migration("028_forum_instrument_mapping_edit_audit.sql"));
  await db.exec(migration("033_profile_forum_links.sql"));
  await db.exec(`
    insert into auth.users values
      ('${USERS.board}', now()), ('${USERS.kasia}', now()), ('${USERS.anna}', now()),
      ('${USERS.intruder}', now()), ('${USERS.unconfirmed}', null), ('${USERS.admin}', now());
    insert into profiles (id, full_name, instrument, role) values
      ('${USERS.board}', 'Basia Zarząd', 'Klarnety', 'board'),
      ('${USERS.kasia}', 'Kasia Rech', 'Saksofony', 'member'),
      ('${USERS.anna}', 'Anna Łęcka', 'Flety', 'member'),
      ('${USERS.intruder}', 'Ktoś Inny', 'Tuby', 'member'),
      ('${USERS.unconfirmed}', 'Zuzanna Niepotwierdzona', 'Trąbki', 'member'),
      ('${USERS.admin}', 'Adam Admin', 'Tuby', 'admin');
  `);
  await db.query(
    "insert into forum_snapshot_cache (snapshot_key, payload, generated_at) values ('forum', $1, now())",
    [JSON.stringify(SNAPSHOT)],
  );
});

after(async () => {
  await db?.close();
});

describe("resolve_my_forum_identity", () => {
  it("links an exact name and section match as proposed (diacritics folded)", async () => {
    const { rows } = await as(USERS.anna, "authenticated", "select * from resolve_my_forum_identity()");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].forum_uid, "700");
    assert.equal(rows[0].status, "proposed");
    assert.equal(rows[0].method, "auto_exact");
  });

  it("does not guess when the first name differs", async () => {
    const { rows } = await as(USERS.kasia, "authenticated", "select * from resolve_my_forum_identity()");
    assert.equal(rows.length, 0);
    assert.equal(await linkOf(USERS.kasia), null);
  });

  it("rejects anonymous callers", async () => {
    assert.match(await errorOf(null, "authenticated", "select * from resolve_my_forum_identity()"), /Unauthorized/);
    assert.match(await errorOf(USERS.kasia, "anon", "select * from resolve_my_forum_identity()"), /permission denied/);
  });
});

describe("list_forum_identity_candidates", () => {
  it("lists forum people with numeric uids only and marks people linked to others", async () => {
    const { rows } = await as(USERS.kasia, "authenticated", "select * from list_forum_identity_candidates()");
    assert.deepEqual(rows.map((row) => row.forum_uid).sort(), ["619", "700", "701"]);
    assert.equal(rows.find((row) => row.forum_uid === "700").taken, true);
    assert.equal(rows.find((row) => row.forum_uid === "619").instrument, "Saksofony");
  });
});

describe("claim_my_forum_identity", () => {
  it("lets a member pick themself, as proposed", async () => {
    await as(USERS.kasia, "authenticated", "select claim_my_forum_identity('619')");
    const link = await linkOf(USERS.kasia);
    assert.equal(link.forum_uid, "619");
    assert.equal(link.forum_full_name, "Katarzyna Rech");
    assert.equal(link.status, "proposed");
    assert.equal(link.method, "self");
  });

  it("refuses a forum person linked to another account", async () => {
    assert.match(
      await errorOf(USERS.intruder, "authenticated", "select claim_my_forum_identity('619')"),
      /already linked to another account/,
    );
  });

  it("refuses people missing from the snapshot and bad input", async () => {
    assert.match(await errorOf(USERS.intruder, "authenticated", "select claim_my_forum_identity('99999')"), /not found/);
    assert.match(await errorOf(USERS.intruder, "authenticated", "select claim_my_forum_identity('forum-user-1')"), /Invalid forum uid/);
  });

  it("keeps writes away from clients", async () => {
    assert.match(
      await errorOf(USERS.intruder, "authenticated", `insert into profile_forum_links (profile_id, forum_uid, status, method) values ('${USERS.intruder}', '701', 'verified', 'board')`),
      /permission denied/,
    );
    assert.match(
      await errorOf(USERS.intruder, "authenticated", `select forum_identity_write_link('${USERS.intruder}', '${USERS.intruder}', '701', false, 'verified', 'board', 'board_link')`),
      /permission denied/,
    );
  });

  it("lets a member read only their own link", async () => {
    const { rows } = await as(USERS.intruder, "authenticated", "select * from profile_forum_links");
    assert.equal(rows.length, 0);
    const own = await as(USERS.kasia, "authenticated", "select forum_uid from profile_forum_links");
    assert.deepEqual(own.rows.map((row) => row.forum_uid), ["619"]);
  });
});

describe("declare_no_forum_account", () => {
  it("records that the member has no forum account", async () => {
    await as(USERS.intruder, "authenticated", "select declare_no_forum_account()");
    const link = await linkOf(USERS.intruder);
    assert.equal(link.no_forum_account, true);
    assert.equal(link.forum_uid, null);
  });
});

describe("board RPCs", () => {
  it("rejects members", async () => {
    assert.match(await errorOf(USERS.kasia, "authenticated", "select * from list_forum_identity_links()"), /Only board or admin/);
    assert.match(
      await errorOf(USERS.kasia, "authenticated", `select board_set_forum_identity('${USERS.kasia}', '619')`),
      /Only board or admin/,
    );
    assert.match(await errorOf(USERS.kasia, "authenticated", "select * from list_forum_identity_audit(10)"), /Only board or admin/);
  });

  it("lists only accounts with a confirmed e-mail", async () => {
    const { rows } = await as(USERS.board, "authenticated", "select * from list_forum_identity_links()");
    const ids = rows.map((row) => row.profile_id);
    assert.ok(ids.includes(USERS.kasia));
    assert.ok(!ids.includes(USERS.unconfirmed));
    assert.equal(rows.find((row) => row.profile_id === USERS.kasia).status, "proposed");
  });

  it("verifies a proposed link without changing it", async () => {
    await as(USERS.board, "authenticated", `select board_set_forum_identity('${USERS.kasia}', '619')`);
    const link = await linkOf(USERS.kasia);
    assert.equal(link.status, "verified");
    assert.equal(link.method, "self");
    assert.equal(link.verified_by, USERS.board);
  });

  it("a member's later change goes back to proposed", async () => {
    await as(USERS.kasia, "authenticated", "select claim_my_forum_identity('701')");
    assert.equal((await linkOf(USERS.kasia)).status, "proposed");
    await as(USERS.board, "authenticated", `select board_set_forum_identity('${USERS.kasia}', '619')`);
    const link = await linkOf(USERS.kasia);
    assert.deepEqual([link.forum_uid, link.status, link.method], ["619", "verified", "board"]);
  });

  it("clears a link and keeps every change in the history", async () => {
    await as(USERS.board, "authenticated", `select board_clear_forum_identity('${USERS.intruder}')`);
    assert.equal(await linkOf(USERS.intruder), null);

    const { rows } = await as(USERS.board, "authenticated", "select * from list_forum_identity_audit(50)");
    assert.deepEqual(
      rows.map((row) => row.action).reverse(),
      ["auto_exact", "claim", "no_forum_account", "board_verify", "claim", "board_link", "board_clear"],
    );
    assert.equal(rows[0].changed_by_name, "Basia Zarząd");
  });
});

describe("list_profiles_for_role_admin", () => {
  it("says whether the e-mail is confirmed", async () => {
    const { rows } = await as(USERS.admin, "authenticated", "select id, email_confirmed from list_profiles_for_role_admin()");
    const confirmed = Object.fromEntries(rows.map((row) => [row.id, row.email_confirmed]));
    assert.equal(confirmed[USERS.unconfirmed], false);
    assert.equal(confirmed[USERS.kasia], true);
  });

  it("is still admin only", async () => {
    assert.match(await errorOf(USERS.board, "authenticated", "select * from list_profiles_for_role_admin()"), /Only admin/);
  });
});
