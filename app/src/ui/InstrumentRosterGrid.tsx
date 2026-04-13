import { useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import type { SquadGroup } from "../domain/models";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { SurfaceCard } from "./SurfaceCard";

type InstrumentRosterGridProps = {
  groups: SquadGroup[];
  maxWidth?: number;
  confirmedLabel?: string;
  maybeLabel?: string;
  maybeSectionLabel?: string;
  emptyStateLabel?: string;
};

const UNKNOWN_INSTRUMENT_LABEL = "Instrument not mapped yet";

export function InstrumentRosterGrid({
  groups,
  maxWidth = 1200,
  confirmedLabel = tr("obecnych", "going"),
  maybeLabel = tr("może", "maybe"),
  maybeSectionLabel = tr("Może", "Maybe"),
  emptyStateLabel = tr("Brak potwierdzonego składu dla tego wydarzenia.", "No confirmed roster for this event yet."),
}: InstrumentRosterGridProps) {
  const { width } = useWindowDimensions();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const viewportWidth = Math.min(width, maxWidth);
  const isPackedMobile = viewportWidth < 780;
  const desktopColumns =
    viewportWidth >= 1360 ? 4 : viewportWidth >= 1080 ? 3 : viewportWidth >= 780 ? 2 : 1;
  const desktopCardWidth =
    isPackedMobile
      ? undefined
      : Math.floor(
          (viewportWidth -
            tokens.spacing.lg * 2 -
            tokens.spacing.md * (desktopColumns - 1)) /
            desktopColumns,
        );
  const visibleGroups = groups.filter((group) => {
    const hasAnyMembers =
      group.confirmedMembers.length > 0 || group.maybeMembers.length > 0;

    if (!hasAnyMembers && group.instrument === UNKNOWN_INSTRUMENT_LABEL) {
      return false;
    }

    return true;
  });

  function toggleGroup(groupKey: string) {
    setExpandedGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  }

  function formatCompactCount(group: SquadGroup) {
    const going = group.confirmedMembers.length;
    const maybe = group.maybeMembers.length;

    if (maybe === 0) {
      return `${going}`;
    }

    if (going === 0) {
      return `${maybe}?`;
    }

    return `${going}+${maybe}?`;
  }

  return (
    <View style={styles.grid}>
      {visibleGroups.map((group) => {
        const isExpanded = !isPackedMobile || expandedGroups[group.instrument] === true;
        const useDenseMemberGrid = isExpanded && viewportWidth >= 360;

        return (
          <SurfaceCard
            key={group.instrument}
            variant={group.confirmedMembers.length > 0 ? "default" : "outline"}
            style={[
              styles.card,
              !isPackedMobile && desktopCardWidth ? { width: desktopCardWidth } : null,
              isPackedMobile && !isExpanded && styles.mobileCollapsedCard,
              isPackedMobile && isExpanded && styles.mobileExpandedCard,
            ]}
          >
            <Pressable
              onPress={isPackedMobile ? () => toggleGroup(group.instrument) : undefined}
              style={styles.headerRow}
            >
              <View style={styles.headerCopy}>
                <Text
                  style={[
                    styles.instrumentName,
                    isPackedMobile && !isExpanded && styles.instrumentNameCompact,
                  ]}
                  numberOfLines={2}
                >
                  {group.instrument}
                </Text>
                {!isPackedMobile ? (
                  <Text style={styles.instrumentMeta}>
                    {group.confirmedMembers.length} {confirmedLabel}
                    {group.maybeMembers.length > 0
                      ? ` / ${group.maybeMembers.length} ${maybeLabel}`
                      : ""}
                  </Text>
                ) : null}
              </View>

              {isPackedMobile ? (
                <View style={styles.compactCountPill}>
                  <Text style={styles.compactCountLabel}>
                    {formatCompactCount(group)}
                  </Text>
                </View>
              ) : null}
            </Pressable>

            {isExpanded ? (
              <>
                {isPackedMobile ? (
                  <Text style={styles.mobileExpandedMeta}>
                    {group.confirmedMembers.length} {confirmedLabel}
                    {group.maybeMembers.length > 0
                      ? ` - ${group.maybeMembers.length} ${maybeLabel}`
                      : ""}
                  </Text>
                ) : null}

                {group.confirmedMembers.length > 0 ? (
                  <View style={styles.sectionBlock}>
                    <View
                      style={[
                        styles.memberGrid,
                        useDenseMemberGrid && styles.memberGridDense,
                      ]}
                    >
                      {group.confirmedMembers.map((member) => (
                        <View
                          key={member.id}
                          style={[
                            styles.memberCell,
                            useDenseMemberGrid && styles.memberCellDense,
                          ]}
                        >
                          <Text style={styles.memberRow} numberOfLines={2}>
                            {member.fullName}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : (
                  <View style={styles.sectionBlock}>
                    <Text style={styles.memberRowMuted}>--</Text>
                  </View>
                )}

                {group.maybeMembers.length > 0 ? (
                  <View style={styles.sectionBlock}>
                    <Text style={styles.sectionTitle}>{maybeSectionLabel}</Text>
                    <View
                      style={[
                        styles.memberGrid,
                        useDenseMemberGrid && styles.memberGridDense,
                      ]}
                    >
                      {group.maybeMembers.map((member) => (
                        <View
                          key={member.id}
                          style={[
                            styles.memberCell,
                            useDenseMemberGrid && styles.memberCellDense,
                          ]}
                        >
                          <Text style={styles.memberRow} numberOfLines={2}>
                            {member.fullName}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}
              </>
            ) : null}
          </SurfaceCard>
        );
      })}
      {visibleGroups.length === 0 ? (
        <SurfaceCard variant="outline" style={styles.emptyStateCard}>
          <Text style={styles.emptyStateLabel}>{emptyStateLabel}</Text>
        </SurfaceCard>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.md,
    alignItems: "flex-start",
  },
  card: {
    flexGrow: 1,
  },
  mobileCollapsedCard: {
    flexGrow: 0,
    flexShrink: 1,
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
  },
  mobileExpandedCard: {
    width: "100%",
    padding: tokens.spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: tokens.spacing.sm,
  },
  headerCopy: {
    flexShrink: 1,
    gap: 2,
  },
  instrumentName: {
    fontSize: tokens.typography.title,
    lineHeight: 28,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  instrumentNameCompact: {
    fontSize: 20,
    lineHeight: 24,
  },
  instrumentMeta: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
  },
  compactCountPill: {
    minWidth: 34,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.surfaceMuted,
    alignItems: "center",
  },
  compactCountLabel: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  mobileExpandedMeta: {
    marginTop: tokens.spacing.sm,
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
  },
  sectionBlock: {
    marginTop: tokens.spacing.md,
    gap: tokens.spacing.xs,
  },
  sectionTitle: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  memberGrid: {
    gap: tokens.spacing.xs,
  },
  memberGridDense: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.sm,
  },
  memberCell: {
    minWidth: 0,
  },
  memberCellDense: {
    width: "47%",
  },
  memberRow: {
    fontSize: tokens.typography.body,
    lineHeight: 22,
    color: tokens.colors.ink,
  },
  memberRowMuted: {
    fontSize: tokens.typography.body,
    lineHeight: 22,
    color: tokens.colors.muted,
  },
  emptyStateCard: {
    width: "100%",
  },
  emptyStateLabel: {
    fontSize: tokens.typography.body,
    lineHeight: 22,
    color: tokens.colors.muted,
  },
});
