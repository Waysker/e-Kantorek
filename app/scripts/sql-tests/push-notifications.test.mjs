// Runs migration 034 on PGlite: push subscriptions are written only through the
// RPCs, for the signed-in account; the forum events already in the snapshot
// count as seen, so the first notifier run announces nothing old.
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

const ANNA = "00000000-0000-0000-0000-00000000000a";
const BARTEK = "00000000-0000-0000-0000-00000000000b";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const P256DH = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const AUTH = "tBHItJI5svbpez7KI4CCXg";

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

const register = (uid, endpoint = ENDPOINT) =>
  as(uid, "select public.register_push_subscription($1, $2, $3, $4)", [endpoint, P256DH, AUTH, "Test UA"]);

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls; -- as in Supabase
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    insert into auth.users values ('${ANNA}'), ('${BARTEK}');
  `);
  await db.exec(migration("001_forum_snapshot_cache.sql"));
  await db.exec(`
    insert into forum_snapshot_cache (snapshot_key, payload, generated_at) values (
      'forum',
      '{"events": [
        {"id": "forum-event-1097", "title": "2026.11.28 Barbóka PBI (duża)", "startsAt": "2026-11-28T10:30:00+01:00"},
        {"id": "forum-event-1128", "title": "2026.11.27 Barbórka PBI (mała)", "startsAt": "2026-11-27T11:00:00+01:00"}
      ]}',
      now()
    );
  `);
  await db.exec(migration("034_push_notifications.sql"));
});

after(async () => {
  await db?.close();
});

describe("push notifications (034)", () => {
  it("marks the events already in the snapshot as seen, not announced", async () => {
    const { rows } = await db.query(
      "select event_id, title, notified_at from push_forum_events_seen order by event_id",
    );
    assert.deepEqual(
      rows.map((row) => [row.event_id, row.notified_at]),
      [
        ["forum-event-1097", null],
        ["forum-event-1128", null],
      ],
    );
  });

  it("refuses to register without a signed-in account", async () => {
    await assert.rejects(register(null), /not_authenticated/);
  });

  it("registers the subscription for the caller and lets them read it", async () => {
    await register(ANNA);
    const { rows } = await as(ANNA, "select endpoint from push_subscriptions");
    assert.deepEqual(rows, [{ endpoint: ENDPOINT }]);
    const other = await as(BARTEK, "select endpoint from push_subscriptions");
    assert.equal(other.rows.length, 0);
  });

  it("never exposes the encryption keys to clients", async () => {
    await assert.rejects(as(ANNA, "select p256dh from push_subscriptions"), /permission denied/);
  });

  it("refuses direct writes", async () => {
    await assert.rejects(
      as(ANNA, "insert into push_subscriptions (profile_id, endpoint, p256dh, auth_secret) values ($1, $2, $3, $4)", [
        ANNA,
        "https://example.com/x",
        P256DH,
        AUTH,
      ]),
      /permission denied/,
    );
  });

  it("moves the browser's subscription to the account signed in now", async () => {
    await register(BARTEK);
    const { rows } = await db.query("select profile_id from push_subscriptions where endpoint = $1", [ENDPOINT]);
    assert.deepEqual(rows, [{ profile_id: BARTEK }]);
  });

  it("rejects an endpoint that is not https", async () => {
    await assert.rejects(register(ANNA, "http://example.com/push"), /check/);
  });

  it("unregisters only the caller's own subscription", async () => {
    const byAnna = await as(ANNA, "select public.unregister_push_subscription($1) as n", [ENDPOINT]);
    assert.equal(byAnna.rows[0].n, 0);
    const byBartek = await as(BARTEK, "select public.unregister_push_subscription($1) as n", [ENDPOINT]);
    assert.equal(byBartek.rows[0].n, 1);
  });

  it("keeps the seen-events table closed to clients", async () => {
    await assert.rejects(as(ANNA, "select * from push_forum_events_seen"), /permission denied/);
  });
});
