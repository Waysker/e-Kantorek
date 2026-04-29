import { Pressable, StyleSheet, Text, View } from "react-native";

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

export function SectionGridPanel({ rows, onSelectSection }: SectionGridPanelProps) {
  return (
    <>
      <Text style={styles.sectionTitle}>
        {tr("Sekcje według ustawienia na próbie", "Sections by rehearsal seating")}
      </Text>
      <Text style={styles.copy}>
        {tr(
          "Wybierz sekcję, aby odklikać obecność jej muzyków. Licznik pokazuje odklikane osoby (wartość > 0) względem składu sekcji.",
          "Pick a section to mark attendance for its players. Counter shows marked players (value > 0) against section size.",
        )}
      </Text>

      <View style={styles.sectionGrid}>
        {rows.map((row, rowIndex) => (
          <View key={`section-row-${rowIndex}`} style={styles.sectionGridRow}>
            {row.map((item) => {
              return (
                <Pressable
                  key={item.key}
                  onPress={() => onSelectSection(item.key)}
                  style={[
                    styles.sectionTile,
                    item.totalMembers === 0 && styles.sectionTileEmpty,
                  ]}
                >
                  <Text style={styles.sectionTileLabel}>{item.label}</Text>
                  <Text style={styles.sectionTileMeta}>
                    {item.totalMembers > 0
                      ? tr(
                        `${item.markedMembers}/${item.totalMembers} odklikane`,
                        `${item.markedMembers}/${item.totalMembers} marked`,
                      )
                      : tr("Brak składu", "No members")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: tokens.typography.title,
    lineHeight: 28,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  copy: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.body,
    lineHeight: 22,
    color: tokens.colors.muted,
  },
  sectionGrid: {
    marginTop: tokens.spacing.sm,
    gap: tokens.spacing.xs,
  },
  sectionGridRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: tokens.spacing.xs,
  },
  sectionTile: {
    flex: 1,
    minHeight: 84,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.sm,
    backgroundColor: tokens.colors.surface,
    justifyContent: "space-between",
    gap: tokens.spacing.xs,
  },
  sectionTileEmpty: {
    opacity: 0.65,
    backgroundColor: tokens.colors.surfaceMuted,
  },
  sectionTileLabel: {
    color: tokens.colors.ink,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
  },
  sectionTileMeta: {
    color: tokens.colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
});
