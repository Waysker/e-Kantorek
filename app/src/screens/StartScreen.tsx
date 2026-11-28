import { useMemo, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";

import type { AttendanceStatus, EventListItem } from "../domain/models";
import { appLocaleTag, tr } from "../i18n";
import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";
import { EventRow } from "../ui/EventRow";
import { EmptyState } from "../ui/EmptyState";
import { Card } from "../ui/Card";
import { textStyles } from "../theme/text";
import { stripTitleDatePrefix } from "../utils/format";
import { DeclarationPrompt } from "../ui/DeclarationPrompt";
import { Icon } from "../ui/Icon";
import { StatusPill, statusMeta } from "../ui/StatusPill";

type StartScreenProps = {
  events: EventListItem[];
  /** ForumIdentityPrompt while the account has no forum person: replaces DeclarationPrompt. */
  identityPrompt?: ReactNode;
  /** A Notice shown at the top (e.g. after linking the forum account). */
  topNotice?: ReactNode;
  firstName: string | null;
  unreadNotificationsCount: number;
  onOpenEvent: (eventId: string) => void;
  onOpenEvents: () => void;
  onOpenCalendar: () => void;
  onOpenNotifications: () => void;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const TZ = "Europe/Warsaw";
const DATE_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const TODAY_LABEL = new Intl.DateTimeFormat(appLocaleTag, {
  timeZone: TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
});
const HERO_DATE = new Intl.DateTimeFormat(appLocaleTag, {
  timeZone: TZ,
  weekday: "long",
  day: "numeric",
  month: "numeric",
});
const TIME = new Intl.DateTimeFormat(appLocaleTag, { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const WEEKDAY_SHORT = new Intl.DateTimeFormat(appLocaleTag, { timeZone: "UTC", weekday: "short" });

function dateKey(value: string | Date) {
  return DATE_KEY.format(value instanceof Date ? value : new Date(value));
}

function keyToUtc(key: string) {
  return Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
}

function utcToKey(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const STATUS_PRIORITY: AttendanceStatus[] = ["no_response", "maybe", "going", "not_going", "unknown"];

function daysUntilLabel(eventKey: string, todayKey: string) {
  const days = Math.round((keyToUtc(eventKey) - keyToUtc(todayKey)) / DAY_MS);
  if (days <= 0) {
    return tr("dzisiaj", "today");
  }
  if (days === 1) {
    return tr("jutro", "tomorrow");
  }
  return tr(`za ${days} dni`, `in ${days} days`);
}

export function StartScreen({
  events,
  identityPrompt,
  topNotice,
  firstName,
  unreadNotificationsCount,
  onOpenEvent,
  onOpenEvents,
  onOpenCalendar,
  onOpenNotifications,
}: StartScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;
  const now = new Date();
  const todayKey = dateKey(now);

  const upcoming = useMemo(
    () =>
      events
        .filter((event) => dateKey(event.startsAt) >= todayKey)
        .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt)),
    [events, todayKey],
  );
  const needsResponse = upcoming.filter((event) => event.attendanceStatus === "no_response");
  const nextGig = upcoming.find((event) => event.attendanceStatus === "going") ?? null;
  const later = upcoming.filter((event) => event.id !== nextGig?.id).slice(0, 4);

  // Monday-first strip for the current week.
  const todayUtc = keyToUtc(todayKey);
  const mondayUtc = todayUtc - ((new Date(todayUtc).getUTCDay() + 6) % 7) * DAY_MS;
  const weekDays = Array.from({ length: 7 }, (_, index) => utcToKey(mondayUtc + index * DAY_MS));
  const statusByDay = new Map<string, AttendanceStatus>();
  for (const event of events) {
    const key = dateKey(event.startsAt);
    const current = statusByDay.get(key);
    if (
      !current ||
      STATUS_PRIORITY.indexOf(event.attendanceStatus) < STATUS_PRIORITY.indexOf(current)
    ) {
      statusByDay.set(key, event.attendanceStatus);
    }
  }

  const greeting = firstName
    ? tr(`Cześć, ${firstName}`, `Hi, ${firstName}`)
    : tr("Cześć!", "Hi!");

  const nextGigCard = nextGig ? (
    <Pressable
      onPress={() => onOpenEvent(nextGig.id)}
      accessibilityRole="link"
      style={styles.hero}
    >
      <View style={styles.heroTop}>
        <Text style={styles.heroKicker}>
          {tr("Najbliższe granie", "Next performance")} ·{" "}
          {daysUntilLabel(dateKey(nextGig.startsAt), todayKey)}
        </Text>
        <StatusPill status={nextGig.attendanceStatus} />
      </View>
      <Text style={styles.heroTitle}>{stripTitleDatePrefix(nextGig.title)}</Text>
      <Text style={styles.heroMeta}>
        {HERO_DATE.format(new Date(nextGig.startsAt))} · {TIME.format(new Date(nextGig.startsAt))}
      </Text>
      {nextGig.venue ? <Text style={styles.heroMeta}>{nextGig.venue}</Text> : null}
      <Text style={styles.heroLink}>{tr("Szczegóły i setlista ›", "Details and setlist ›")}</Text>
    </Pressable>
  ) : null;

  const weekStrip = (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.kicker}>{tr("Ten tydzień", "This week")}</Text>
        <Pressable onPress={onOpenCalendar} accessibilityRole="link" hitSlop={8}>
          <Text style={styles.link}>{tr("Kalendarz ›", "Calendar ›")}</Text>
        </Pressable>
      </View>
      <View style={styles.weekRow}>
        {weekDays.map((key) => {
          const status = statusByDay.get(key);
          const meta = status && status !== "unknown" ? statusMeta(status) : null;
          const isToday = key === todayKey;
          return (
            <Pressable
              key={key}
              onPress={onOpenCalendar}
              accessibilityRole="button"
              accessibilityLabel={`${key}${meta ? `, ${meta.label}` : ""}`}
              style={[
                styles.dayCell,
                meta && { backgroundColor: meta.bg },
                meta?.needsAction && { borderColor: meta.accent },
                isToday && styles.dayCellToday,
              ]}
            >
              <Text
                style={[
                  styles.dayWeekday,
                  meta && { color: meta.fg },
                  isToday && styles.dayTextToday,
                ]}
              >
                {WEEKDAY_SHORT.format(new Date(keyToUtc(key)))}
              </Text>
              <Text
                style={[
                  styles.dayNumber,
                  meta && { color: meta.fg, fontWeight: "700" },
                  isToday && styles.dayTextToday,
                ]}
              >
                {Number(key.slice(8, 10))}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const laterList =
    later.length > 0 ? (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.kicker}>{tr("Kolejne", "Coming up")}</Text>
          <Pressable onPress={onOpenEvents} accessibilityRole="link" hitSlop={8}>
            <Text style={styles.link}>{tr("Wszystkie ›", "All ›")}</Text>
          </Pressable>
        </View>
        <Card variant="list">
          {later.map((event, index) => (
            <EventRow
              key={event.id}
              event={event}
              index={index}
              dateStyle="inline"
              onPress={() => onOpenEvent(event.id)}
            />
          ))}
        </Card>
      </View>
    ) : null;

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={[styles.content, isDesktop && styles.contentDesktop]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>{capitalize(TODAY_LABEL.format(now))}</Text>
          <Text style={styles.greeting}>{greeting}</Text>
        </View>
        <Pressable
          onPress={onOpenNotifications}
          accessibilityRole="button"
          accessibilityLabel={
            unreadNotificationsCount > 0
              ? tr(
                  `Powiadomienia, ${unreadNotificationsCount} nowe`,
                  `Notifications, ${unreadNotificationsCount} new`,
                )
              : tr("Powiadomienia", "Notifications")
          }
          style={styles.bellButton}
        >
          <Icon name="bell" size={20} color={colors.ink} />
          {unreadNotificationsCount > 0 ? <View style={styles.bellDot} /> : null}
        </Pressable>
      </View>

      {isDesktop ? (
        <View style={styles.columns}>
          <View style={styles.column}>
            {topNotice}
            {identityPrompt ?? <DeclarationPrompt events={needsResponse} onOpenEvent={onOpenEvent} />}
            {nextGigCard}
          </View>
          <View style={styles.column}>
            {weekStrip}
            {laterList}
          </View>
        </View>
      ) : (
        <>
          {topNotice}
          {identityPrompt ?? <DeclarationPrompt events={needsResponse} onOpenEvent={onOpenEvent} />}
          {nextGigCard}
          {weekStrip}
          {laterList}
        </>
      )}

      {upcoming.length === 0 ? (
        <EmptyState title={tr("Brak nadchodzących wydarzeń.", "No upcoming events.")}>
          {tr(
            "Nowe wątki z forum pojawią się tutaj automatycznie.",
            "New forum threads will appear here automatically.",
          )}
        </EmptyState>
      ) : null}
    </ScrollView>
  );
}

const styles = themedStyles((colors) => ({
  screenScroll: {
    flex: 1,
  },
  content: {
    padding: tokens.spacing.md,
    paddingTop: tokens.spacing.lg,
    gap: 20,
  },
  contentDesktop: {
    width: "100%",
    maxWidth: 1080,
    alignSelf: "center",
    paddingHorizontal: tokens.spacing.xl,
    paddingTop: tokens.spacing.xl,
  },
  columns: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tokens.spacing.lg,
  },
  column: {
    flex: 1,
    minWidth: 0,
    gap: 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: tokens.spacing.sm,
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  kicker: textStyles.kicker,
  greeting: textStyles.screenTitle,
  bellButton: {
    width: 44,
    height: 44,
    borderRadius: tokens.radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  bellDot: {
    position: "absolute",
    top: 9,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.warningBorder,
  },
  hero: {
    backgroundColor: colors.brandDeep,
    borderRadius: tokens.radii.xl,
    padding: 20,
    gap: 4,
  },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.spacing.sm,
    marginBottom: tokens.spacing.sm,
  },
  heroKicker: {
    flex: 1,
    fontSize: tokens.typography.caption,
    fontWeight: "600",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: colors.brandDeepAccent,
  },
  heroTitle: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: "800",
    letterSpacing: -0.3,
    color: colors.onStrong,
    marginBottom: 4,
  },
  heroMeta: {
    fontSize: 14,
    color: colors.brandDeepMuted,
  },
  heroLink: {
    marginTop: tokens.spacing.sm,
    paddingTop: tokens.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.brandDeepRaised,
    fontSize: 13,
    fontWeight: "600",
    color: colors.brandDeepMuted,
  },
  section: {
    gap: tokens.spacing.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  link: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.brand,
  },
  weekRow: {
    flexDirection: "row",
    gap: 4,
  },
  dayCell: {
    flex: 1,
    height: 54,
    borderRadius: tokens.radii.sm,
    borderWidth: 1.5,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
  },
  dayCellToday: {
    backgroundColor: colors.brand,
  },
  dayWeekday: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    color: colors.muted,
  },
  dayNumber: {
    fontSize: 15,
    color: colors.ink,
  },
  dayTextToday: {
    color: colors.onBrand,
    fontWeight: "700",
  },
}));
