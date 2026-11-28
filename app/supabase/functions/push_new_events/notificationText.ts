// Texts of the push notifications (Partytura → Patterns → Notifications). No
// Deno APIs, so scripts/push-web-push.test.mjs runs it in Node.

export type NotificationPayload = {
  title: string;
  body: string;
  /** Opened on tap (sw.js → ?event= / ?post=); neither = Start. */
  eventId?: string;
  postId?: string;
  tag: string;
};

// More new events than this in one run (e.g. the board added a season at once)
// become one summary notification instead of a burst.
export const MAX_SEPARATE_NOTIFICATIONS = 3;
const TZ = "Europe/Warsaw";

const DATE_LABEL = new Intl.DateTimeFormat("pl-PL", {
  timeZone: TZ,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});
const TIME_LABEL = new Intl.DateTimeFormat("pl-PL", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

// Same rule as the app (utils/format.ts): forum titles lose their date prefix.
export function stripTitleDatePrefix(title: string): string {
  const stripped = title.replace(/^\s*\d{4}[./-]\d{1,2}[./-]\d{1,2}[\s:.\-–—]*/, "").trim();
  return stripped.length > 0 ? stripped : title;
}

// "sob. 28.11 · 10:30 · Sandomierz"
export function eventMetaLine(startsAt: Date, venue: string): string {
  const parts = DATE_LABEL.formatToParts(startsAt);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return [`${weekday} ${day}.${month}`.trim(), TIME_LABEL.format(startsAt), venue].filter(Boolean).join(" · ");
}

export function polishEventsCount(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (count === 1) {
    return "1 nowe wydarzenie";
  }
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return `${count} nowe wydarzenia`;
  }
  return `${count} nowych wydarzeń`;
}

export type NewEvent = { id: string; title: string; startsAt: Date; venue: string };

export function buildPayloads(events: NewEvent[]): NotificationPayload[] {
  if (events.length > MAX_SEPARATE_NOTIFICATIONS) {
    const titles = events.slice(0, 3).map((event) => stripTitleDatePrefix(event.title));
    return [
      {
        title: polishEventsCount(events.length),
        body: titles.join(", ") + (events.length > titles.length ? "…" : ""),
        tag: "new-events",
      },
    ];
  }
  return events.map((event) => ({
    title: `Nowe wydarzenie: ${stripTitleDatePrefix(event.title)}`,
    body: eventMetaLine(event.startsAt, event.venue),
    eventId: event.id,
    tag: event.id,
  }));
}

// ---------------------------------------------------------------- Kantorek

export type NewPost = {
  id: string;
  authorName: string;
  body: string;
  hasPoll: boolean;
  attachmentCount: number;
};

export function polishPostsCount(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (count === 1) {
    return "1 nowy wpis";
  }
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return `${count} nowe wpisy`;
  }
  return `${count} nowych wpisów`;
}

// First non-empty line, shortened; a post without text says what it has.
export function postPreview(post: NewPost): string {
  const firstLine = post.body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine) {
    return firstLine.length > 120 ? `${firstLine.slice(0, 119).trimEnd()}…` : firstLine;
  }
  if (post.hasPoll) {
    return "Ankieta";
  }
  return post.attachmentCount > 0 ? "Zdjęcie lub plik" : "";
}

export function buildPostPayloads(posts: NewPost[]): NotificationPayload[] {
  if (posts.length > MAX_SEPARATE_NOTIFICATIONS) {
    const authors = [...new Set(posts.map((post) => post.authorName).filter(Boolean))].slice(0, 3);
    return [
      {
        title: `${polishPostsCount(posts.length)} w Kantorku`,
        body: authors.join(", "),
        tag: "new-posts",
      },
    ];
  }
  return posts.map((post) => ({
    title: `Nowy wpis: ${post.authorName || "Kantorek"}`,
    body: postPreview(post),
    postId: post.id,
    tag: `post-${post.id}`,
  }));
}
