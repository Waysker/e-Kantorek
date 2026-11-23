import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { tr } from "../../i18n";
import { tokens } from "../../theme/tokens";

export type SectionGridTile = {
  key: string;
  label: string;
  totalMembers: number;
  markedMembers: number;
};

type SectionGridPanelProps = {
  rows: SectionGridTile[][];
  onSelectSection: (sectionKey: string) => void;
};

// Sections laid out like the rehearsal seating; each tile shows marking progress.
export function SectionGridPanel({ rows, onSelectSection }: SectionGridPanelProps) {
  const { width } = useWindowDimensions();
  // On narrow screens the seating rows (up to 5 tiles) get too cramped, so the
  // tiles are laid out two per row in the same order instead.
  const isNarrow = width < 600;
  const layoutRows = isNarrow
    ? rows.flat().reduce<SectionGridTile[][]>((acc, tile, index) => {
        if (index % 2 === 0) {
          acc.push([tile]);
        } else {
          acc[acc.length - 1].push(tile);
        }
        return acc;
      }, [])
    : rows;

  return (
    <>
      <View style={styles.header}>
        <Text style={styles.kicker}>{tr("Sekcje", "Sections")}</Text>
        <Text style={styles.hint}>
          {tr("Układ jak na próbie. Wybierz sekcję, aby odklikać obecność.", "Laid out like rehearsal seating. Pick a section to mark attendance.")}
        </Text>
      </View>

      <View style={styles.grid}>
        {layoutRows.map((row, rowIndex) => (
          <View key={`section-row-${rowIndex}`} style={styles.row}>
            {row.map((item) => {
              const isEmpty = item.totalMembers === 0;
              const isDone = !isEmpty && item.markedMembers >= item.totalMembers;
              const progress = isEmpty ? 0 : item.markedMembers / item.totalMembers;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => onSelectSection(item.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.label}, ${item.markedMembers}/${item.totalMembers}`}
                  style={(state) => [
                    styles.tile,
                    isEmpty && styles.tileEmpty,
                    isDone && styles.tileDone,
                    ((state as { hovered?: boolean }).hovered || state.pressed) && styles.tileHovered,
                  ]}
                >
                  <Text style={[styles.label, isEmpty && styles.labelEmpty]} numberOfLines={2}>
                    {item.label}
                  </Text>
                  {isEmpty ? (
                    <Text style={styles.meta}>{tr("Brak składu", "No members")}</Text>
                  ) : (
                    <View style={styles.progressBlock}>
                      <Text style={[styles.meta, isDone && styles.metaDone]}>
                        {isDone ? "✓ " : ""}
                        {item.markedMembers}/{item.totalMembers}
                      </Text>
                      <View style={styles.track}>
                        <View
                          style={[
                            styles.fill,
                            { width: `${Math.round(progress * 100)}%` },
                            isDone && styles.fillDone,
                          ]}
                        />
                      </View>
                    </View>
                  )}
                </Pressable>
              );
            })}
            {isNarrow && row.length === 1 ? <View style={styles.tileSpacer} /> : null}
          </View>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: 2,
  },
  kicker: {
    fontSize: tokens.typography.caption,
    fontWeight: "600",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: tokens.colors.muted,
  },
  hint: {
    fontSize: 13,
    color: tokens.colors.muted,
  },
  grid: {
    gap: tokens.spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: tokens.spacing.xs,
  },
  tile: {
    flex: 1,
    minHeight: 76,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    padding: tokens.spacing.sm,
    backgroundColor: tokens.colors.surface,
    justifyContent: "space-between",
    gap: tokens.spacing.xs,
  },
  tileSpacer: {
    flex: 1,
  },
  tileHovered: {
    borderColor: tokens.colors.brand,
  },
  tileEmpty: {
    backgroundColor: tokens.colors.paper,
    borderStyle: "dashed",
  },
  tileDone: {
    backgroundColor: tokens.colors.successSurface,
    borderColor: tokens.colors.successSurface,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.colors.ink,
  },
  labelEmpty: {
    color: tokens.colors.muted,
  },
  progressBlock: {
    gap: 4,
  },
  meta: {
    fontSize: 12,
    fontWeight: "600",
    color: tokens.colors.muted,
  },
  metaDone: {
    color: tokens.colors.successInk,
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: tokens.colors.surfaceMuted,
    overflow: "hidden",
  },
  fill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: tokens.colors.brand,
  },
  fillDone: {
    backgroundColor: tokens.colors.successInk,
  },
});
