import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import type { AttendanceStatus, EventDetail, SquadMember } from "../domain/models";
import { canonicalizeInstrumentLabel, UNKNOWN_INSTRUMENT_LABEL } from "../domain/instruments";
import { appLocaleTag, tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { formatDateLabel, stripTitleDatePrefix } from "../utils/format";
import type { AttendanceSummaryFocusStatus } from "../ui/AttendanceSummaryStrip";
import { Icon } from "../ui/Icon";
import { statusMeta } from "../ui/StatusPill";

type AttendanceScreenProps = {
  event: EventDetail;
  onBack: () => void;
  focusStatus?: AttendanceSummaryFocusStatus;
};

type RosterSection = { instrument: string; members: SquadMember[] };

const UNASSIGNED_LABELS = new Set([UNKNOWN_INSTRUMENT_LABEL, "Unassigned"]);

function instrumentLabel(instrument: string) {
  return UNASSIGNED_LABELS.has(instrument)
    ? tr("Bez przypisanego instrumentu", "No instrument assigned")
    : instrument;
}

// Names are "First Last"; the surname is the last word ("Anna Kowalska-Nowak").
function surnameKey(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] ?? fullName;
}

function compareBySurname(left: SquadMember, right: SquadMember) {
  return (
    surnameKey(left.fullName).localeCompare(surnameKey(right.fullName), appLocaleTag) ||
    left.fullName.localeCompare(right.fullName, appLocaleTag)
  );
}

function sortSections(sections: RosterSection[]) {
  return sections
    .filter((section) => section.members.length > 0)
    .map((section) => ({
      ...section,
      members: [...section.members].sort(compareBySurname),
    }))
    .sort((left, right) => {
      const leftUnassigned = UNASSIGNED_LABELS.has(left.instrument);
      const rightUnassigned = UNASSIGNED_LABELS.has(right.instrument);
      if (leftUnassigned !== rightUnassigned) {
        return leftUnassigned ? 1 : -1;
      }
      return left.instrument.localeCompare(right.instrument, appLocaleTag);
    });
}

// "Going" and "maybe" come from the squad (already grouped by instrument);
// "not going" and "no response" come from the poll groups.
function buildSections(event: EventDetail): Record<AttendanceStatus, RosterSection[]> {
  const fromSquad = (pick: "confirmedMembers" | "maybeMembers") =>
    sortSections(
      event.squad.groups.map((group) => ({ instrument: group.instrument, members: group[pick] })),
    );

  const fromPoll = (status: AttendanceStatus) => {
    const byInstrument = new Map<string, SquadMember[]>();
    for (const group of event.attendanceGroups) {
      if (group.status !== status) {
        continue;
      }
      for (const participant of group.participants) {
        const instrument = canonicalizeInstrumentLabel(
          participant.primaryInstrument,
          UNKNOWN_INSTRUMENT_LABEL,
        );
        const members = byInstrument.get(instrument) ?? [];
        members.push({ id: participant.id, fullName: participant.fullName });
        byInstrument.set(instrument, members);
      }
    }
    return sortSections(
      Array.from(byInstrument, ([instrument, members]) => ({ instrument, members })),
    );
  };

  return {
    going: fromSquad("confirmedMembers"),
    maybe: fromSquad("maybeMembers"),
    not_going: fromPoll("not_going"),
    no_response: fromPoll("no_response"),
  };
}

function splitIntoColumns<T>(items: T[], columns: number): T[][] {
  const perColumn = Math.ceil(items.length / columns);
  return Array.from({ length: columns }, (_, index) =>
    items.slice(index * perColumn, (index + 1) * perColumn),
  ).filter((column) => column.length > 0);
}

function countMembers(sections: RosterSection[]) {
  return sections.reduce((total, section) => total + section.members.length, 0);
}

