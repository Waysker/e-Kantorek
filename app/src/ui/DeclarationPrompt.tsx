import { Pressable, Text, View } from "react-native";

import type { EventListItem } from "../domain/models";
import { getForumThreadUrl, openForumThread } from "../domain/forumLinks";
import { appLocaleTag, tr } from "../i18n";
import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";
import { stripTitleDatePrefix } from "../utils/format";
import { Button } from "./Button";

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
          <Button
            size="lg"
            style={styles.primaryAction}
            label={tr("Zadeklaruj na forum", "Declare on the forum")}
            trailingIcon="external"
            accessibilityRole="link"
            onPress={() => openForumThread(next.id)}
          />
        ) : null}
        <Button
          size="lg"
          variant="secondary"
          label={tr("Szczegóły", "Details")}
          onPress={() => onOpenEvent(next.id)}
        />
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

const styles = themedStyles((colors) => ({
  card: {
    backgroundColor: colors.warningSurface,
    borderWidth: 1.5,
    borderColor: colors.warningBorder,
    borderRadius: tokens.radii.lg,
    padding: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  kicker: {
    fontSize: tokens.typography.caption,
    fontWeight: "600",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: colors.warningInk,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.ink,
  },
  meta: {
    marginTop: 2,
    fontSize: 14,
    color: colors.muted,
  },
  actions: {
    flexDirection: "row",
    gap: tokens.spacing.xs,
  },
  primaryAction: {
    flex: 1,
  },
  hint: {
    fontSize: tokens.typography.caption,
    lineHeight: 17,
    color: colors.warningInk,
  },
}));
