// Texts of the push notifications (Partytura → Patterns → Notifications). No
// Deno APIs, so scripts/push-web-push.test.mjs runs it in Node.

export type NotificationPayload = {
  title: string;
  body: string;
  /** Opened on tap; absent = Start. */
  eventId?: string;
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
