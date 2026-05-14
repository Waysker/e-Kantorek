import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { EventListItem } from "../domain/models";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { formatDateLabel } from "../utils/format";
import { SurfaceCard } from "../ui/SurfaceCard";

type EventsScreenProps = {
  events: EventListItem[];
  onOpenEvent: (eventId: string) => void;
  canRemindMissingDeclarations?: boolean;
  onRemindMissingDeclarations?: (eventId: string) => Promise<number>;
};

type EventsTab = "upcoming" | "past";

const WARSAW_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function toWarsawDateKey(value: string | Date) {
  return WARSAW_DATE_FORMAT.format(value instanceof Date ? value : new Date(value));
}

function sortByNearestUpcoming(left: EventListItem, right: EventListItem) {
  return new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime();
}

function sortByNearestPast(left: EventListItem, right: EventListItem) {
  return new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime();
}

function getAttendanceLabel(status: EventListItem["attendanceStatus"]) {
  if (status === "going") {
    return tr("Będę", "Going");
  }
  if (status === "maybe") {
    return tr("Może", "Maybe");
  }
  if (status === "not_going") {
    return tr("Nie będę", "Not going");
  }
  return tr("Brak odpowiedzi", "No response");
}

type ReminderFeedback = {
  tone: "success" | "error" | "info";
  message: string;
};

