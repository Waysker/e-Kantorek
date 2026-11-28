import { Pressable, Text, View } from "react-native";

import { tr } from "../i18n";
import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";
import { StatusMark } from "./StatusMark";
import { Tag } from "./Tag";

type SectionTileProps = {
  label: string;
  going: number;
  notGoing: number;
  /** The user's own section: shows the "Twoja" tag. */
  mine?: boolean;
  selected?: boolean;
  /** Desktop: bigger marks and more room. */
  large?: boolean;
  onPress: () => void;
};

// One instrument section of the line-up: counts and one mark per person.
// The whole tile is the touch target; see the SectionTile card in Partytura.
export function SectionTile({
  label,
  going,
  notGoing,
  mine,
  selected,
  large,
  onPress,
}: SectionTileProps) {
  const marks = [
    ...Array.from({ length: going }, () => "going" as const),
    ...Array.from({ length: notGoing }, () => "not_going" as const),
  ];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={`${label}: ${going} ${tr("będzie", "going")}, ${notGoing} ${tr("nie będzie", "not going")}`}
      style={(state) => [
        styles.tile,
        large && styles.tileLarge,
        (state as { hovered?: boolean }).hovered && !selected && styles.tileHovered,
        selected && (large ? styles.tileSelectedLarge : styles.tileSelected),
      ]}
    >
      <View style={styles.top}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>{label}</Text>
          {mine ? <Tag label={tr("Twoja", "Yours")} /> : null}
        </View>
        <View style={styles.counts}>
          <Text style={[styles.count, { color: colors.successInk }]}>✓ {going}</Text>
          {notGoing > 0 ? (
            <Text style={[styles.count, { color: colors.dangerInk }]}>✕ {notGoing}</Text>
          ) : null}
        </View>
      </View>
      <View style={styles.marks}>
        {marks.map((status, index) => (
          <StatusMark key={index} status={status} size={large ? 20 : 18} />
        ))}
      </View>
    </Pressable>
  );
}

const styles = themedStyles((colors) => ({
  tile: {
    flex: 1,
    minWidth: 0,
    minHeight: 96,
    padding: 14,
    gap: tokens.spacing.sm,
    borderRadius: tokens.radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tileLarge: {
    minHeight: 120,
    padding: tokens.spacing.md,
  },
  tileHovered: {
    borderColor: colors.controlBorder,
  },
  // 2px edge with 1px less padding, so the content doesn't move.
  tileSelected: {
    borderWidth: 2,
    borderColor: colors.brand,
    padding: 13,
  },
  tileSelectedLarge: {
    borderWidth: 2,
    borderColor: colors.brand,
    padding: tokens.spacing.md - 1,
  },
  top: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: tokens.spacing.xs,
  },
  labelRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.spacing.xs,
  },
  label: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
    color: colors.ink,
  },
  counts: {
    flexDirection: "row",
    gap: 8,
  },
  count: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
  },
  marks: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
}));
