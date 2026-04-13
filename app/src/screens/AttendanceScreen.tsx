import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import type { EventDetail, SquadGroup } from "../domain/models";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { AttendanceSummaryStrip } from "../ui/AttendanceSummaryStrip";
import { InstrumentRosterGrid } from "../ui/InstrumentRosterGrid";
import { SurfaceCard } from "../ui/SurfaceCard";

type AttendanceScreenProps = {
  event: EventDetail;
  onBack: () => void;
};

const UNKNOWN_INSTRUMENT_LABEL = "Instrument not mapped yet";

function sortGroupsByInstrument(left: SquadGroup, right: SquadGroup) {
  if (left.instrument === UNKNOWN_INSTRUMENT_LABEL) {
    return 1;
  }
  if (right.instrument === UNKNOWN_INSTRUMENT_LABEL) {
    return -1;
  }
  return left.instrument.localeCompare(right.instrument, "pl");
}

function mapDeclinedGroupsByInstrument(event: EventDetail): SquadGroup[] {
  const grouped = new Map<string, SquadGroup>();

  for (const responseGroup of event.attendanceGroups) {
    if (responseGroup.status !== "not_going") {
      continue;
    }

    for (const participant of responseGroup.participants) {
      const instrument = participant.primaryInstrument ?? UNKNOWN_INSTRUMENT_LABEL;
      const group = grouped.get(instrument) ?? {
        instrument,
        confirmedMembers: [],
        maybeMembers: [],
      };

      group.confirmedMembers.push({
        id: participant.id,
        fullName: participant.fullName,
      });
      grouped.set(instrument, group);
    }
  }

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      confirmedMembers: [...group.confirmedMembers].sort((left, right) =>
        left.fullName.localeCompare(right.fullName, "pl"),
      ),
    }))
    .sort(sortGroupsByInstrument);
}

export function AttendanceScreen({ event, onBack }: AttendanceScreenProps) {
  const [isDeclinedVisible, setIsDeclinedVisible] = useState(false);
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;
  const declinedGroups = useMemo(() => mapDeclinedGroupsByInstrument(event), [event]);
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

      {event.attendanceSummary.notGoing > 0 ? (
        <View style={styles.declinedSection}>
          <Pressable
            onPress={() => setIsDeclinedVisible((current) => !current)}
            style={[
              styles.declinedToggle,
              isDeclinedVisible && styles.declinedToggleActive,
            ]}
          >
            <Text style={styles.declinedToggleTitle}>
              {isDeclinedVisible
                ? tr("Ukryj osoby, które odmówiły", "Hide declined members")
                : tr("Pokaż osoby, które odmówiły", "Show declined members")}
            </Text>
            <Text style={styles.declinedToggleMeta}>
              {tr("Odmówili", "Declined")}: {event.attendanceSummary.notGoing}
            </Text>
          </Pressable>

          {isDeclinedVisible ? (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>
                  {tr("Odmowy według instrumentu", "Declined by instrument")}
                </Text>
                <Text style={styles.sectionCopy}>
                  {tr(
                    "Ten widok jest domyślnie ukryty, żeby skupić się na potwierdzonym składzie.",
                    "This view is hidden by default to keep focus on the confirmed roster.",
                  )}
                </Text>
              </View>

              <InstrumentRosterGrid
                groups={declinedGroups}
                confirmedLabel={tr("odmówiło", "declined")}
                emptyStateLabel={tr(
                  "Brak osób, które odmówiły udziału.",
                  "No declined members for this event.",
                )}
              />
            </>
          ) : null}
        </View>
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
  declinedSection: {
    gap: tokens.spacing.sm,
  },
  declinedToggle: {
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    backgroundColor: tokens.colors.surface,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    gap: 2,
  },
  declinedToggleActive: {
    borderColor: tokens.colors.brand,
    backgroundColor: tokens.colors.brandTint,
  },
  declinedToggleTitle: {
    fontSize: tokens.typography.body,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  declinedToggleMeta: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
  },
});
