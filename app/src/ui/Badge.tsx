import { Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";

type BadgeProps = {
  /** A number is capped at 99+. */
  value: number | string;
  /** strong = solid amber count on navigation; soft = amber outline with text ("3 do przypisania"). */
  variant?: "strong" | "soft";
  style?: StyleProp<ViewStyle>;
};

// Count of things waiting for the user. Amber, because it always means "act here".
export function Badge({ value, variant = "strong", style }: BadgeProps) {
  const text = typeof value === "number" ? (value > 99 ? "99+" : String(value)) : value;
  const isStrong = variant === "strong";
  return (
    <View style={[styles.badge, isStrong ? styles.strong : styles.soft, style]}>
      <Text style={[styles.label, isStrong ? styles.labelStrong : styles.labelSoft]}>{text}</Text>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  badge: {
    borderRadius: tokens.radii.round,
    alignItems: "center",
    justifyContent: "center",
  },
  strong: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    backgroundColor: colors.warningStrong,
  },
  soft: {
    height: 22,
    paddingHorizontal: 8,
    borderWidth: 1.5,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
  label: {
    fontWeight: "700",
  },
  labelStrong: {
    fontSize: 11,
    lineHeight: 13,
    color: colors.onStrong,
  },
  labelSoft: {
    fontSize: 12,
    color: colors.warningInk,
  },
}));
