import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import type { EventListItem } from "../domain/models";
import { appLocaleTag, tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { EventRow } from "../ui/EventRow";
import { EmptyState } from "../ui/EmptyState";
import { Card } from "../ui/Card";
import { textStyles } from "../theme/text";
import { Chip } from "../ui/Chip";
import { SegmentedControl } from "../ui/SegmentedControl";

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

      <SegmentedControl
        options={[
          { key: "upcoming", label: `${tr("Nadchodzące", "Upcoming")} · ${upcomingEvents.length}` },
          { key: "past", label: `${tr("Minione", "Past")} · ${pastEvents.length}` },
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "upcoming" && needsResponseCount > 0 ? (
        <View style={styles.filterRow}>
          <Chip
            tone="action"
            label={`${onlyNeedsResponse ? "✓" : "!"} ${tr("Bez deklaracji", "No response")} · ${needsResponseCount}`}
            selected={onlyNeedsResponse}
            onPress={() => setOnlyNeedsResponse((value) => !value)}
          />
        </View>
      ) : null}

      {groups.length === 0 ? (
        <EmptyState
          title={
            activeTab === "upcoming"
              ? tr("Brak nadchodzących wydarzeń.", "No upcoming events.")
              : tr("Brak minionych wydarzeń.", "No past events.")
          }
        >
          {tr(
            "Wątki z forum pojawią się tutaj automatycznie.",
            "Forum threads will appear here automatically.",
          )}
        </EmptyState>
      ) : (
        groups.map((group) => (
          <View key={group.key} style={styles.group}>
            <Text style={styles.groupLabel}>{group.label}</Text>
            <Card variant="list">
              {group.events.map((event, index) => (
                <EventRow
                  key={event.id}
                  event={event}
                  index={index}
                  isPast={activeTab === "past"}
                  onPress={() => onOpenEvent(event.id)}
                />
              ))}
            </Card>
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
  screenTitle: textStyles.screenTitle,
  filterRow: {
    flexDirection: "row",
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
});
