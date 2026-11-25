import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import type { EventDetail, SquadMember } from "../domain/models";
import {
  canonicalizeInstrumentLabel,
  REHEARSAL_SECTION_ROWS,
  UNKNOWN_INSTRUMENT_LABEL,
} from "../domain/instruments";
import { appLocaleTag, tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { textStyles } from "../theme/text";
import { formatDateLabel, stripTitleDatePrefix } from "../utils/format";
import { Card, listRowDivider } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { Icon } from "../ui/Icon";
import { SectionTile } from "../ui/SectionTile";
import { StatusPill, statusMeta } from "../ui/StatusPill";

type AttendanceScreenProps = {
  event: EventDetail;
  onBack: () => void;
  /** The signed-in member's instrument: their section starts selected. */
  userInstrument?: string;
};

type LineupPerson = SquadMember & { status: "going" | "not_going" };

type LineupSection = {
  instrument: string;
  label: string;
  people: LineupPerson[];
  going: number;
  notGoing: number;
};

const UNASSIGNED_LABELS = new Set([UNKNOWN_INSTRUMENT_LABEL, "Unassigned"]);
const SEATING_ORDER: string[] = REHEARSAL_SECTION_ROWS.flat();

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

// Rehearsal seating first, other sections after them, "no instrument" last.
function compareSections(left: LineupSection, right: LineupSection) {
  const rank = (section: LineupSection) => {
    if (UNASSIGNED_LABELS.has(section.instrument)) return Number.MAX_SAFE_INTEGER;
    const seat = SEATING_ORDER.indexOf(section.instrument);
    return seat === -1 ? SEATING_ORDER.length : seat;
  };
  return (
    rank(left) - rank(right) || left.instrument.localeCompare(right.instrument, appLocaleTag)
  );
}

// "Going" comes from the squad (grouped by instrument), "not going" from the
// poll groups. No "maybe" or "no response": the roster is unknown.
function buildSections(event: EventDetail): LineupSection[] {
  const byInstrument = new Map<string, Map<string, LineupPerson>>();
  const add = (instrumentValue: string | undefined, person: LineupPerson) => {
    const instrument = canonicalizeInstrumentLabel(instrumentValue, UNKNOWN_INSTRUMENT_LABEL);
    const people = byInstrument.get(instrument) ?? new Map<string, LineupPerson>();
    if (!people.has(person.id)) {
      people.set(person.id, person);
    }
    byInstrument.set(instrument, people);
  };

  for (const group of event.squad.groups) {
    for (const member of group.confirmedMembers) {
      add(group.instrument, { ...member, status: "going" });
    }
  }
  for (const group of event.attendanceGroups) {
    if (group.status !== "not_going") continue;
    for (const participant of group.participants) {
      add(participant.primaryInstrument, {
        id: participant.id,
        fullName: participant.fullName,
        status: "not_going",
      });
    }
  }

  return Array.from(byInstrument, ([instrument, peopleById]) => {
    const people = Array.from(peopleById.values()).sort(compareBySurname);
    const going = people.filter((person) => person.status === "going").length;
    return {
      instrument,
      label: instrumentLabel(instrument),
      people,
      going,
      notGoing: people.length - going,
    };
  })
    .filter((section) => section.people.length > 0)
    .sort(compareSections);
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

function declarationsLabel(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;
  const pl =
    count === 1
      ? "zgłoszenie"
      : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)
        ? "zgłoszenia"
        : "zgłoszeń";
  return `${count} ${tr(pl, count === 1 ? "response" : "responses")}`;
}

export function AttendanceScreen({ event, onBack, userInstrument }: AttendanceScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;

  const sections = useMemo(() => buildSections(event), [event]);
  const mineKey = userInstrument
    ? canonicalizeInstrumentLabel(userInstrument, UNKNOWN_INSTRUMENT_LABEL)
    : null;
  const [selectedKey, setSelectedKey] = useState<string | null>(() =>
    mineKey && sections.some((section) => section.instrument === mineKey) ? mineKey : null,
  );
  const selected = sections.find((section) => section.instrument === selectedKey) ?? null;

  const totalGoing = sections.reduce((sum, section) => sum + section.going, 0);
  const totalNotGoing = sections.reduce((sum, section) => sum + section.notGoing, 0);
  const goingMeta = statusMeta("going");
  const notGoingMeta = statusMeta("not_going");

  const columns = isDesktop ? 3 : 2;
  const rows = chunk(sections, columns);

  function toggle(instrument: string) {
    setSelectedKey((current) => (current === instrument ? null : instrument));
  }

  function renderRow(row: LineupSection[], rowIndex: number) {
    return (
      <View key={rowIndex} style={styles.row}>
        {row.map((section) => (
          <SectionTile
            key={section.instrument}
            label={section.label}
            going={section.going}
            notGoing={section.notGoing}
            mine={section.instrument === mineKey}
            selected={section.instrument === selectedKey}
            large={isDesktop}
            onPress={() => toggle(section.instrument)}
          />
        ))}
        {Array.from({ length: columns - row.length }, (_, index) => (
          <View key={`spacer-${index}`} style={styles.spacer} />
        ))}
      </View>
    );
  }

  function renderPeople(section: LineupSection) {
    return (
      <Card variant="list">
        <View style={styles.peopleHeader}>
          <Text style={textStyles.sectionTitle}>{section.label}</Text>
          <Text style={styles.peopleMeta}>{declarationsLabel(section.people.length)}</Text>
        </View>
        {section.people.map((person) => (
          <View key={person.id} style={[styles.personRow, listRowDivider]}>
            <Text style={styles.personName}>{person.fullName}</Text>
            <StatusPill status={person.status} />
          </View>
        ))}
      </Card>
    );
  }

  const meta = [formatDateLabel(event.startsAt), event.venue].filter(Boolean).join(" · ");

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={[styles.content, isDesktop && styles.contentDesktop]}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.hero, isDesktop && styles.heroDesktop]}>
        <View style={styles.heroTop}>
          <Pressable
            onPress={onBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={tr("Wróć do wydarzenia", "Back to event")}
          >
            <Icon name="chevronLeft" size={20} color={tokens.colors.surface} strokeWidth={2.2} />
          </Pressable>
          <Text style={styles.heroKicker}>{tr("Skład", "Line-up")}</Text>
        </View>
        <View style={[styles.heroBody, isDesktop && styles.heroBodyDesktop]}>
          <View style={styles.heroText}>
            <Text style={[styles.heroTitle, isDesktop && styles.heroTitleDesktop]}>
              {stripTitleDatePrefix(event.title)}
            </Text>
            <Text style={styles.heroMeta}>{meta}</Text>
          </View>
          <View style={styles.totals}>
            <View style={[styles.total, { backgroundColor: goingMeta.bg }]}>
              <Text style={[styles.totalLabel, { color: goingMeta.fg }]}>
                ✓ {totalGoing} {tr("będzie", "going")}
              </Text>
            </View>
            <View style={[styles.total, { backgroundColor: notGoingMeta.bg }]}>
              <Text style={[styles.totalLabel, { color: notGoingMeta.fg }]}>
                ✕ {totalNotGoing} {tr("nie będzie", "not going")}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {sections.length === 0 ? (
        <EmptyState>{tr("Nikt jeszcze się nie zadeklarował.", "Nobody has declared yet.")}</EmptyState>
      ) : isDesktop ? (
        <View style={styles.desktopColumns}>
          <View style={styles.gridColumn}>
            <Text style={textStyles.kicker}>{tr("Sekcje", "Sections")}</Text>
            <View style={styles.grid}>{rows.map(renderRow)}</View>
          </View>
          <View style={styles.aside}>
            <Text style={textStyles.kicker}>{tr("Szczegóły", "Details")}</Text>
            {selected ? (
              renderPeople(selected)
            ) : (
              <View style={styles.asideEmpty}>
                <Text style={styles.asideEmptyLabel}>{tr("Wybierz sekcję", "Pick a section")}</Text>
              </View>
            )}
          </View>
        </View>
      ) : (
        <View style={styles.grid}>
          <Text style={textStyles.kicker}>{tr("Sekcje", "Sections")}</Text>
          {rows.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.grid}>
              {renderRow(row, rowIndex)}
              {selected && row.includes(selected) ? renderPeople(selected) : null}
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
    gap: tokens.spacing.md,
  },
  contentDesktop: {
    width: "100%",
    maxWidth: 1080,
    alignSelf: "center",
    padding: tokens.spacing.xl,
    gap: tokens.spacing.lg,
  },
  hero: {
    backgroundColor: tokens.colors.brandDeep,
    borderRadius: tokens.radii.xl,
    padding: tokens.spacing.md,
    gap: 12,
  },
  heroDesktop: {
    paddingHorizontal: 28,
    paddingVertical: tokens.spacing.lg,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: tokens.radii.md,
    backgroundColor: tokens.colors.brandDeepRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  heroKicker: {
    color: tokens.colors.brandDeepAccent,
    fontSize: tokens.typography.caption,
    fontWeight: "600",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  heroBody: {
    gap: 12,
  },
  heroBodyDesktop: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: tokens.spacing.md,
  },
  heroText: {
    gap: 4,
    flexShrink: 1,
  },
  heroTitle: {
    color: tokens.colors.surface,
    fontSize: 26,
    lineHeight: 31,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  heroTitleDesktop: {
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -0.5,
  },
  heroMeta: {
    color: tokens.colors.brandDeepMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  totals: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  total: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: tokens.radii.round,
    justifyContent: "center",
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  grid: {
    gap: tokens.spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: tokens.spacing.sm,
  },
  spacer: {
    flex: 1,
  },
  desktopColumns: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tokens.spacing.lg,
  },
  gridColumn: {
    flex: 2,
    minWidth: 0,
    gap: tokens.spacing.sm,
  },
  aside: {
    flex: 1,
    minWidth: 300,
    gap: tokens.spacing.sm,
  },
  asideEmpty: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: tokens.colors.borderStrong,
    borderRadius: tokens.radii.lg,
    padding: tokens.spacing.lg,
  },
  asideEmptyLabel: {
    fontSize: 14,
    color: tokens.colors.muted,
  },
  peopleHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: tokens.spacing.sm,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: tokens.spacing.sm,
  },
  peopleMeta: {
    fontSize: 13,
    color: tokens.colors.muted,
  },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacing.sm,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  personName: {
    flex: 1,
    fontSize: 15,
    color: tokens.colors.ink,
  },
});
