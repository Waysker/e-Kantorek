import type { DimensionValue } from "react-native";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { tr } from "../../i18n";
import { tokens } from "../../theme/tokens";
import { Icon } from "../../ui/Icon";

export type SectionMemberCard =
  | {
    kind: "member";
    key: string;
    memberId: string;
    fullName: string;
    mark: 0 | 1 | 0.75 | 0.5 | 0.25;
    nextRatio: 0 | 1 | 0.75 | 0.5 | 0.25;
    isRsvpHinted: boolean;
    hasPendingOverride: boolean;
    isDisabled: boolean;
  }
  | {
    kind: "placeholder";
    key: string;
  };

type SectionMembersPanelProps = {
  sectionLabel: string;
  sectionSummaryText: string;
  cards: SectionMemberCard[];
  hasMembers: boolean;
  memberGridColumns: number;
  isDesktop: boolean;
  desktopTileWidth: DimensionValue;
  selectedSessionKey: string | null;
  pendingChangesCount: number;
  isBatchSaving: boolean;
  onBackToSections: () => void;
  onSetAttendance: (memberId: string, nextRatio: 0 | 1 | 0.75 | 0.5 | 0.25) => void;
  formatMarkLabel: (mark: 0 | 1 | 0.75 | 0.5 | 0.25) => string;
  formatAttendanceValue: (mark: 0 | 1 | 0.75 | 0.5 | 0.25) => string;
};

function markColors(mark: 0 | 1 | 0.75 | 0.5 | 0.25) {
  if (mark === 1) {
    return { bg: tokens.colors.successSurface, fg: tokens.colors.successInk };
  }
  if (mark === 0) {
    return { bg: tokens.colors.surfaceMuted, fg: tokens.colors.muted };
  }
  return { bg: tokens.colors.brandTint, fg: tokens.colors.successInk };
}

export function SectionMembersPanel({
  sectionLabel,
  sectionSummaryText,
  cards,
  hasMembers,
  memberGridColumns,
  isDesktop,
  selectedSessionKey,
  pendingChangesCount,
  isBatchSaving,
  onBackToSections,
  onSetAttendance,
  formatMarkLabel,
  formatAttendanceValue,
}: SectionMembersPanelProps) {
  return (
    <>
      <View style={styles.header}>
        <Pressable
          onPress={onBackToSections}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={tr("Wróć do sekcji", "Back to sections")}
        >
          <Icon name="chevronLeft" size={18} color={tokens.colors.ink} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>{sectionLabel}</Text>
          <Text style={styles.summary}>{sectionSummaryText}</Text>
        </View>
      </View>
      <Text style={styles.hint}>
        {tr(
          "Kliknij osobę, aby zmienić punkty: 0 → 1 → 0,75 → 0,5 → 0,25 → 0.",
          "Tap a person to cycle points: 0 → 1 → 0.75 → 0.5 → 0.25 → 0.",
        )}
      </Text>

      {!hasMembers ? (
        <Text style={styles.empty}>
          {tr(
            "Ta sekcja nie ma jeszcze przypisanych muzyków w aktywnym składzie.",
            "This section has no active members assigned yet.",
          )}
        </Text>
      ) : (
        <FlatList
          key={`members-${sectionLabel}-${memberGridColumns}`}
          data={cards}
          numColumns={memberGridColumns}
          scrollEnabled={false}
          removeClippedSubviews={cards.length > 40}
          initialNumToRender={Math.min(Math.max(memberGridColumns * 8, 12), cards.length || 12)}
          maxToRenderPerBatch={Math.max(memberGridColumns * 8, 16)}
          windowSize={7}
          extraData={`${selectedSessionKey ?? ""}:${pendingChangesCount}:${isBatchSaving ? "saving" : "idle"}:${sectionLabel}`}
          contentContainerStyle={[styles.list, isDesktop && styles.listDesktop]}
          columnWrapperStyle={memberGridColumns > 1 ? styles.columnWrapper : undefined}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => {
            if (item.kind === "placeholder") {
              return <View style={styles.placeholderCell} />;
            }
            const colors = markColors(item.mark);

            return (
              <View style={[styles.cell, memberGridColumns > 1 && styles.cellMultiCol]}>
                <Pressable
                  disabled={item.isDisabled}
                  onPress={() => onSetAttendance(item.memberId, item.nextRatio)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.fullName}, ${formatMarkLabel(item.mark)}`}
                  style={(state) => [
                    styles.row,
                    item.mark === 1 && styles.rowPresent,
                    item.isRsvpHinted && item.mark === 0 && styles.rowHinted,
                    item.hasPendingOverride && styles.rowPending,
                    item.isDisabled && styles.rowDisabled,
                    ((state as { hovered?: boolean }).hovered || state.pressed) &&
                      !item.isDisabled &&
                      styles.rowHovered,
                  ]}
                >
                  <View style={styles.textCol}>
                    <Text numberOfLines={2} style={styles.name}>
                      {item.fullName}
                    </Text>
                    {item.isRsvpHinted || item.hasPendingOverride ? (
                      <View style={styles.metaRow}>
                        {item.isRsvpHinted ? (
                          <Text style={styles.hintBadge}>{tr("✓ forum", "✓ forum")}</Text>
                        ) : null}
                        {item.hasPendingOverride ? (
                          <Text style={styles.pendingLabel}>{tr("do zapisu", "unsaved")}</Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                  <View style={[styles.markPill, { backgroundColor: colors.bg }]}>
                    <Text style={[styles.markLabel, { color: colors.fg }]}>
                      {formatAttendanceValue(item.mark)}
                    </Text>
                  </View>
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: tokens.radii.sm,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: tokens.colors.ink,
  },
  summary: {
    fontSize: 12,
    color: tokens.colors.muted,
  },
  hint: {
    fontSize: 13,
    color: tokens.colors.muted,
  },
  empty: {
    fontSize: 15,
    lineHeight: 22,
    color: tokens.colors.muted,
  },
  list: {
    gap: 6,
  },
  listDesktop: {
    gap: 8,
  },
  columnWrapper: {
    gap: 8,
  },
  cell: {
    width: "100%",
  },
  cellMultiCol: {
    flex: 1,
  },
  placeholderCell: {
    flex: 1,
    minHeight: 1,
  },
  row: {
    minHeight: 52,
    borderWidth: 1.5,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: tokens.colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  rowPresent: {
    borderColor: tokens.colors.successSurface,
    backgroundColor: tokens.colors.paper,
  },
  rowHinted: {
    borderStyle: "dashed",
    borderColor: tokens.colors.brandDeepAccent,
  },
  rowPending: {
    borderStyle: "solid",
    borderColor: tokens.colors.warningBorder,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowHovered: {
    backgroundColor: tokens.colors.paper,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    color: tokens.colors.ink,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  hintBadge: {
    fontSize: 11,
    fontWeight: "600",
    color: tokens.colors.successInk,
  },
  pendingLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: tokens.colors.warningInk,
  },
  markPill: {
    minWidth: 48,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: tokens.radii.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  markLabel: {
    fontSize: 15,
    fontWeight: "700",
  },
});
