import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { SurfaceCard } from "../ui/SurfaceCard";

type AttendanceWorkspaceScreenProps = {
  canWriteAttendance: boolean;
  canViewAttendanceSummary: boolean;
  onOpenAttendanceManager?: () => void;
  onOpenAttendanceSummary?: () => void;
};

export function AttendanceWorkspaceScreen({
  canWriteAttendance,
  canViewAttendanceSummary,
  onOpenAttendanceManager,
  onOpenAttendanceSummary,
}: AttendanceWorkspaceScreenProps) {
  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
    >
      <SurfaceCard variant="default">
        <Text style={styles.cardEyebrow}>{tr("Obecność", "Attendance")}</Text>
        <Text style={styles.screenTitle}>
          {tr("Panel obecności i punktacji", "Attendance and points panel")}
        </Text>
      </SurfaceCard>

      {canWriteAttendance && onOpenAttendanceManager ? (
        <SurfaceCard variant="default">
          <Text style={styles.cardEyebrow}>{tr("Zarząd", "Board")}</Text>
          <Text style={styles.cardTitle}>
            {tr("Wpisywanie obecności", "Attendance write")}
          </Text>
          <Text style={styles.cardBody}>
            {tr(
              "Panel do odklikiwania faktycznej obecności na próbach i wydarzeniach.",
              "Panel for marking actual attendance for rehearsals and events.",
            )}
          </Text>
          <Pressable style={styles.actionButton} onPress={onOpenAttendanceManager}>
            <Text style={styles.actionButtonLabel}>{tr("Otwórz", "Open")}</Text>
          </Pressable>
        </SurfaceCard>
      ) : null}

      {canViewAttendanceSummary && onOpenAttendanceSummary ? (
        <SurfaceCard variant="default">
          <Text style={styles.cardEyebrow}>{tr("Sekcyjni i zarząd", "Section and board")}</Text>
          <Text style={styles.cardTitle}>
            {tr("Podsumowanie obecności", "Attendance summary")}
          </Text>
          <Text style={styles.cardBody}>
            {tr(
              "Punkty i frekwencja dla wybranego zakresu dat, pogrupowane sekcjami.",
              "Points and attendance for selected date range, grouped by section.",
            )}
          </Text>
          <Pressable style={styles.actionButton} onPress={onOpenAttendanceSummary}>
            <Text style={styles.actionButtonLabel}>{tr("Otwórz", "Open")}</Text>
          </Pressable>
        </SurfaceCard>
      ) : null}
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
  cardBody: {
    marginTop: tokens.spacing.sm,
    fontSize: tokens.typography.body,
    lineHeight: 23,
    color: tokens.colors.ink,
  },
  actionButton: {
    marginTop: tokens.spacing.md,
    alignSelf: "flex-start",
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.brand,
  },
  actionButtonLabel: {
    color: tokens.colors.surface,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
});
