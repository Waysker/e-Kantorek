import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

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

// Use on every list row except the first: index > 0 && listRowDivider.
export const listRowDivider: ViewStyle = {
  borderTopWidth: 1,
  borderTopColor: tokens.colors.surfaceMuted,
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.colors.surface,
    borderWidth: 1,
    borderColor: tokens.colors.border,
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
    backgroundColor: tokens.colors.warningSurface,
    borderColor: tokens.colors.warningBorder,
    borderWidth: 1.5,
  },
});
