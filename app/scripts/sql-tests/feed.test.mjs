// Runs migrations 034 and 035 on PGlite: the Kantorek feed. Members post,
// comment, like and vote through RPCs only; board/admin pin and delete any
// post; push claims each post once.
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

const ANIA = "00000000-0000-0000-0000-0000000000a1";
const BARTEK = "00000000-0000-0000-0000-0000000000b2";
const BOARD = "00000000-0000-0000-0000-0000000000c3";

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

const one = async (uid, sql, params) => (await as(uid, sql, params)).rows[0];

async function createPost(uid, body, poll = null, attachments = []) {
  const row = await one(uid, "select public.create_feed_post($1, $2::jsonb, $3::jsonb) as id", [
    body,
    poll ? JSON.stringify(poll) : null,
    JSON.stringify(attachments),
  ]);
  return row.id;
}

const feed = async (uid) => (await one(uid, "select public.list_feed(20, null) as f")).f;
const post = async (uid, id) => (await one(uid, "select public.get_feed_post($1) as p", [id])).p;

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
    insert into auth.users values ('${ANIA}'), ('${BARTEK}'), ('${BOARD}');
    create table public.profiles (id uuid primary key, full_name text, role text);
    insert into public.profiles values
      ('${ANIA}', 'Ania Raczkowska', 'member'),
      ('${BARTEK}', 'Bartek Nowak', 'section'),
      ('${BOARD}', 'Paulina Bochaczyk', 'board');
  `);
  await db.exec(migration("001_forum_snapshot_cache.sql"));
  await db.exec(migration("034_push_notifications.sql"));
  await db.exec(migration("035_feed.sql"));
  await db.exec(migration("037_feed_facebook_import.sql"));
});

after(async () => {
  await db?.close();
});

describe("feed (035)", () => {
  let warsztaty;
  let ankieta;

  it("lets a member post text with attachments under their own folder", async () => {
    warsztaty = await createPost(ANIA, "[warsztaty 2026]\nStartujemy z zapisami!", null, [
      { path: `${ANIA}/x1/pokoje.jpg`, kind: "image", fileName: "pokoje.jpg", mimeType: "image/jpeg", sizeBytes: 120000, width: 1600, height: 1200 },
    ]);
    const [first] = await feed(BARTEK);
    assert.equal(first.id, warsztaty);
    assert.equal(first.authorName, "Ania Raczkowska");
    assert.equal(first.mine, false);
    assert.equal(first.attachments[0].fileName, "pokoje.jpg");
  });

  it("refuses someone else's storage path, empty posts and anonymous callers", async () => {
    await assert.rejects(
      createPost(BARTEK, "x", null, [{ path: `${ANIA}/x2/a.jpg`, kind: "image", fileName: "a.jpg" }]),
      /attachment_not_yours/,
    );
    await assert.rejects(createPost(ANIA, "   "), /empty_post/);
    await assert.rejects(createPost(null, "hej"), /not_authenticated/);
  });

  it("refuses direct writes to the tables", async () => {
    await assert.rejects(
      as(ANIA, "insert into feed_posts (author_id, body) values ($1, 'x')", [ANIA]),
      /permission denied/,
    );
  });

  it("runs a single-choice poll and shows counts and my vote", async () => {
    ankieta = await createPost(ANIA, "Motyw imprezy?", {
      question: "Motyw",
      multiple: false,
      options: ["PRL", "Kosmici", "Postacie z seriali"],
    });
    const options = (await post(ANIA, ankieta)).post.poll.options;
    await as(BARTEK, "select public.vote_feed_poll($1, $2::uuid[])", [ankieta, [options[0].id]]);
    await as(ANIA, "select public.vote_feed_poll($1, $2::uuid[])", [ankieta, [options[0].id]]);
    await assert.rejects(
      as(ANIA, "select public.vote_feed_poll($1, $2::uuid[])", [ankieta, [options[0].id, options[1].id]]),
      /single_choice/,
    );
    // Changing the vote replaces it.
    await as(ANIA, "select public.vote_feed_poll($1, $2::uuid[])", [ankieta, [options[1].id]]);
    const poll = (await post(ANIA, ankieta)).post.poll;
    assert.deepEqual(
      poll.options.map((o) => [o.label, o.votes, o.mine]),
      [
        ["PRL", 1, false],
        ["Kosmici", 1, true],
        ["Postacie z seriali", 0, false],
      ],
    );
    assert.equal(poll.voterCount, 2);
    const voters = await as(BOARD, "select full_name from public.feed_people($1, $2)", [ankieta, options[0].id]);
    assert.deepEqual(voters.rows, [{ full_name: "Bartek Nowak" }]);
  });

  it("toggles likes", async () => {
    assert.equal((await one(BARTEK, "select public.toggle_feed_reaction($1) as on", [warsztaty])).on, true);
    let item = (await post(BARTEK, warsztaty)).post;
    assert.deepEqual([item.likeCount, item.likedByMe], [1, true]);
    assert.equal((await one(BARTEK, "select public.toggle_feed_reaction($1) as on", [warsztaty])).on, false);
    item = (await post(BARTEK, warsztaty)).post;
    assert.deepEqual([item.likeCount, item.likedByMe], [0, false]);
  });

  it("adds comments; only the author edits, author or board deletes", async () => {
    const comment = (await one(BARTEK, "select public.add_feed_comment($1, 'Ja się zapisuję') as id", [warsztaty])).id;
    await assert.rejects(as(ANIA, "select public.update_feed_comment($1, 'x')", [comment]), /not_your_comment/);
    await as(BARTEK, "select public.update_feed_comment($1, 'Ja się zapisuję!')", [comment]);
    const detail = await post(ANIA, warsztaty);
    assert.equal(detail.comments[0].body, "Ja się zapisuję!");
    assert.ok(detail.comments[0].editedAt);
    assert.equal(detail.post.commentCount, 1);
    await assert.rejects(as(ANIA, "select public.delete_feed_comment($1)", [comment]), /not_allowed/);
    await as(BOARD, "select public.delete_feed_comment($1)", [comment]);
    assert.equal((await post(ANIA, warsztaty)).comments.length, 0);
  });

  it("pins for board only and lists pinned posts first", async () => {
    await assert.rejects(as(ANIA, "select public.set_feed_post_pinned($1, true)", [warsztaty]), /only_board/);
    await as(BOARD, "select public.set_feed_post_pinned($1, true)", [warsztaty]);
    const items = await feed(ANIA);
    assert.deepEqual(items.map((i) => [i.id, i.pinned]), [
      [warsztaty, true],
      [ankieta, false],
    ]);
  });

  it("claims each post for push once", async () => {
    const first = await db.query("select id, author_name, fresh from public.claim_feed_posts_for_push() order by author_name");
    assert.equal(first.rows.length, 2);
    assert.ok(first.rows.every((row) => row.fresh));
    const second = await db.query("select * from public.claim_feed_posts_for_push()");
    assert.equal(second.rows.length, 0);
    await assert.rejects(as(ANIA, "select * from public.claim_feed_posts_for_push()"), /permission denied/);
  });

  it("deletes: not someone else's post, but the board can; returns file paths", async () => {
    await assert.rejects(as(BARTEK, "select public.delete_feed_post($1)", [warsztaty]), /not_allowed/);
    const deleted = await one(BOARD, "select public.delete_feed_post($1) as paths", [warsztaty]);
    assert.deepEqual(deleted.paths, [`${ANIA}/x1/pokoje.jpg`]);
    assert.equal((await feed(ANIA)).length, 1);
  });

  it("keeps push topics per browser, defaulting to both", async () => {
    await as(ANIA, "select public.register_push_subscription($1, $2, $3, null)", [
      "https://fcm.googleapis.com/fcm/send/ania",
      "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
      "tBHItJI5svbpez7KI4CCXg",
    ]);
    const get = () => one(ANIA, "select public.get_push_topics('https://fcm.googleapis.com/fcm/send/ania') as t");
    assert.deepEqual((await get()).t, ["new_event", "new_post"]);
    await as(ANIA, "select public.set_push_topics('https://fcm.googleapis.com/fcm/send/ania', array['new_event'])");
    assert.deepEqual((await get()).t, ["new_event"]);
    await assert.rejects(
      as(ANIA, "select public.set_push_topics('https://fcm.googleapis.com/fcm/send/ania', array['spam'])"),
      /unknown_topic/,
    );
  });

  it("imports a Facebook post for the board only, with a closed poll, FB likes and comments", async () => {
    const payload = {
      authorName: "Ania Raczkowska",
      createdAt: "2026-10-21T18:40:00+02:00",
      body: "[warsztaty] [imprezka przebierana]",
      externalUrl: "https://www.facebook.com/groups/x/posts/1",
      likeCount: 2,
      poll: { question: "Motyw", multiple: false, options: [{ label: "PRL", votes: 24 }, { label: "Kosmici", votes: 18 }] },
      comments: [{ authorName: "Michał Ziobro", body: "Jeśli na walnym nie osiągniemy konsensusu…" }, { authorName: "X", body: "  " }],
    };
    await assert.rejects(as(ANIA, "select public.import_feed_post($1::jsonb)", [JSON.stringify(payload)]), /only_board/);
    const { id } = await one(BOARD, "select public.import_feed_post($1::jsonb) as id", [JSON.stringify(payload)]);
    const detail = await post(ANIA, id);
    assert.equal(detail.post.authorName, "Ania Raczkowska");
    assert.equal(detail.post.source, "facebook");
    assert.equal(detail.post.likeCount, 2);
    assert.equal(detail.post.mine, false);
    assert.deepEqual(detail.post.poll.options.map((o) => [o.label, o.votes]), [["PRL", 24], ["Kosmici", 18]]);
    assert.equal(detail.post.poll.closed, true);
    assert.equal(detail.post.poll.voterCount, 42);
    assert.deepEqual(detail.comments.map((c) => c.authorName), ["Michał Ziobro"]);
    await assert.rejects(
      as(BARTEK, "select public.vote_feed_poll($1, $2::uuid[])", [id, [detail.post.poll.options[0].id]]),
      /poll_closed/,
    );
    // Board corrects the text; nobody else can.
    await assert.rejects(as(ANIA, "select public.update_feed_post($1, 'x')", [id]), /not_your_post/);
    await as(BOARD, "select public.update_feed_post($1, 'poprawione')", [id]);
    // Imports never go to push.
    const claimed = await db.query("select id from public.claim_feed_posts_for_push()");
    assert.equal(claimed.rows.length, 0);
    // Sorted by the original date: after newer app posts.
    const items = await feed(ANIA);
    assert.equal(items[items.length - 1].id, id);
  });

  it("rejects an import without author or with a bad date", async () => {
    await assert.rejects(
      as(BOARD, "select public.import_feed_post($1::jsonb)", [JSON.stringify({ authorName: "", createdAt: "2026-10-01", body: "x" })]),
      /author_required/,
    );
    await assert.rejects(
      as(BOARD, "select public.import_feed_post($1::jsonb)", [JSON.stringify({ authorName: "A", createdAt: "wczoraj", body: "x" })]),
      /invalid_date/,
    );
  });
});
