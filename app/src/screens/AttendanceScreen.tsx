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
import { AttendanceSummaryStrip } from "../ui/AttendanceSummaryStrip";
import { InstrumentRosterGrid } from "../ui/InstrumentRosterGrid";
import { SurfaceCard } from "../ui/SurfaceCard";

type AttendanceScreenProps = {
  event: EventDetail;
  onBack: () => void;
};

export function AttendanceScreen({ event, onBack }: AttendanceScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;
  const options = [
    { key: "going", label: tr("Będę", "Going") },
    { key: "maybe", label: tr("Może", "Maybe") },
    { key: "not_going", label: tr("Nie będę", "Not going") },
  ] as const;

  const responseSelector = (
    <View style={styles.responseSelector}>
      {options.map((option) => {
        const isActive = event.attendanceSummary.userStatus === option.key;

        return (
          <View
            key={option.key}
            style={[
              styles.responsePill,
              isActive && styles.responsePillActive,
              !isDesktop && styles.responsePillMobile,
            ]}
          >
            <Text
              style={[
                styles.responsePillLabel,
                isActive && styles.responsePillLabelActive,
              ]}
            >
              {option.label}
            </Text>
            <Text style={styles.responsePillMeta}>
              {isActive ? tr("Zaimportowane", "Imported") : tr("Tylko odczyt", "Read-only")}
            </Text>
          </View>
        );
      })}
    </View>
  );

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
        <Text style={styles.backLinkLabel}>{tr("Wróć do wydarzenia", "Back to Event")}</Text>
      </Pressable>

      {isDesktop ? (
        <View style={styles.headerSplitDesktop}>
          <SurfaceCard variant="default" style={styles.headerPrimary}>
            <Text style={styles.cardEyebrow}>
              {tr("Obecność i skład", "Attendance and roster")}
            </Text>
            <Text style={styles.screenTitle}>{event.title}</Text>
            <Text style={styles.cardSecondary}>
              {tr(
                "Wersja tylko do odczytu z forum. Najważniejszy element to grupowanie sekcji poniżej.",
                "Read-only forum prototype. The important part in this phase is the grouped section roster below.",
              )}
            </Text>
            <AttendanceSummaryStrip summary={event.attendanceSummary} />
          </SurfaceCard>

          <SurfaceCard variant="outline" style={styles.headerSecondary}>
            <Text style={styles.cardEyebrow}>{tr("Twoja odpowiedź", "Your response")}</Text>
            {responseSelector}
          </SurfaceCard>
        </View>
      ) : (
        <SurfaceCard variant="default">
          <Text style={styles.cardEyebrow}>
            {tr("Obecność i skład", "Attendance and roster")}
          </Text>
          <Text style={styles.screenTitle}>{event.title}</Text>
          <Text style={styles.cardSecondary}>
            {tr(
              "Dane na żywo z ankiety forum, tylko do odczytu.",
              "Live read-only import from the forum poll.",
            )}
          </Text>

          <View style={styles.mobileSummaryRow}>
            <AttendanceSummaryStrip summary={event.attendanceSummary} compact />
          </View>

          <View style={styles.mobileResponseBlock}>
            <Text style={styles.mobileResponseTitle}>
              {tr("Twoja odpowiedź", "Your response")}
            </Text>
            {responseSelector}
          </View>
        </SurfaceCard>
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {isDesktop
            ? tr("Grupy według instrumentu", "Grouped by instrument")
            : tr("Według instrumentu", "By instrument")}
        </Text>
        <Text style={styles.sectionCopy}>
          {isDesktop
            ? tr(
                "Obecność i skład są teraz pokazane w jednym, grupowanym układzie.",
                "Attendance and squad composition now live in one grouped layout.",
              )
            : tr(
                "Jeden grupowany widok zamiast oddzielnych stron obecności i składu.",
                "One grouped roster instead of separate attendance and squad pages.",
              )}
        </Text>
      </View>

      <InstrumentRosterGrid groups={event.squad.groups} />
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
  headerSplitDesktop: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: tokens.spacing.md,
  },
  headerPrimary: {
    flex: 1.5,
  },
  headerSecondary: {
    flex: 1,
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
  cardSecondary: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    color: tokens.colors.muted,
  },
  mobileSummaryRow: {
    marginTop: tokens.spacing.sm,
  },
  mobileResponseBlock: {
    marginTop: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  mobileResponseTitle: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  responseSelector: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.sm,
    marginTop: tokens.spacing.xs,
  },
  responsePill: {
    minWidth: 118,
    borderRadius: tokens.radii.lg,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    backgroundColor: tokens.colors.surface,
    gap: 2,
  },
  responsePillMobile: {
    flex: 1,
  },
  responsePillActive: {
    borderColor: tokens.colors.brand,
    backgroundColor: tokens.colors.brandTint,
  },
  responsePillLabel: {
    fontSize: tokens.typography.body,
    fontWeight: "700",
    color: tokens.colors.ink,
  },
  responsePillLabelActive: {
    color: tokens.colors.brand,
  },
  responsePillMeta: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
  },
  sectionHeader: {
    gap: tokens.spacing.xs,
  },
  sectionTitle: {
    fontSize: tokens.typography.title,
    lineHeight: 28,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  sectionCopy: {
    fontSize: tokens.typography.body,
    lineHeight: 22,
    color: tokens.colors.muted,
  },
});
