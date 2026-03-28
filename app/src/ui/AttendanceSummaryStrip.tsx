import { StyleSheet, Text, View } from "react-native";

import type { AttendanceSummary } from "../domain/models";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";

type AttendanceSummaryStripProps = {
  summary: AttendanceSummary;
  compact?: boolean;
};

export function AttendanceSummaryStrip({
  summary,
  compact,
}: AttendanceSummaryStripProps) {
  const items = [
    { label: tr("Będę", "Going"), value: summary.going, variant: "positive" },
    { label: tr("Może", "Maybe"), value: summary.maybe, variant: "muted" },
    { label: tr("Nie będę", "Not going"), value: summary.notGoing, variant: "negative" },
  ] as const;

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      {items.map((item) => (
        <View
          key={item.label}
          style={[
            styles.item,
            compact && styles.itemCompact,
            item.variant === "positive" && styles.itemPositive,
            item.variant === "negative" && styles.itemNegative,
          ]}
        >
          <Text style={styles.itemValue}>{item.value}</Text>
          <Text style={styles.itemLabel}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: tokens.spacing.sm,
    marginTop: tokens.spacing.md,
  },
  rowCompact: {
    marginTop: tokens.spacing.sm,
  },
  item: {
    flex: 1,
    borderRadius: tokens.radii.md,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.sm,
    backgroundColor: tokens.colors.surfaceMuted,
  },
  itemCompact: {
    paddingVertical: 8,
  },
  itemPositive: {
    backgroundColor: tokens.colors.successSurface,
  },
  itemNegative: {
    backgroundColor: tokens.colors.dangerSurface,
  },
  itemValue: {
    fontSize: tokens.typography.body,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  itemLabel: {
    marginTop: 2,
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
  },
});
