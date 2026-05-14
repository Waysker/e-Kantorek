import { Pressable, StyleSheet, Text, View } from "react-native";

import type { AttendanceSummary } from "../domain/models";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";

export type AttendanceSummaryFocusStatus = "going" | "not_going";

type AttendanceSummaryStripProps = {
  summary: AttendanceSummary;
  compact?: boolean;
  includeMaybe?: boolean;
  onSelectStatus?: (status: AttendanceSummaryFocusStatus) => void;
};

export function AttendanceSummaryStrip({
  summary,
  compact,
  includeMaybe = true,
  onSelectStatus,
}: AttendanceSummaryStripProps) {
  const items: Array<{
    key: AttendanceSummaryFocusStatus | "maybe";
    label: string;
    value: number;
    variant: "positive" | "muted" | "negative";
  }> = [
    { key: "going", label: tr("Będę", "Going"), value: summary.going, variant: "positive" },
    { key: "maybe", label: tr("Może", "Maybe"), value: summary.maybe, variant: "muted" },
    { key: "not_going", label: tr("Nie będę", "Not going"), value: summary.notGoing, variant: "negative" },
  ];
  const visibleItems = includeMaybe ? items : items.filter((item) => item.key !== "maybe");

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      {visibleItems.map((item) => (
        <Pressable
          key={item.key}
          onPress={
            onSelectStatus
              ? () => {
                  if (item.key === "maybe") {
                    return;
                  }
                  onSelectStatus(item.key);
                }
              : undefined
          }
          style={({ pressed }) => [
            styles.item,
            compact && styles.itemCompact,
            item.variant === "positive" && styles.itemPositive,
            item.variant === "negative" && styles.itemNegative,
            item.key !== "maybe" && onSelectStatus && styles.itemInteractive,
            item.key !== "maybe" && onSelectStatus && pressed && styles.itemInteractivePressed,
          ]}
        >
          <Text style={styles.itemValue}>{item.value}</Text>
          <Text style={styles.itemLabel}>{item.label}</Text>
        </Pressable>
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
  itemInteractive: {
    borderWidth: 1,
    borderColor: tokens.colors.border,
  },
  itemInteractivePressed: {
    opacity: 0.85,
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
