import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import type { EventListItem } from "../domain/models";
import { appLocaleTag, tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { stripTitleDatePrefix } from "../utils/format";
import { StatusPill } from "../ui/StatusPill";

type EventsScreenProps = {
  events: EventListItem[];
  onOpenEvent: (eventId: string) => void;
  /** Inside the Events hub the hub header already shows the title. */
  hideTitle?: boolean;
};

type EventsTab = "upcoming" | "past";

const WARSAW_DATE_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const WARSAW_WEEKDAY = new Intl.DateTimeFormat(appLocaleTag, {
  timeZone: "Europe/Warsaw",
  weekday: "short",
});
const WARSAW_DAY = new Intl.DateTimeFormat(appLocaleTag, {
  timeZone: "Europe/Warsaw",
  day: "numeric",
});
const WARSAW_TIME = new Intl.DateTimeFormat(appLocaleTag, {
  timeZone: "Europe/Warsaw",
  hour: "2-digit",
  minute: "2-digit",
});
const WARSAW_MONTH = new Intl.DateTimeFormat(appLocaleTag, {
  timeZone: "Europe/Warsaw",
  month: "long",
  year: "numeric",
});

function toWarsawDateKey(value: string | Date) {
  return WARSAW_DATE_KEY.format(value instanceof Date ? value : new Date(value));
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

type MonthGroup = { key: string; label: string; events: EventListItem[] };

function groupByMonth(events: EventListItem[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const event of events) {
    const key = toWarsawDateKey(event.startsAt).slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.events.push(event);
    } else {
      groups.push({
        key,
        label: capitalize(WARSAW_MONTH.format(new Date(event.startsAt))),
        events: [event],
      });
    }
  }
  return groups;
}

export function EventsScreen({ events, onOpenEvent, hideTitle }: EventsScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;
  const [activeTab, setActiveTab] = useState<EventsTab>("upcoming");
  const [onlyNeedsResponse, setOnlyNeedsResponse] = useState(false);
  const todayKey = toWarsawDateKey(new Date());

  const { upcomingEvents, pastEvents } = useMemo(() => {
    const upcoming = events
      .filter((event) => toWarsawDateKey(event.startsAt) >= todayKey)
      .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
    const past = events
      .filter((event) => toWarsawDateKey(event.startsAt) < todayKey)
      .sort((left, right) => Date.parse(right.startsAt) - Date.parse(left.startsAt));
    return { upcomingEvents: upcoming, pastEvents: past };
  }, [events, todayKey]);

  const needsResponseCount = upcomingEvents.filter(
    (event) => event.attendanceStatus === "no_response",
  ).length;
  const filterActive = activeTab === "upcoming" && onlyNeedsResponse;
  const visibleEvents = (activeTab === "upcoming" ? upcomingEvents : pastEvents).filter(
    (event) => !filterActive || event.attendanceStatus === "no_response",
  );
  const groups = groupByMonth(visibleEvents);

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={[styles.screenContent, isDesktop && styles.screenContentDesktop]}
      showsVerticalScrollIndicator={false}
    >
      {!hideTitle ? <Text style={styles.screenTitle}>{tr("Wydarzenia", "Events")}</Text> : null}

      <View style={styles.segmented} accessibilityRole="tablist">
        {(["upcoming", "past"] as const).map((tab) => {
          const isActive = activeTab === tab;
          const count = tab === "upcoming" ? upcomingEvents.length : pastEvents.length;
          return (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              style={[styles.segment, isActive && styles.segmentActive]}
            >
              <Text style={[styles.segmentLabel, isActive && styles.segmentLabelActive]}>
                {tab === "upcoming" ? tr("Nadchodzące", "Upcoming") : tr("Minione", "Past")} ·{" "}
                {count}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {activeTab === "upcoming" && needsResponseCount > 0 ? (
        <Pressable
          onPress={() => setOnlyNeedsResponse((value) => !value)}
          accessibilityRole="button"
          accessibilityState={{ selected: onlyNeedsResponse }}
          style={[styles.filterChip, onlyNeedsResponse && styles.filterChipActive]}
        >
          <Text style={[styles.filterChipLabel, onlyNeedsResponse && styles.filterChipLabelActive]}>
            {onlyNeedsResponse ? "✓ " : "! "}
            {tr("Bez deklaracji", "No response")} · {needsResponseCount}
          </Text>
        </Pressable>
      ) : null}

      {groups.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>
            {activeTab === "upcoming"
              ? tr("Brak nadchodzących wydarzeń.", "No upcoming events.")
              : tr("Brak minionych wydarzeń.", "No past events.")}
          </Text>
          <Text style={styles.emptyCopy}>
            {tr(
              "Wątki z forum pojawią się tutaj automatycznie.",
              "Forum threads will appear here automatically.",
            )}
          </Text>
        </View>
      ) : (
        groups.map((group) => (
          <View key={group.key} style={styles.group}>
            <Text style={styles.groupLabel}>{group.label}</Text>
            <View style={styles.list}>
              {group.events.map((event, index) => {
                const date = new Date(event.startsAt);
                const isPast = activeTab === "past";
                return (
                  <Pressable
                    key={event.id}
                    onPress={() => onOpenEvent(event.id)}
                    accessibilityRole="link"
                    style={(state) => [
                      styles.row,
                      index > 0 && styles.rowDivider,
                      ((state as { hovered?: boolean }).hovered || state.pressed) &&
                        styles.rowHovered,
                    ]}
                  >
                    <View style={styles.dateAnchor}>
                      <Text style={styles.weekday}>{WARSAW_WEEKDAY.format(date)}</Text>
                      <Text style={[styles.day, isPast && styles.dayPast]}>
                        {WARSAW_DAY.format(date)}
                      </Text>
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={[styles.rowTitle, isPast && styles.rowTitlePast]} numberOfLines={2}>
                        {stripTitleDatePrefix(event.title)}
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {WARSAW_TIME.format(date)}
                        {event.venue ? ` · ${event.venue}` : ""}
                      </Text>
                    </View>
                    <StatusPill status={event.attendanceStatus} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screenScroll: {
    flex: 1,
  },
  screenContent: {
    padding: tokens.spacing.md,
    paddingTop: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  screenContentDesktop: {
    width: "100%",
    maxWidth: 880,
    alignSelf: "center",
    paddingHorizontal: tokens.spacing.xl,
    paddingTop: tokens.spacing.xl,
  },
  screenTitle: {
    fontSize: tokens.typography.hero,
    lineHeight: 36,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: tokens.colors.ink,
  },
  segmented: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: tokens.radii.md,
    backgroundColor: tokens.colors.surfaceMuted,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentActive: {
    backgroundColor: tokens.colors.surface,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  segmentLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.colors.muted,
  },
  segmentLabelActive: {
    color: tokens.colors.ink,
  },
  filterChip: {
    alignSelf: "flex-start",
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: tokens.radii.round,
    borderWidth: 1.5,
    borderColor: tokens.colors.warningBorder,
    backgroundColor: tokens.colors.warningSurface,
    justifyContent: "center",
  },
  filterChipActive: {
    backgroundColor: tokens.colors.warningBorder,
  },
  filterChipLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.colors.warningInk,
  },
  filterChipLabelActive: {
    color: tokens.colors.surface,
  },
  group: {
    gap: tokens.spacing.xs,
  },
  groupLabel: {
    fontSize: tokens.typography.caption,
    fontWeight: "600",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: tokens.colors.muted,
    paddingHorizontal: 4,
  },
  list: {
    backgroundColor: tokens.colors.surface,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.lg,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 64,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: tokens.colors.surfaceMuted,
  },
  rowHovered: {
    backgroundColor: tokens.colors.paper,
  },
  dateAnchor: {
    width: 44,
    alignItems: "center",
  },
  weekday: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    color: tokens.colors.muted,
  },
  day: {
    fontSize: 22,
    lineHeight: 24,
    fontWeight: "800",
    color: tokens.colors.ink,
  },
  dayPast: {
    color: tokens.colors.muted,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: tokens.colors.ink,
  },
  rowTitlePast: {
    color: tokens.colors.muted,
  },
  rowMeta: {
    fontSize: 13,
    color: tokens.colors.muted,
  },
  emptyBox: {
    padding: tokens.spacing.lg,
    borderRadius: tokens.radii.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: tokens.colors.borderStrong,
    gap: tokens.spacing.xs,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: tokens.colors.ink,
  },
  emptyCopy: {
    fontSize: 14,
    lineHeight: 20,
    color: tokens.colors.muted,
  },
});
