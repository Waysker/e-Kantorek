import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";

type CardProps = {
  children: ReactNode;
  /** "list" = rows separated by dividers (no inner padding at the top/bottom). */
  variant?: "default" | "list" | "action";
  style?: StyleProp<ViewStyle>;
};

// White surface for a group of content. "action" is the amber card used only
// for things that wait for the user (e.g. a missing declaration).
export function Card({ children, variant = "default", style }: CardProps) {
  return (
    <View
      style={[
        styles.card,
        variant === "list" && styles.list,
        variant === "action" && styles.action,
        style,
      ]}
    >
      {children}
    </View>
  );
}

// Use on every list row except the first: index > 0 && listRowStyles.divider.
export const listRowStyles = themedStyles((colors) => ({
  divider: {
    borderTopWidth: 1,
    borderTopColor: colors.surfaceMuted,
  },
}));

const styles = themedStyles((colors) => ({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: tokens.radii.lg,
    padding: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  list: {
    paddingVertical: 0,
    paddingHorizontal: 0,
    gap: 0,
    overflow: "hidden",
  },
  action: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderWidth: 1.5,
  },
}));
