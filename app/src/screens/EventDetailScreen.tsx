import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import type { AttendanceStatus, EventDetail } from "../domain/models";
import { getForumThreadUrl, openForumThread } from "../domain/forumLinks";
import { cleanSetlistLabel, isPlaceholderSetlist } from "../domain/setlist";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { Button } from "../ui/Button";
import { textStyles } from "../theme/text";
import { formatDateLabel, formatRelativeLabel, stripTitleDatePrefix } from "../utils/format";
import type { AttendanceSummaryFocusStatus } from "../ui/AttendanceSummaryStrip";
import { Icon } from "../ui/Icon";
import { StatusPill, statusMeta } from "../ui/StatusPill";

type EventDetailScreenProps = {
  event: EventDetail;
  onBack: () => void;
  onOpenAttendance: (focusStatus?: AttendanceSummaryFocusStatus) => void;
  onOpenSetlist: () => void;
  canRemindMissingDeclarations?: boolean;
  onRemindMissingDeclarations?: () => Promise<{
    notifiedCount: number;
    notifiedFullNames: string[];
  }>;
};

type ReminderFeedback = {
  tone: "success" | "error" | "info";
  message: string;
};

type ReminderPopupState = {
  title: string;
  intro: string;
  lines: string[];
  footer: string | null;
};

function buildReminderPopupState(
  names: string[],
  notifiedCount: number,
): ReminderPopupState {
  if (notifiedCount <= 0) {
    return {
      title: tr("Ponaglenie wysłane", "Reminder sent"),
      intro: tr(
        "Brak osób do ponaglenia przy tym wydarzeniu.",
        "There are no members left to remind for this event.",
      ),
      lines: [],
      footer: null,
    };
  }

  if (names.length === 0) {
    return {
      title: tr("Ponaglenie wysłane", "Reminder sent"),
      intro: tr(
        `Wysłano ponaglenie do ${notifiedCount} osób.`,
        `Sent reminders to ${notifiedCount} member(s).`,
      ),
      lines: [],
      footer: null,
    };
  }

  const MAX_NAMES = 20;
  const shownNames = names.slice(0, MAX_NAMES);
  const hiddenCount = Math.max(names.length - shownNames.length, 0);
  return {
    title: tr("Ponaglenie wysłane", "Reminder sent"),
    intro: tr(
      `Wysłano ponaglenie do ${notifiedCount} osób:`,
      `Sent reminders to ${notifiedCount} member(s):`,
    ),
    lines: shownNames.map((name, index) => `${index + 1}. ${name}`),
    footer:
      hiddenCount > 0
        ? tr(`+ ${hiddenCount} kolejnych osób`, `+ ${hiddenCount} more member(s)`)
        : null,
  };
}