export function AttendanceScreen({ event, onBack, focusStatus }: AttendanceScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;
  const isWide = width >= 360;
  const [activeStatus, setActiveStatus] = useState<AttendanceStatus>(focusStatus ?? "going");

  useEffect(() => {
    if (focusStatus) {
      setActiveStatus(focusStatus);
    }
  }, [focusStatus]);

  const sectionsByStatus = useMemo(() => buildSections(event), [event]);
  const tabs = (["going", "maybe", "not_going", "no_response"] as const)
    .map((status) => ({ status, count: countMembers(sectionsByStatus[status]) }))
    // Always offer "going" and "not going"; the other two only when someone is in them.
    .filter((tab) => tab.status === "going" || tab.status === "not_going" || tab.count > 0);

  const activeSections = sectionsByStatus[activeStatus];
  const activeMeta = statusMeta(activeStatus);
  const nameColumns = isDesktop ? 2 : isWide ? 2 : 1;

  // Desktop: two independent columns balanced by member count, so cards of
  // different heights don't leave gaps.
  const sectionColumns: RosterSection[][] = isDesktop ? [[], []] : [[]];
  const columnLoad = sectionColumns.map(() => 0);
  for (const section of activeSections) {
    const target = columnLoad[0] <= (columnLoad[1] ?? Infinity) ? 0 : 1;
    sectionColumns[target].push(section);
    columnLoad[target] += section.members.length / nameColumns + 2;
  }

  function renderSection(section: RosterSection) {
    return (
      <View key={section.instrument} style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{instrumentLabel(section.instrument)}</Text>
          <View style={[styles.countBadge, { backgroundColor: activeMeta.bg }]}>
            <Text style={[styles.countLabel, { color: activeMeta.fg }]}>
              {section.members.length}
            </Text>
          </View>
        </View>
        {/* Filled column by column (top to bottom, then the next column), so the
            alphabetical order reads down like a printed list. */}
        <View style={styles.names}>
          {splitIntoColumns(section.members, nameColumns).map((column, columnIndex) => (
            <View key={columnIndex} style={styles.nameColumn}>
              {column.map((member, index) => (
                <View key={member.id} style={[styles.nameCell, index > 0 && styles.nameCellDivider]}>
                  <Text style={styles.name} numberOfLines={2}>
                    {member.fullName}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={[styles.content, isDesktop && styles.contentDesktop]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={tr("Wróć do wydarzenia", "Back to event")}
        >
          <Icon name="chevronLeft" size={20} color={tokens.colors.ink} strokeWidth={2.2} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>
            {tr("Skład", "Line-up")} · {formatDateLabel(event.startsAt)}
          </Text>
          <Text style={styles.title} numberOfLines={2}>
            {stripTitleDatePrefix(event.title)}
          </Text>
        </View>
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        {tabs.map(({ status, count }) => {
          const meta = statusMeta(status);
          const isActive = status === activeStatus;
          return (
            <Pressable
              key={status}
              onPress={() => setActiveStatus(status)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              style={[
                styles.tab,
                isActive && { backgroundColor: meta.bg, borderColor: meta.accent },
              ]}
            >
              <Text style={[styles.tabCount, isActive && { color: meta.fg }]}>{count}</Text>
              <Text style={[styles.tabLabel, isActive && { color: meta.fg }]} numberOfLines={1}>
                {meta.glyph} {meta.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {activeSections.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyCopy}>
            {activeStatus === "going"
              ? tr("Nikt jeszcze nie potwierdził udziału.", "Nobody has confirmed yet.")
              : activeStatus === "not_going"
                ? tr("Nikt nie odmówił udziału.", "Nobody has declined.")
                : tr("Brak osób na tej liście.", "Nobody on this list.")}
          </Text>
        </View>
      ) : (
        <View style={[styles.sections, isDesktop && styles.sectionsDesktop]}>
          {sectionColumns.map((column, columnIndex) => (
            <View key={columnIndex} style={styles.sectionColumn}>
              {column.map((section) => renderSection(section))}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screenScroll: {
    flex: 1,
  },
  content: {
    padding: tokens.spacing.md,
    paddingTop: tokens.spacing.md,
    gap: tokens.spacing.md,
  },
  contentDesktop: {
    width: "100%",
    maxWidth: 1080,
    alignSelf: "center",
    paddingHorizontal: tokens.spacing.xl,
    paddingTop: tokens.spacing.xl,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: tokens.radii.md,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    backgroundColor: tokens.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  kicker: {
    fontSize: tokens.typography.caption,
    fontWeight: "600",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: tokens.colors.muted,
  },
  title: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "800",
    letterSpacing: -0.3,
    color: tokens.colors.ink,
  },
  tabs: {
    flexDirection: "row",
    gap: tokens.spacing.xs,
  },
  tab: {
    flex: 1,
    minHeight: 60,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: tokens.radii.md,
    borderWidth: 1.5,
    borderColor: tokens.colors.border,
    backgroundColor: tokens.colors.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  tabCount: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "800",
    color: tokens.colors.ink,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: tokens.colors.muted,
  },
  sections: {
    gap: tokens.spacing.sm,
  },
  sectionsDesktop: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  sectionColumn: {
    flex: 1,
    minWidth: 0,
    gap: tokens.spacing.sm,
  },
  section: {
    backgroundColor: tokens.colors.surface,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.lg,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 6,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacing.sm,
    paddingBottom: 8,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: tokens.colors.ink,
  },
  countBadge: {
    minWidth: 28,
    height: 24,
    paddingHorizontal: 8,
    borderRadius: tokens.radii.round,
    alignItems: "center",
    justifyContent: "center",
  },
  countLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  names: {
    flexDirection: "row",
    gap: 12,
  },
  nameColumn: {
    flex: 1,
    minWidth: 0,
  },
  nameCell: {
    paddingVertical: 8,
    paddingRight: 8,
  },
  nameCellDivider: {
    borderTopWidth: 1,
    borderTopColor: tokens.colors.surfaceMuted,
  },
  name: {
    fontSize: 15,
    color: tokens.colors.ink,
  },
  emptyBox: {
    padding: tokens.spacing.lg,
    borderRadius: tokens.radii.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: tokens.colors.borderStrong,
  },
  emptyCopy: {
    fontSize: 14,
    lineHeight: 20,
    color: tokens.colors.muted,
  },
});
