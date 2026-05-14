import { useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  useWindowDimensions,
} from "react-native";

import type { AttendanceStatus, EventDetail, SquadGroup } from "../domain/models";
import { canonicalizeInstrumentLabel, UNKNOWN_INSTRUMENT_LABEL } from "../domain/instruments";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import {
  AttendanceSummaryStrip,
  type AttendanceSummaryFocusStatus,
} from "../ui/AttendanceSummaryStrip";
import { InstrumentRosterGrid } from "../ui/InstrumentRosterGrid";
import { SurfaceCard } from "../ui/SurfaceCard";

type AttendanceScreenProps = {
  event: EventDetail;
  onBack: () => void;
  focusStatus?: AttendanceSummaryFocusStatus;
};

type SelectableAttendanceStatus = Exclude<AttendanceStatus, "no_response" | "maybe">;

function sortGroupsByInstrument(left: SquadGroup, right: SquadGroup) {
  if (left.instrument === UNKNOWN_INSTRUMENT_LABEL) {
    return 1;
  }
  if (right.instrument === UNKNOWN_INSTRUMENT_LABEL) {
    return -1;
  }
  return left.instrument.localeCompare(right.instrument, "pl");
}

function removeMaybeMembers(groups: SquadGroup[]): SquadGroup[] {
  return groups.map((group) => ({
    ...group,
    maybeMembers: [],
  }));
}

function mapDeclinedGroupsByInstrument(event: EventDetail): SquadGroup[] {
  const grouped = new Map<string, SquadGroup>();

  for (const responseGroup of event.attendanceGroups) {
    if (responseGroup.status !== "not_going") {
      continue;
    }

    for (const participant of responseGroup.participants) {
      const instrument = canonicalizeInstrumentLabel(
        participant.primaryInstrument,
        UNKNOWN_INSTRUMENT_LABEL,
      );
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

export function AttendanceScreen({ event, onBack, focusStatus }: AttendanceScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;
  const selectedStatus = event.attendanceSummary.userStatus;
  const [activeList, setActiveList] = useState<AttendanceSummaryFocusStatus>(
    focusStatus ?? "going",
  );

  const goingGroups = useMemo(
    () => removeMaybeMembers(event.squad.groups),
    [event.squad.groups],
  );
  const declinedGroups = useMemo(() => mapDeclinedGroupsByInstrument(event), [event]);

  useEffect(() => {
    if (focusStatus) {
      setActiveList(focusStatus);
    }
  }, [focusStatus]);

  const options: Array<{ key: SelectableAttendanceStatus; label: string }> = [
    { key: "going", label: tr("Bede", "Going") },
    { key: "not_going", label: tr("Nie bede", "Not going") },
  ];

  const responseSelector = (
    <View style={styles.responseSelectorWrap}>
      <View style={styles.responseSelector}>
        {options.map((option) => {
          const isActive = selectedStatus === option.key;

          return (
            <View
              key={option.key}
              style={[
                styles.responsePill,
                isActive && styles.responsePillActive,
                !isDesktop && styles.responsePillMobile,
              ]}
            >
              <Text style={[styles.responsePillLabel, isActive && styles.responsePillLabelActive]}>
                {option.label}
              </Text>
              <Text style={styles.responsePillMeta}>
                {isActive
                  ? tr("Zaimportowane RSVP", "Imported RSVP")
                  : tr("Tylko podglad", "Preview only")}
              </Text>
            </View>
          );
        })}
      </View>

      <Text style={[styles.responseNotice, styles.responseNoticeInfo]}>
        {tr("Stan z forum.", "Forum state.")}
      </Text>
    </View>
  );

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={[styles.screenContent, isDesktop && styles.desktopContent]}
      showsVerticalScrollIndicator={false}
    >
      <Pressable onPress={onBack} style={styles.backLink}>
        <Text style={styles.backLinkLabel}>{tr("Wroc do wydarzenia", "Back to Event")}</Text>
      </Pressable>

      {isDesktop ? (
        <View style={styles.headerSplitDesktop}>
          <SurfaceCard variant="default" style={styles.headerPrimary}>
            <Text style={styles.cardEyebrow}>
              {tr("Deklaracja RSVP i sklad", "RSVP declaration and roster")}
            </Text>
            <Text style={styles.screenTitle}>{event.title}</Text>
            <AttendanceSummaryStrip
              summary={event.attendanceSummary}
              includeMaybe={false}
              onSelectStatus={(status) => setActiveList(status)}
            />
            <Text style={styles.helperText}>
              {tr(
                "Kliknij Bede / Nie bede, aby przelaczyc liste.",
                "Tap Going / Not going to switch list.",
              )}
            </Text>
          </SurfaceCard>

          <SurfaceCard variant="outline" style={styles.headerSecondary}>
            <Text style={styles.cardEyebrow}>
              {tr("Twoja deklaracja RSVP", "Your RSVP declaration")}
            </Text>
            {responseSelector}
          </SurfaceCard>
        </View>
      ) : (
        <SurfaceCard variant="default">
          <Text style={styles.cardEyebrow}>
            {tr("Deklaracja RSVP i sklad", "RSVP declaration and roster")}
          </Text>
          <Text style={styles.screenTitle}>{event.title}</Text>

          <View style={styles.mobileSummaryRow}>
            <AttendanceSummaryStrip
              summary={event.attendanceSummary}
              compact
              includeMaybe={false}
              onSelectStatus={(status) => setActiveList(status)}
            />
          </View>
          <Text style={styles.helperText}>
            {tr(
              "Kliknij Bede / Nie bede, aby przelaczyc liste.",
              "Tap Going / Not going to switch list.",
            )}
          </Text>

          <View style={styles.mobileResponseBlock}>
            <Text style={styles.mobileResponseTitle}>
              {tr("Twoja deklaracja RSVP", "Your RSVP declaration")}
            </Text>
            {responseSelector}
          </View>
        </SurfaceCard>
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {activeList === "going"
            ? tr("Bede wedlug instrumentu", "Going by instrument")
            : tr("Nie bede wedlug instrumentu", "Not going by instrument")}
        </Text>
      </View>

      {activeList === "going" ? (
        <InstrumentRosterGrid groups={goingGroups} />
      ) : (
        <InstrumentRosterGrid
          groups={declinedGroups}
          confirmedLabel={tr("odmowilo", "declined")}
          emptyStateLabel={tr(
            "Brak osob, ktore odmowily udzialu.",
            "No declined members for this event.",
          )}
        />
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
  helperText: {
    marginTop: tokens.spacing.sm,
    fontSize: tokens.typography.caption,
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
  responseSelectorWrap: {
    gap: tokens.spacing.sm,
  },
  responseSelector: {
    flexDirection: "row",
    gap: tokens.spacing.xs,
    flexWrap: "wrap",
  },
  responsePill: {
    flex: 1,
    minWidth: 110,
    borderRadius: tokens.radii.round,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    backgroundColor: tokens.colors.surfaceMuted,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.sm,
    gap: 2,
  },
  responsePillMobile: {
    minWidth: 94,
  },
  responsePillActive: {
    backgroundColor: tokens.colors.brandTint,
    borderColor: tokens.colors.brand,
  },
  responsePillLabel: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  responsePillLabelActive: {
    color: tokens.colors.brand,
  },
  responsePillMeta: {
    fontSize: 11,
    color: tokens.colors.muted,
  },
  responseNotice: {
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    borderRadius: tokens.radii.md,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.xs,
  },
  responseNoticeInfo: {
    backgroundColor: tokens.colors.brandTint,
    color: tokens.colors.brand,
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
});