export function EventsScreen({
  events,
  onOpenEvent,
  canRemindMissingDeclarations,
  onRemindMissingDeclarations,
}: EventsScreenProps) {
  const [activeTab, setActiveTab] = useState<EventsTab>("upcoming");
  const [pendingReminderEventId, setPendingReminderEventId] = useState<string | null>(
    null,
  );
  const [feedbackByEventId, setFeedbackByEventId] = useState<
    Record<string, ReminderFeedback>
  >({});
  const todayKey = toWarsawDateKey(new Date());
  const canRemind = canRemindMissingDeclarations && Boolean(onRemindMissingDeclarations);

  const upcomingEvents = events
    .filter((event) => toWarsawDateKey(event.startsAt) >= todayKey)
    .sort(sortByNearestUpcoming);
  const pastEvents = events
    .filter((event) => toWarsawDateKey(event.startsAt) < todayKey)
    .sort(sortByNearestPast);

  const visibleEvents = activeTab === "upcoming" ? upcomingEvents : pastEvents;

  async function handleRemind(event: EventListItem) {
    if (!onRemindMissingDeclarations) {
      return;
    }

    setPendingReminderEventId(event.id);

    try {
      const notifiedCount = await onRemindMissingDeclarations(event.id);
      setFeedbackByEventId((current) => ({
        ...current,
        [event.id]:
          notifiedCount > 0
            ? {
                tone: "success",
                message: tr(
                  `Wyslano ponaglenie do ${notifiedCount} osob.`,
                  `Sent reminders to ${notifiedCount} member(s).`,
                ),
              }
            : {
                tone: "info",
                message: tr(
                  "Wszyscy sa juz zadeklarowani przy tym wydarzeniu.",
                  "Everyone has already responded for this event.",
                ),
              },
      }));
    } catch (error) {
      setFeedbackByEventId((current) => ({
        ...current,
        [event.id]: {
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : tr(
                  "Nie udalo sie wyslac ponaglenia.",
                  "Could not send reminders.",
                ),
        },
      }));
    } finally {
      setPendingReminderEventId((current) => (current === event.id ? null : current));
    }
  }

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.screenHeaderBlock}>
        <Text style={styles.kicker}>{tr("Wydarzenia", "Events")}</Text>
        <Text style={styles.screenTitle}>
          {tr("Najbliższe na górze", "Closest first by date")}
        </Text>
      </View>

      <View style={styles.tabRow}>
        <Pressable
          onPress={() => setActiveTab("upcoming")}
          style={[
            styles.tabButton,
            activeTab === "upcoming" && styles.tabButtonActive,
          ]}
        >
          <Text
            style={[
              styles.tabLabel,
              activeTab === "upcoming" && styles.tabLabelActive,
            ]}
          >
            {tr("Nadchodzące", "Upcoming")} ({upcomingEvents.length})
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab("past")}
          style={[styles.tabButton, activeTab === "past" && styles.tabButtonActive]}
        >
          <Text
            style={[styles.tabLabel, activeTab === "past" && styles.tabLabelActive]}
          >
            {tr("Archiwum", "Past")} ({pastEvents.length})
          </Text>
        </Pressable>
      </View>

      {visibleEvents.length === 0 ? (
        <SurfaceCard variant="outline">
          <Text style={styles.emptyTitle}>
            {activeTab === "upcoming"
              ? tr("Brak nadchodzących wydarzeń.", "No upcoming events.")
              : tr("Brak wydarzeń archiwalnych.", "No past events.")}
          </Text>
          <Text style={styles.emptyCopy}>
            {tr(
              "Zsynchronizowane wątki forum pojawią się tutaj automatycznie.",
              "Synced forum threads will appear here automatically.",
            )}
          </Text>
        </SurfaceCard>
      ) : (
        visibleEvents.map((event) => (
          <Pressable key={event.id} onPress={() => onOpenEvent(event.id)}>
            <SurfaceCard variant="default">
              <View style={styles.eventCardTop}>
                <Text style={styles.eventDateLabel}>
                  {formatDateLabel(event.startsAt)}
                </Text>
                <View style={styles.eventActionsColumn}>
                  <Text
                    style={[
                      styles.attendanceChip,
                      event.attendanceStatus === "going" &&
                        styles.attendanceChipPositive,
                      event.attendanceStatus === "maybe" &&
                        styles.attendanceChipMuted,
                      event.attendanceStatus === "not_going" &&
                        styles.attendanceChipNegative,
                    ]}
                  >
                    {getAttendanceLabel(event.attendanceStatus)}
                  </Text>
                  {canRemind ? (
                    <Pressable
                      style={[
                        styles.reminderButton,
                        pendingReminderEventId === event.id && styles.reminderButtonDisabled,
                      ]}
                      disabled={pendingReminderEventId === event.id}
                      onPress={(pressEvent) => {
                        pressEvent.stopPropagation();
                        void handleRemind(event);
                      }}
                    >
                      <Text style={styles.reminderButtonLabel}>
                        {pendingReminderEventId === event.id
                          ? tr("Ponaglanie...", "Sending...")
                          : tr("Ponaglij", "Remind")}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>

              <Text style={styles.cardTitle}>{event.title}</Text>
              {event.venue ? (
                <Text style={styles.cardSecondary}>{event.venue}</Text>
              ) : null}
              <Text style={styles.cardBody}>{event.preview}</Text>
              <Text style={styles.cardFooter}>
                {event.updateCount} {tr("aktualizacji", "updates")} -{" "}
                {event.commentCount} {tr("komentarzy", "comments")}
              </Text>
              {feedbackByEventId[event.id] ? (
                <Text
                  style={[
                    styles.reminderFeedback,
                    feedbackByEventId[event.id].tone === "success" &&
                      styles.reminderFeedbackSuccess,
                    feedbackByEventId[event.id].tone === "error" &&
                      styles.reminderFeedbackError,
                  ]}
                >
                  {feedbackByEventId[event.id].message}
                </Text>
              ) : null}
            </SurfaceCard>
          </Pressable>
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
    padding: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  screenHeaderBlock: {
    gap: tokens.spacing.xs,
  },
  kicker: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  screenTitle: {
    fontSize: tokens.typography.hero,
    lineHeight: 34,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  tabRow: {
    flexDirection: "row",
    gap: tokens.spacing.sm,
  },
  tabButton: {
    flex: 1,
    paddingVertical: tokens.spacing.sm,
    paddingHorizontal: tokens.spacing.md,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    alignItems: "center",
  },
  tabButtonActive: {
    backgroundColor: tokens.colors.brandTint,
    borderColor: tokens.colors.brand,
  },
  tabLabel: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  tabLabelActive: {
    color: tokens.colors.brand,
  },
  emptyTitle: {
    fontSize: tokens.typography.title,
    lineHeight: 28,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  emptyCopy: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.body,
    lineHeight: 22,
    color: tokens.colors.muted,
  },
  eventCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: tokens.spacing.sm,
  },
  eventActionsColumn: {
    alignItems: "flex-end",
    gap: tokens.spacing.xs,
  },
  eventDateLabel: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  attendanceChip: {
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: 6,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.surfaceMuted,
    color: tokens.colors.muted,
    overflow: "hidden",
    fontSize: tokens.typography.caption,
    fontWeight: "700",
  },
  attendanceChipPositive: {
    backgroundColor: tokens.colors.successSurface,
    color: tokens.colors.successInk,
  },
  attendanceChipMuted: {
    backgroundColor: tokens.colors.surfaceMuted,
    color: tokens.colors.muted,
  },
  attendanceChipNegative: {
    backgroundColor: tokens.colors.dangerSurface,
    color: tokens.colors.dangerInk,
  },
  reminderButton: {
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: 6,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.brandTint,
    borderWidth: 1,
    borderColor: tokens.colors.brand,
  },
  reminderButtonDisabled: {
    opacity: 0.75,
  },
  reminderButtonLabel: {
    color: tokens.colors.brand,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
  },
  cardTitle: {
    marginTop: tokens.spacing.sm,
    fontSize: tokens.typography.title,
    lineHeight: 28,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  cardSecondary: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    color: tokens.colors.muted,
  },
  cardBody: {
    marginTop: tokens.spacing.sm,
    fontSize: tokens.typography.body,
    lineHeight: 23,
    color: tokens.colors.ink,
  },
  cardFooter: {
    marginTop: tokens.spacing.md,
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
  },
  reminderFeedback: {
    marginTop: tokens.spacing.sm,
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  reminderFeedbackSuccess: {
    color: tokens.colors.successInk,
  },
  reminderFeedbackError: {
    color: tokens.colors.dangerInk,
  },
});
