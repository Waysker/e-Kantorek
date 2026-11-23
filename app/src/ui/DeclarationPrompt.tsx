import { Pressable, StyleSheet, Text, View } from "react-native";

import type { EventListItem } from "../domain/models";
import { getForumThreadUrl, openForumThread } from "../domain/forumLinks";
import { appLocaleTag, tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { stripTitleDatePrefix } from "../utils/format";
import { Icon } from "./Icon";

const WHEN = new Intl.DateTimeFormat(appLocaleTag, {
  timeZone: "Europe/Warsaw",
  weekday: "short",
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

// "2 wydarzenia czekają", "5 wydarzeń czeka" (Polish plural rules).
function polishEventsWaiting(count: number) {
  const lastDigit = count % 10;
  const lastTwo = count % 100;
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return "wydarzenia czekają";
  }
  return "wydarzeń czeka";
}

type DeclarationPromptProps = {
  /** Upcoming events without the user's declaration, soonest first. */
  events: EventListItem[];
  onOpenEvent: (eventId: string) => void;
};

// The one loud element of the app: an event waits for the user's declaration.
// Declaring happens in the forum poll, so the main action opens the thread.
export function DeclarationPrompt({ events, onOpenEvent }: DeclarationPromptProps) {
  const next = events[0];
  if (!next) {
    return null;
  }
  const hasForumLink = getForumThreadUrl(next.id) !== null;
  const others = events.length - 1;

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>
        {events.length === 1
          ? tr("Czeka na Twoją deklarację", "Waiting for your declaration")
          : tr(
              `${events.length} ${polishEventsWaiting(events.length)} na Twoją deklarację`,
              `${events.length} events wait for your declaration`,
            )}
      </Text>
      <Pressable onPress={() => onOpenEvent(next.id)} accessibilityRole="link">
        <Text style={styles.title}>{stripTitleDatePrefix(next.title)}</Text>
        <Text style={styles.meta}>
          {WHEN.format(new Date(next.startsAt))}
          {next.venue ? ` · ${next.venue}` : ""}
        </Text>
      </Pressable>
      <View style={styles.actions}>
        {hasForumLink ? (
          <Pressable
            onPress={() => openForumThread(next.id)}
            accessibilityRole="link"
            style={styles.primaryButton}
          >
            <Text style={styles.primaryLabel}>{tr("Zadeklaruj na forum", "Declare on the forum")}</Text>
            <Icon name="external" size={16} color={tokens.colors.surface} strokeWidth={2.2} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => onOpenEvent(next.id)}
          accessibilityRole="button"
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryLabel}>{tr("Szczegóły", "Details")}</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>
        {others > 0
          ? tr(
              `I jeszcze ${others}. Status zmieni się tutaj po synchronizacji (do ~20 min).`,
              `And ${others} more. Status updates here after the next sync (up to ~20 min).`,
            )
          : tr(
              "Status zmieni się tutaj po synchronizacji (do ~20 min).",
              "Status updates here after the next sync (up to ~20 min).",
            )}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.colors.warningSurface,
    borderWidth: 1.5,
    borderColor: tokens.colors.warningBorder,
    borderRadius: tokens.radii.lg,
    padding: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  kicker: {
    fontSize: tokens.typography.caption,
    fontWeight: "600",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: tokens.colors.warningInk,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: tokens.colors.ink,
  },
  meta: {
    marginTop: 2,
    fontSize: 14,
    color: tokens.colors.muted,
  },
  actions: {
    flexDirection: "row",
    gap: tokens.spacing.xs,
  },
  primaryButton: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: tokens.spacing.md,
    borderRadius: tokens.radii.md,
    backgroundColor: tokens.colors.brand,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: tokens.colors.surface,
  },
  secondaryButton: {
    minHeight: 46,
    paddingHorizontal: tokens.spacing.md,
    borderRadius: tokens.radii.md,
    borderWidth: 1,
    borderColor: tokens.colors.borderStrong,
    backgroundColor: tokens.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: tokens.colors.ink,
  },
  hint: {
    fontSize: tokens.typography.caption,
    lineHeight: 17,
    color: tokens.colors.warningInk,
  },
});
