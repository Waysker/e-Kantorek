// Push notifications (Partytura → Patterns → Notifications, Kantorek):
// "Nowe wydarzenie: …" for every forum event the app has not seen before, and
// "Nowy wpis: <autor>" for every new Kantorek post (migration 035). pg_cron calls it every few
// minutes (schedule_push_new_events, migration 034); a run with nothing new only
// reads the snapshot.
//
// Body (all optional):
//   { "dryRun": true }              lists what would be sent, marks nothing
//   { "testProfileId": "<uuid>" }   sends "Powiadomienia działają" to that
//                                   account's devices, nothing else
//
// Env: PUSH_NEW_EVENTS_FUNCTION_AUTH_TOKEN (caller), VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, optional VAPID_SUBJECT (mailto: or https:).
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

import {
  buildPayloads,
  buildPostPayloads,
  stripTitleDatePrefix,
  type NewPost,
  type NotificationPayload,
} from "./notificationText.ts";
import { sendWebPush, type VapidKeys } from "./webPush.ts";

type SupabaseAdminClient = SupabaseClient<any, "public", any>;

type SnapshotEvent = {
  id?: unknown;
  title?: unknown;
  startsAt?: unknown;
  venue?: unknown;
};

type SubscriptionRow = {
  id: string;
  profile_id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  failure_count: number;
  /** Push topics this browser wants (migration 035); absent before it = all. */
  topics?: string[] | null;
};

type Topic = "new_event" | "new_post";

class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
const AUTH_TOKEN = Deno.env.get("PUSH_NEW_EVENTS_FUNCTION_AUTH_TOKEN");
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "https://waysker.github.io/e-Kantorek/";