export function EventDetailScreen({
  event,
  onBack,
  onOpenAttendance,
  onOpenSetlist,
  canRemindMissingDeclarations,
  onRemindMissingDeclarations,
}: EventDetailScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;
  const canRemind = canRemindMissingDeclarations && Boolean(onRemindMissingDeclarations);
  const [isReminding, setIsReminding] = useState(false);
  const [reminderFeedback, setReminderFeedback] = useState<ReminderFeedback | null>(null);
  const [reminderPopup, setReminderPopup] = useState<ReminderPopupState | null>(null);

  async function handleRemindPress() {
    if (!onRemindMissingDeclarations) {
      return;
    }

    setIsReminding(true);
    setReminderFeedback(null);

    try {
      const { notifiedCount, notifiedFullNames } = await onRemindMissingDeclarations();
      setReminderFeedback(
        notifiedCount > 0
          ? {
              tone: "success",
              message: tr(
                `Wysłano ponaglenie do ${notifiedCount} osób.`,
                `Sent reminders to ${notifiedCount} member(s).`,
              ),
            }
          : {
              tone: "info",
              message: tr(
                "Wszyscy są już zadeklarowani przy tym wydarzeniu.",
                "Everyone has already responded for this event.",
              ),
            },
      );
      setReminderPopup(buildReminderPopupState(notifiedFullNames, notifiedCount));
    } catch (error) {
      setReminderFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : tr("Nie udało się wysłać ponaglenia.", "Could not send reminders."),
      });
    } finally {
      setIsReminding(false);
    }
  }

  const forumUrl = getForumThreadUrl(event.id);
  const needsDeclaration = event.attendanceStatus === "no_response";
  const summary = event.attendanceSummary;
  const stats: Array<{
    key: AttendanceStatus;
    value: number;
    label: string;
    focus?: AttendanceSummaryFocusStatus;
  }> = [
    // Only "going" and "not going": the forum poll has no "maybe", and we don't
    // know the full roster, so "no response" can't be counted.
    { key: "going", value: summary.going, label: tr("będzie", "going"), focus: "going" },
    { key: "not_going", value: summary.notGoing, label: tr("nie będzie", "not going"), focus: "not_going" },
  ];
  const hasSetlist = !isPlaceholderSetlist(event.setlist);
  const setlistCount = hasSetlist
    ? event.setlist.sections.reduce((count, section) => count + section.items.length, 0)
    : 0;

  const setlistCard = (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.kicker}>
          {tr("Setlista", "Setlist")}
          {setlistCount > 0 ? ` · ${setlistCount}` : ""}
        </Text>
        {hasSetlist ? (
          <Pressable onPress={onOpenSetlist} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.linkLabel}>{tr("Tryb pulpitu ›", "Stand mode ›")}</Text>
          </Pressable>
        ) : null}
      </View>
      {!hasSetlist ? (
        <Text style={styles.muted}>
          {tr(
            "Setlisty jeszcze nie ma. Pojawi się, gdy organizator wrzuci ją do wątku.",
            "No setlist yet. It appears once the organizer posts it in the thread.",
          )}
        </Text>
      ) : null}
      {(hasSetlist ? event.setlist.sections : []).map((section) => (
        <View key={section.id}>
          {event.setlist.sections.length > 1 ? (
            <Text style={styles.setlistSectionTitle}>{section.title}</Text>
          ) : null}
          {section.items.map((item, itemIndex) => (
            <View key={item.id} style={styles.setlistRow}>
              <Text style={styles.setlistIndex}>{itemIndex + 1}</Text>
              <Text style={styles.setlistLabel}>
                {cleanSetlistLabel(item.label)}
                {item.detail ? <Text style={styles.muted}>{` · ${item.detail}`}</Text> : null}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );

  return (
    <>
      <ScrollView style={styles.screenScroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.hero, isDesktop && styles.heroDesktop]}>
          <View style={styles.inner}>
            <View style={styles.heroTopRow}>
              <Pressable
                onPress={onBack}
                style={styles.heroButton}
                accessibilityRole="button"
                accessibilityLabel={tr("Wróć do wydarzeń", "Back to events")}
              >
                <Icon name="chevronLeft" size={20} color={tokens.colors.surface} strokeWidth={2.2} />
                {isDesktop ? (
                  <Text style={styles.heroButtonLabel}>{tr("Wydarzenia", "Events")}</Text>
                ) : null}
              </Pressable>
              {forumUrl ? (
                <Pressable
                  onPress={() => openForumThread(event.id)}
                  style={styles.heroButton}
                  accessibilityRole="link"
                >
                  <Text style={styles.heroButtonLabel}>{tr("Wątek na forum", "Forum thread")}</Text>
                  <Icon name="external" size={14} color={tokens.colors.surface} strokeWidth={2.2} />
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.heroKicker}>{formatDateLabel(event.startsAt)}</Text>
            <Text style={[styles.heroTitle, isDesktop && styles.heroTitleDesktop]}>
              {stripTitleDatePrefix(event.title)}
            </Text>
            {event.venue ? <Text style={styles.heroVenue}>{event.venue}</Text> : null}
          </View>
        </View>

        <View style={[styles.inner, styles.body]}>
          <View style={[styles.columns, isDesktop && styles.columnsDesktop]}>
            <View style={styles.primaryColumn}>
              <View style={[styles.card, needsDeclaration && styles.cardAction]}>
                <View style={styles.cardHeaderRow}>
                  <Text style={[styles.kicker, needsDeclaration && styles.kickerAction]}>
                    {tr("Twoja deklaracja", "Your declaration")}
                  </Text>
                  <StatusPill status={event.attendanceStatus} large />
                </View>
                {forumUrl ? (
                  <Button
                    size="lg"
                    variant={needsDeclaration ? "primary" : "secondary"}
                    label={
                      needsDeclaration
                        ? tr("Zadeklaruj na forum", "Declare on the forum")
                        : tr("Zmień na forum", "Change on the forum")
                    }
                    trailingIcon="external"
                    accessibilityRole="link"
                    onPress={() => openForumThread(event.id)}
                  />
                ) : null}
                <Text style={styles.hint}>
                  {tr(
                    "Deklaracja to ankieta w wątku. Zmiana pojawi się tutaj po synchronizacji (do ~20 min).",
                    "Declarations are a poll in the thread. Changes show up here after the next sync (up to ~20 min).",
                  )}
                </Text>
              </View>

              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.kicker}>{tr("Skład", "Line-up")}</Text>
                  {canRemind ? (
                    <Pressable
                      onPress={() => void handleRemindPress()}
                      style={[styles.smallButton, isReminding && styles.smallButtonDisabled]}
                      disabled={isReminding}
                      accessibilityRole="button"
                    >
                      <Text style={styles.smallButtonLabel}>
                        {isReminding ? tr("Wysyłanie…", "Sending…") : tr("Ponaglij", "Remind")}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.statsRow}>
                  {stats.map((item) => {
                    const meta = statusMeta(item.key);
                    const focus = item.focus;
                    return (
                      <Pressable
                        key={item.key}
                        disabled={!focus}
                        onPress={focus ? () => onOpenAttendance(focus) : undefined}
                        accessibilityRole={focus ? "button" : undefined}
                        style={[
                          styles.stat,
                          { backgroundColor: meta.bg },
                          meta.needsAction && { borderColor: meta.accent },
                        ]}
                      >
                        <Text style={[styles.statValue, { color: meta.fg }]}>{item.value}</Text>
                        <Text style={[styles.statLabel, { color: meta.fg }]}>{item.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable onPress={() => onOpenAttendance("going")} accessibilityRole="link">
                  <Text style={styles.linkLabel}>{tr("Kto gra ›", "Who's playing ›")}</Text>
                </Pressable>
                {reminderFeedback ? (
                  <Text
                    style={[
                      styles.reminderFeedback,
                      reminderFeedback.tone === "success" && styles.reminderFeedbackSuccess,
                      reminderFeedback.tone === "error" && styles.reminderFeedbackError,
                    ]}
                  >
                    {reminderFeedback.message}
                  </Text>
                ) : null}
              </View>

              {!isDesktop ? setlistCard : null}

              {event.description ? (
                <View style={styles.card}>
                  <Text style={styles.kicker}>{tr("Opis", "Details")}</Text>
                  <Text style={styles.bodyText}>{event.description}</Text>
                </View>
              ) : null}

              <View style={styles.card}>
                <Text style={styles.kicker}>
                  {tr("Aktualizacje organizatora", "Organizer updates")}
                </Text>
                {event.updates.length > 0 ? (
                  event.updates.map((update, index) => (
                    <View key={update.id} style={[styles.update, index === 0 && styles.updateLatest]}>
                      <Text style={styles.meta}>
                        {update.authorName} · {formatRelativeLabel(update.createdAt)}
                      </Text>
                      <Text style={styles.bodyText}>{update.body}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.muted}>
                    {tr("Brak aktualizacji od organizatorów.", "No organizer updates yet.")}
                  </Text>
                )}
              </View>

              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.kicker}>
                    {tr("Dyskusja", "Discussion")}
                    {event.comments.length > 0 ? ` · ${event.comments.length}` : ""}
                  </Text>
                  {forumUrl ? (
                    <Pressable
                      onPress={() => openForumThread(event.id)}
                      accessibilityRole="link"
                      hitSlop={8}
                    >
                      <Text style={styles.linkLabel}>
                        {tr("Odpowiedz na forum ↗", "Reply on the forum ↗")}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                {event.comments.length > 0 ? (
                  event.comments.map((comment) => (
                    <View key={comment.id} style={styles.comment}>
                      <Text style={styles.meta}>
                        {comment.authorName} · {formatRelativeLabel(comment.createdAt)}
                      </Text>
                      <Text style={styles.bodyText}>{comment.body}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.muted}>
                    {tr("Brak komentarzy w wątku na forum.", "No comments in the forum thread yet.")}
                  </Text>
                )}
              </View>
            </View>

            {isDesktop ? <View style={styles.rail}>{setlistCard}</View> : null}
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={reminderPopup !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setReminderPopup(null)}
      >
        <View style={styles.popupOverlay}>
          <View style={styles.popupCard}>
            <Text style={styles.popupTitle}>
              {reminderPopup?.title ?? tr("Ponaglenie wysłane", "Reminder sent")}
            </Text>
            <Text style={styles.popupIntro}>
              {reminderPopup?.intro ?? ""}
            </Text>
            {reminderPopup?.lines.map((line) => (
              <Text key={line} style={styles.popupLine}>
                {line}
              </Text>
            ))}
            {reminderPopup?.footer ? (
              <Text style={styles.popupFooter}>{reminderPopup.footer}</Text>
            ) : null}
            <Pressable
              onPress={() => setReminderPopup(null)}
              style={styles.popupCloseButton}
            >
              <Text style={styles.popupCloseButtonLabel}>{tr("OK", "OK")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screenScroll: {
    flex: 1,
  },
  inner: {
    width: "100%",
    maxWidth: 1080,
    alignSelf: "center",
  },
  hero: {
    backgroundColor: tokens.colors.brandDeep,
    paddingHorizontal: tokens.spacing.md,
    paddingTop: tokens.spacing.sm,
    paddingBottom: tokens.spacing.lg,
  },
  heroDesktop: {
    paddingHorizontal: 48,
    paddingTop: 28,
    paddingBottom: 32,
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: tokens.spacing.md,
  },
  heroButton: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    borderRadius: tokens.radii.md,
    backgroundColor: tokens.colors.brandDeepRaised,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  heroButtonLabel: {
    color: tokens.colors.surface,
    fontSize: 14,
    fontWeight: "600",
  },
  heroKicker: {
    color: tokens.colors.brandDeepAccent,
    fontSize: tokens.typography.caption,
    fontWeight: "600",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  heroTitle: {
    marginTop: 6,
    color: tokens.colors.surface,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  heroTitleDesktop: {
    fontSize: 44,
    lineHeight: 48,
  },
  heroVenue: {
    marginTop: tokens.spacing.xs,
    color: tokens.colors.brandDeepMuted,
    fontSize: 15,
  },
  body: {
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.md,
  },
  columns: {
    gap: tokens.spacing.md,
  },
  columnsDesktop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tokens.spacing.lg,
    paddingTop: tokens.spacing.sm,
  },
  primaryColumn: {
    flex: 1,
    minWidth: 0,
    gap: tokens.spacing.md,
  },
  rail: {
    width: 340,
  },
  card: {
    backgroundColor: tokens.colors.surface,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.lg,
    padding: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  cardAction: {
    backgroundColor: tokens.colors.warningSurface,
    borderColor: tokens.colors.warningBorder,
    borderWidth: 1.5,
  },
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.spacing.sm,
  },
  kicker: textStyles.kicker,
  kickerAction: {
    color: tokens.colors.warningInk,
  },
  hint: {
    fontSize: tokens.typography.caption,
    lineHeight: 17,
    color: tokens.colors.muted,
  },
  statsRow: {
    flexDirection: "row",
    gap: tokens.spacing.xs,
  },
  stat: {
    flex: 1,
    alignItems: "center",
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radii.md,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  statValue: {
    fontSize: 22,
    fontWeight: "800",
  },
  statLabel: {
    fontSize: tokens.typography.caption,
    fontWeight: "600",
  },
  linkLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.colors.brand,
  },
  smallButton: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: tokens.radii.sm,
    backgroundColor: tokens.colors.brand,
    justifyContent: "center",
  },
  smallButtonDisabled: {
    opacity: 0.7,
  },
  smallButtonLabel: {
    color: tokens.colors.surface,
    fontWeight: "600",
    fontSize: 14,
  },
  reminderFeedback: {
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    color: tokens.colors.muted,
    fontWeight: "600",
  },
  reminderFeedbackSuccess: {
    color: tokens.colors.successInk,
  },
  reminderFeedbackError: {
    color: tokens.colors.dangerInk,
  },
  bodyText: {
    fontSize: tokens.typography.body,
    lineHeight: 24,
    color: tokens.colors.ink,
  },
  muted: {
    fontSize: 14,
    color: tokens.colors.muted,
  },
  meta: {
    fontSize: 13,
    color: tokens.colors.muted,
  },
  update: {
    gap: 4,
    paddingLeft: 12,
    borderLeftWidth: 3,
    borderLeftColor: tokens.colors.border,
  },
  updateLatest: {
    borderLeftColor: tokens.colors.brand,
  },
  comment: {
    gap: 4,
    paddingTop: tokens.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: tokens.colors.surfaceMuted,
  },
  setlistSectionTitle: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.caption,
    fontWeight: "600",
    textTransform: "uppercase",
    color: tokens.colors.muted,
  },
  setlistRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: tokens.colors.surfaceMuted,
  },
  setlistIndex: {
    width: 20,
    fontSize: 15,
    color: tokens.colors.muted,
  },
  setlistLabel: {
    flex: 1,
    fontSize: 15,
    color: tokens.colors.ink,
  },
  popupOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: tokens.spacing.lg,
  },
  popupCard: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radii.lg,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    padding: tokens.spacing.lg,
    gap: tokens.spacing.xs,
  },
  popupTitle: {
    fontSize: tokens.typography.title,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  popupIntro: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.body,
    color: tokens.colors.ink,
  },
  popupLine: {
    fontSize: tokens.typography.body,
    lineHeight: 22,
    color: tokens.colors.ink,
  },
  popupFooter: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  popupCloseButton: {
    marginTop: tokens.spacing.md,
    alignSelf: "flex-end",
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.brand,
  },
  popupCloseButtonLabel: {
    color: tokens.colors.surface,
    fontWeight: "700",
  },
});
