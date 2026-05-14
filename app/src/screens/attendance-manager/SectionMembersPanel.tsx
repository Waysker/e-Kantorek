import type { DimensionValue } from "react-native";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { tr } from "../../i18n";
import { tokens } from "../../theme/tokens";

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

export function SectionMembersPanel({
  sectionLabel,
  sectionSummaryText,
  cards,
  hasMembers,
  memberGridColumns,
  isDesktop,
  desktopTileWidth,
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
      <View style={styles.instrumentHeader}>
        <View style={styles.instrumentHeaderTextCol}>
          <Pressable onPress={onBackToSections} style={styles.sectionBackButton}>
            <Text style={styles.sectionBackButtonLabel}>{tr("← Wróć do sekcji", "← Back to sections")}</Text>
          </Pressable>
          <Text style={styles.sectionDetailTitle}>{sectionLabel}</Text>
          <Text style={styles.instrumentSummary}>{sectionSummaryText}</Text>
        </View>
      </View>

      {!hasMembers ? (
        <Text style={styles.copy}>
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
          contentContainerStyle={[
            styles.memberListContent,
            isDesktop && styles.memberListContentDesktop,
          ]}
          columnWrapperStyle={memberGridColumns > 1 ? styles.memberListColumnWrapper : undefined}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => {
            if (item.kind === "placeholder") {
              return <View style={styles.memberPlaceholderCell} />;
            }

            return (
              <View style={[styles.memberCell, memberGridColumns > 1 && styles.memberCellMultiCol]}>
                <Pressable
                  disabled={item.isDisabled}
                  onPress={() => {
                    onSetAttendance(item.memberId, item.nextRatio);
                  }}
                  style={[
                    styles.memberRow,
                    isDesktop && styles.memberRowDesktop,
                    memberGridColumns === 1 && isDesktop && { width: desktopTileWidth },
                    item.isRsvpHinted && styles.memberRowHinted,
                    item.hasPendingOverride && styles.memberRowPending,
                    item.isDisabled && styles.memberRowDisabled,
                  ]}
                >
                  <View style={styles.memberTextCol}>
                    <View style={styles.memberNameRow}>
                      <Text numberOfLines={1} style={styles.memberName}>{item.fullName}</Text>
                      {item.isRsvpHinted ? (
                        <Text style={styles.memberHintBadge}>{tr("RSVP", "RSVP")}</Text>
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.memberMeta,
                        item.mark === 1
                          ? styles.memberMetaPresent
                          : item.mark === 0
                            ? styles.memberMetaAbsent
                            : null,
                      ]}
                    >
                      {formatMarkLabel(item.mark)}
                      {item.hasPendingOverride ? tr(" · do zapisu", " · pending save") : ""}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.cycleButton,
                      styles.cycleButtonActive,
                      item.mark === 1 ? styles.cycleButtonActiveStrong : null,
                    ]}
                  >
                    <Text style={styles.cycleButtonLabel}>{formatAttendanceValue(item.mark)}</Text>
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
  copy: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.body,
    lineHeight: 22,
    color: tokens.colors.muted,
  },
  instrumentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.spacing.sm,
    paddingBottom: tokens.spacing.xs,
  },
  instrumentHeaderTextCol: {
    flex: 1,
    gap: 2,
  },
  instrumentSummary: {
    fontSize: 11,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  sectionBackButton: {
    alignSelf: "flex-start",
    marginBottom: 2,
  },
  sectionBackButtonLabel: {
    color: tokens.colors.brand,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
  },
  sectionDetailTitle: {
    fontSize: tokens.typography.body,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  memberListContent: {
    marginTop: tokens.spacing.xs,
    gap: 6,
  },
  memberListContentDesktop: {
    gap: 8,
  },
  memberListColumnWrapper: {
    gap: 8,
  },
  memberCell: {
    width: "100%",
  },
  memberCellMultiCol: {
    flex: 1,
  },
  memberPlaceholderCell: {
    flex: 1,
    minHeight: 1,
  },
  memberRow: {
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: tokens.colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  memberRowHinted: {
    backgroundColor: tokens.colors.brandTint,
    borderColor: tokens.colors.brand,
  },
  memberRowPending: {
    borderColor: tokens.colors.brand,
  },
  memberRowDisabled: {
    opacity: 0.65,
  },
  memberRowDesktop: {
    minHeight: 54,
  },
  memberTextCol: {
    flex: 1,
    gap: 2,
  },
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  memberName: {
    flexShrink: 1,
    fontSize: tokens.typography.body,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  memberHintBadge: {
    fontSize: 10,
    color: tokens.colors.brand,
    borderWidth: 1,
    borderColor: tokens.colors.brand,
    borderRadius: tokens.radii.round,
    paddingHorizontal: 6,
    paddingVertical: 1,
    fontWeight: "700",
  },
  memberMeta: {
    fontSize: 11,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  memberMetaPresent: {
    color: tokens.colors.successInk,
  },
  memberMetaAbsent: {
    color: tokens.colors.dangerInk,
  },
  cycleButton: {
    minWidth: 66,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: tokens.radii.round,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    backgroundColor: tokens.colors.surface,
    alignItems: "center",
  },
  cycleButtonActive: {
    borderColor: tokens.colors.brand,
    backgroundColor: tokens.colors.brandTint,
  },
  cycleButtonActiveStrong: {
    borderColor: tokens.colors.successInk,
    backgroundColor: tokens.colors.successSurface,
  },
  cycleButtonLabel: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
});