const SNAPSHOT_KEY = "forum";
const FORUM_EVENT_ID = /^forum-event-\d+$/;
// A subscription that keeps failing (not "gone") is dropped after this many runs.
const MAX_FAILURES = 10;
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function text(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseBearerToken(headerValue: string | null): string | null {
  const match = text(headerValue).match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function createAdminClient(): SupabaseAdminClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(500, "missing_supabase_env", "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function vapidKeys(): VapidKeys {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new HttpError(500, "missing_vapid_keys", "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are required.");
  }
  return { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY, subject: VAPID_SUBJECT };
}

async function loadSnapshotEvents(client: SupabaseAdminClient): Promise<SnapshotEvent[]> {
  const { data, error } = await client
    .from("forum_snapshot_cache")
    .select("payload")
    .eq("snapshot_key", SNAPSHOT_KEY)
    .maybeSingle();
  if (error) {
    throw new HttpError(500, "snapshot_read_failed", error.message);
  }
  const events = (data?.payload as { events?: unknown } | null)?.events;
  return Array.isArray(events) ? (events as SnapshotEvent[]) : [];
}

async function loadSubscriptions(
  client: SupabaseAdminClient,
  options: { profileId?: string; topic?: Topic } = {},
): Promise<SubscriptionRow[]> {
  const run = (columns: string) => {
    let query = client.from("push_subscriptions").select(columns);
    if (options.profileId) {
      query = query.eq("profile_id", options.profileId);
    }
    return query;
  };
  let { data, error } = await run("id,profile_id,endpoint,p256dh,auth_secret,failure_count,topics");
  if (error && /topics/.test(error.message)) {
    // Before migration 035: no topics column, everyone gets everything.
    ({ data, error } = await run("id,profile_id,endpoint,p256dh,auth_secret,failure_count"));
  }
  if (error) {
    throw new HttpError(500, "subscriptions_read_failed", error.message);
  }
  const rows = (data ?? []) as unknown as SubscriptionRow[];
  const topic = options.topic;
  return topic ? rows.filter((row) => !Array.isArray(row.topics) || row.topics.includes(topic)) : rows;
}

// Sends every payload to every subscription; deletes the ones the push service
// reports as gone and counts failures on the others.
async function deliver(
  client: SupabaseAdminClient,
  subscriptions: SubscriptionRow[],
  payloads: NotificationPayload[],
) {
  const keys = vapidKeys();
  let delivered = 0;
  let failed = 0;
  const gone: string[] = [];
  const errors: Array<{ status: number; body: string }> = [];

  for (const subscription of subscriptions) {
    let subscriptionFailed = false;
    let subscriptionGone = false;
    for (const payload of payloads) {
      try {
        const result = await sendWebPush(
          { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth_secret },
          payload,
          keys,
          { topic: payload.tag },
        );
        if (result.gone) {
          subscriptionGone = true;
          break;
        }
        if (result.status >= 200 && result.status < 300) {
          delivered += 1;
        } else {
          subscriptionFailed = true;
          failed += 1;
          errors.push({ status: result.status, body: result.body });
        }
      } catch (error) {
        subscriptionFailed = true;
        failed += 1;
        errors.push({ status: 0, body: error instanceof Error ? error.message : String(error) });
      }
    }

    if (subscriptionGone || (subscriptionFailed && subscription.failure_count + 1 >= MAX_FAILURES)) {
      gone.push(subscription.id);
    } else {
      await client
        .from("push_subscriptions")
        .update(
          subscriptionFailed
            ? { failure_count: subscription.failure_count + 1 }
            : { failure_count: 0, last_sent_at: new Date().toISOString() },
        )
        .eq("id", subscription.id);
    }
  }

  if (gone.length > 0) {
    await client.from("push_subscriptions").delete().in("id", gone);
  }

  return { delivered, failed, removed_subscriptions: gone.length, errors: errors.slice(0, 5) };
}

async function runNewEvents(client: SupabaseAdminClient, dryRun: boolean) {
  const snapshotEvents = await loadSnapshotEvents(client);
  if (snapshotEvents.length === 0) {
    // An empty or broken snapshot must not reset anything.
    return { status: "ok", new_events: 0, note: "snapshot_empty" };
  }

  const candidates = snapshotEvents
    .map((event) => ({
      id: text(event.id),
      title: text(event.title),
      startsAt: new Date(text(event.startsAt)),
      venue: text(event.venue),
    }))
    .filter((event) => FORUM_EVENT_ID.test(event.id) && event.title);

  const { count: seenCount, error: countError } = await client
    .from("push_forum_events_seen")
    .select("event_id", { count: "exact", head: true });
  if (countError) {
    throw new HttpError(500, "seen_read_failed", countError.message);
  }

  const { data: seenRows, error: seenError } = await client
    .from("push_forum_events_seen")
    .select("event_id")
    .in("event_id", candidates.map((event) => event.id));
  if (seenError) {
    throw new HttpError(500, "seen_read_failed", seenError.message);
  }
  const seen = new Set((seenRows ?? []).map((row: { event_id: string }) => row.event_id));
  const unseen = candidates.filter((event) => !seen.has(event.id));
  // First run without the migration's backfill: learn, do not announce.
  const bootstrap = (seenCount ?? 0) === 0;
  const now = Date.now();
  const toAnnounce = bootstrap
    ? []
    : unseen.filter((event) => Number.isFinite(event.startsAt.getTime()) && event.startsAt.getTime() > now);

  if (dryRun) {
    return {
      status: "ok",
      dry_run: true,
      bootstrap,
      new_events: unseen.length,
      would_announce: toAnnounce.map((event) => ({ id: event.id, title: stripTitleDatePrefix(event.title) })),
      payloads: buildPayloads(toAnnounce),
    };
  }
  if (unseen.length === 0) {
    return { status: "ok", new_events: 0 };
  }

  // Claim the events first (insert … on conflict do nothing returning): a run
  // that overlaps this one gets nothing back, so no event is announced twice.
  const { data: claimedRows, error: claimError } = await client
    .from("push_forum_events_seen")
    .upsert(
      unseen.map((event) => ({
        event_id: event.id,
        title: event.title,
        starts_at: Number.isFinite(event.startsAt.getTime()) ? event.startsAt.toISOString() : null,
      })),
      { onConflict: "event_id", ignoreDuplicates: true },
    )
    .select("event_id");
  if (claimError) {
    throw new HttpError(500, "seen_write_failed", claimError.message);
  }
  const claimed = new Set((claimedRows ?? []).map((row: { event_id: string }) => row.event_id));
  const announce = toAnnounce.filter((event) => claimed.has(event.id));
  if (announce.length === 0) {
    return { status: "ok", new_events: unseen.length, announced: 0, bootstrap };
  }

  const subscriptions = await loadSubscriptions(client, { topic: "new_event" });
  const result =
    subscriptions.length > 0
      ? await deliver(client, subscriptions, buildPayloads(announce))
      : { delivered: 0, failed: 0, removed_subscriptions: 0, errors: [] };

  await client
    .from("push_forum_events_seen")
    .update({ notified_at: new Date().toISOString(), recipients: subscriptions.length, failures: result.failed })
    .in("event_id", announce.map((event) => event.id));

  return {
    status: "ok",
    new_events: unseen.length,
    announced: announce.length,
    announced_events: announce.map((event) => stripTitleDatePrefix(event.title)),
    subscriptions: subscriptions.length,
    ...result,
  };
}

// New Kantorek posts (migration 035): each claimed once; posts older than a day
// (e.g. after downtime) are only marked. The author's own devices are skipped.
async function runNewPosts(client: SupabaseAdminClient, dryRun: boolean) {
  if (dryRun) {
    const { count, error } = await client
      .from("feed_posts")
      .select("id", { count: "exact", head: true })
      .is("notified_at", null);
    return error ? { skipped: "feed_not_installed" } : { pending_posts: count ?? 0 };
  }
  const { data, error } = await client.rpc("claim_feed_posts_for_push");
  if (error) {
    if (/claim_feed_posts_for_push|does not exist|schema cache/i.test(error.message)) {
      return { skipped: "feed_not_installed" };
    }
    throw new HttpError(500, "feed_claim_failed", error.message);
  }
  const rows = (data ?? []) as Array<{
    id: string;
    author_id: string | null;
    author_name: string;
    body: string;
    has_poll: boolean;
    attachment_count: number;
    fresh: boolean;
  }>;
  const fresh = rows.filter((row) => row.fresh);
  if (fresh.length === 0) {
    return { new_posts: rows.length, announced: 0 };
  }

  const subscriptions = await loadSubscriptions(client, { topic: "new_post" });
  const posts: Array<NewPost & { authorId: string | null }> = fresh.map((row) => ({
    id: row.id,
    authorId: row.author_id,
    authorName: text(row.author_name),
    body: String(row.body ?? ""),
    hasPoll: Boolean(row.has_poll),
    attachmentCount: Number(row.attachment_count ?? 0),
  }));

  // Group devices by the set of posts they should hear about (never their own).
  const groups = new Map<string, SubscriptionRow[]>();
  for (const subscription of subscriptions) {
    const key = posts
      .filter((post) => post.authorId !== subscription.profile_id)
      .map((post) => post.id)
      .join(",");
    if (key) {
      groups.set(key, [...(groups.get(key) ?? []), subscription]);
    }
  }
  const totals = { delivered: 0, failed: 0, removed_subscriptions: 0 };
  const errors: Array<{ status: number; body: string }> = [];
  for (const [key, group] of groups) {
    const ids = new Set(key.split(","));
    const result = await deliver(client, group, buildPostPayloads(posts.filter((post) => ids.has(post.id))));
    totals.delivered += result.delivered;
    totals.failed += result.failed;
    totals.removed_subscriptions += result.removed_subscriptions;
    errors.push(...result.errors);
  }
  return {
    new_posts: rows.length,
    announced: fresh.length,
    subscriptions: subscriptions.length,
    ...totals,
    errors: errors.slice(0, 5),
  };
}

async function runTest(client: SupabaseAdminClient, profileId: string) {
  const subscriptions = await loadSubscriptions(client, { profileId });
  if (subscriptions.length === 0) {
    return { status: "ok", test: true, subscriptions: 0, note: "no_subscriptions_for_profile" };
  }
  const result = await deliver(client, subscriptions, [
    {
      title: "Powiadomienia działają",
      body: "Tak będziesz dostawać informacje o nowych wydarzeniach.",
      tag: "test",
    },
  ]);
  return { status: "ok", test: true, subscriptions: subscriptions.length, ...result };
}

Deno.serve(async (request) => {
  try {
    if (request.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", "Use POST.");
    }
    if (!AUTH_TOKEN) {
      throw new HttpError(500, "missing_auth_token_env", "PUSH_NEW_EVENTS_FUNCTION_AUTH_TOKEN is not set.");
    }
    if (parseBearerToken(request.headers.get("authorization")) !== AUTH_TOKEN) {
      throw new HttpError(401, "unauthorized", "Invalid bearer token.");
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const client = createAdminClient();
    const testProfileId = text(body.testProfileId);
    if (testProfileId) {
      if (!/^[0-9a-f-]{36}$/i.test(testProfileId)) {
        throw new HttpError(400, "invalid_profile_id", "testProfileId must be a uuid.");
      }
      return jsonResponse(await runTest(client, testProfileId));
    }
    const dryRun = body.dryRun === true;
    const events = await runNewEvents(client, dryRun);
    const posts = await runNewPosts(client, dryRun);
    return jsonResponse({ ...events, posts });
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({ status: "error", code: error.code, message: error.message }, error.status);
    }
    return jsonResponse(
      { status: "error", code: "unexpected", message: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
