import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import type { EventDetail } from "../domain/models";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { formatDateLabel, formatRelativeLabel } from "../utils/format";
import { AttendanceSummaryStrip } from "../ui/AttendanceSummaryStrip";
import { SurfaceCard } from "../ui/SurfaceCard";

type EventDetailScreenProps = {
  event: EventDetail;
  onBack: () => void;
  onOpenAttendance: () => void;
  onOpenSetlist: () => void;
};

export function EventDetailScreen({
  event,
  onBack,
  onOpenAttendance,
  onOpenSetlist,
}: EventDetailScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={[
        styles.screenContent,
        isDesktop && styles.desktopContent,
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Pressable onPress={onBack} style={styles.backLink}>
        <Text style={styles.backLinkLabel}>
          {tr("Wróć do wydarzeń", "Back to Events")}
        </Text>
      </Pressable>

      <View style={[styles.desktopSplit, isDesktop && styles.desktopSplitActive]}>
        <View style={styles.desktopPrimaryColumn}>
          <SurfaceCard variant="brandTint">
            <Text style={styles.cardEyebrow}>{formatDateLabel(event.startsAt)}</Text>
            <Text style={styles.screenTitle}>{event.title}</Text>
            {event.venue ? (
              <Text style={styles.cardSecondary}>{event.venue}</Text>
            ) : null}
            <Text style={styles.cardBody}>{event.description}</Text>

            {event.updates.length > 0 ? (
              event.updates.map((update) => (
                <View key={update.id} style={styles.updateBlock}>
                  <Text style={styles.updateMeta}>
                    {update.authorName} - {formatRelativeLabel(update.createdAt)}
                  </Text>
                  <Text style={styles.updateBody}>{update.body}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.cardSecondary}>
                {tr(
                  "Brak osobnych aktualizacji organizatorów w tym wątku.",
                  "No separate organizer updates were imported from this thread yet.",
                )}
              </Text>
            )}
          </SurfaceCard>

          <SurfaceCard variant="default">
            <View style={styles.cardActionRow}>
              <View style={styles.cardActionCopy}>
                <Text style={styles.cardEyebrow}>
                  {tr("Deklaracje RSVP i skład", "RSVP declarations and roster")}
                </Text>
              </View>
              <Pressable onPress={onOpenAttendance} style={styles.inlineButton}>
                <Text style={styles.inlineButtonLabel}>{tr("Otwórz", "Open")}</Text>
              </Pressable>
            </View>
            <AttendanceSummaryStrip summary={event.attendanceSummary} />
          </SurfaceCard>

          {!isDesktop ? (
            <SurfaceCard variant="default">
              <View style={styles.cardActionRow}>
                <View style={styles.cardActionCopy}>
                  <Text style={styles.cardEyebrow}>Setlista</Text>
                </View>
                <Pressable onPress={onOpenSetlist} style={styles.inlineButton}>
                  <Text style={styles.inlineButtonLabel}>{tr("Otwórz", "Open")}</Text>
                </Pressable>
              </View>
              <Text style={styles.cardBody}>{event.setlist.preview}</Text>
            </SurfaceCard>
          ) : null}

          <SurfaceCard variant="outline">
            <Text style={styles.cardEyebrow}>{tr("Komentarze", "Comments")}</Text>
            <Text style={styles.cardTitle}>
              {tr("Dyskusja członków", "Member discussion")}
            </Text>
            {event.comments.length > 0 ? (
              event.comments.map((comment) => (
                <View key={comment.id} style={styles.commentRow}>
                  <Text style={styles.updateMeta}>
                    {comment.authorName} - {formatRelativeLabel(comment.createdAt)}
                  </Text>
                  <Text style={styles.cardBody}>{comment.body}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.cardSecondary}>
                {tr(
                  "Brak odpowiedzi członków zaimportowanych z forum.",
                  "No member replies were imported from the forum thread yet.",
                )}
              </Text>
            )}
          </SurfaceCard>
        </View>

        {isDesktop ? (
          <View style={styles.desktopRail}>
            <SurfaceCard variant="paper">
              <View style={styles.setlistRailHeader}>
                <Text style={styles.cardTitle}>Setlista</Text>
                <Pressable onPress={onOpenSetlist} style={styles.inlineButton}>
                  <Text style={styles.inlineButtonLabel}>
                    {tr("Pełny ekran", "Fullscreen")}
                  </Text>
                </Pressable>
              </View>
              {event.setlist.sections.map((section) => (
                <View key={section.id} style={styles.setlistSectionBlock}>
                  <Text style={styles.setlistSectionTitle}>{section.title}</Text>
                  {section.items.map((item, itemIndex) => (
                    <Text key={item.id} style={styles.setlistListText}>
                      {itemIndex + 1}. {item.label}
                      {item.detail ? ` - ${item.detail}` : ""}
                    </Text>
                  ))}
                </View>
              ))}
            </SurfaceCard>
          </View>
        ) : null}
      </View>
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
  desktopContent: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 1200,
  },
  backLink: {
    marginBottom: tokens.spacing.xs,
  },
  backLinkLabel: {
    color: tokens.colors.brand,
    fontWeight: "700",
  },
  desktopSplit: {
    gap: tokens.spacing.md,
  },
  desktopSplitActive: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  desktopPrimaryColumn: {
    flex: 1,
    gap: tokens.spacing.md,
  },
  desktopRail: {
    width: 320,
  },
  cardEyebrow: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: tokens.colors.muted,
    marginBottom: tokens.spacing.xs,
    fontWeight: "700",
  },
  screenTitle: {
    fontSize: tokens.typography.hero,
    lineHeight: 34,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  cardTitle: {
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
  updateBlock: {
    marginTop: tokens.spacing.md,
    paddingTop: tokens.spacing.md,
    borderTopWidth: 1,
    borderTopColor: tokens.colors.border,
    gap: tokens.spacing.xs,
  },
  updateMeta: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  updateBody: {
    fontSize: tokens.typography.body,
    lineHeight: 22,
    color: tokens.colors.ink,
  },
  cardActionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.spacing.sm,
  },
  cardActionCopy: {
    flex: 1,
  },
  inlineButton: {
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.brand,
  },
  inlineButtonLabel: {
    color: tokens.colors.surface,
    fontWeight: "700",
  },
  commentRow: {
    marginTop: tokens.spacing.md,
    paddingTop: tokens.spacing.md,
    borderTopWidth: 1,
    borderTopColor: tokens.colors.border,
    gap: tokens.spacing.xs,
  },
  setlistRailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.spacing.sm,
  },
  setlistSectionBlock: {
    marginTop: tokens.spacing.md,
    gap: tokens.spacing.xs,
  },
  setlistSectionTitle: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "700",
  },
  setlistListText: {
    fontSize: tokens.typography.body,
    lineHeight: 20,
    color: tokens.colors.ink,
  },
});
