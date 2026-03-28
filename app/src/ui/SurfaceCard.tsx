import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, View } from "react-native";

import { tokens } from "../theme/tokens";

type SurfaceCardProps = {
  children: ReactNode;
  variant: "default" | "muted" | "outline" | "brandTint" | "paper";
  style?: StyleProp<ViewStyle>;
};

export function SurfaceCard({ children, variant, style }: SurfaceCardProps) {
  return (
    <View
      style={[
        styles.card,
        variant === "muted" && styles.muted,
        variant === "outline" && styles.outline,
        variant === "brandTint" && styles.brandTint,
        variant === "paper" && styles.paper,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: tokens.radii.lg,
    padding: tokens.spacing.lg,
    backgroundColor: tokens.colors.surface,
    borderWidth: 1,
    borderColor: tokens.colors.border,
  },
  muted: {
    backgroundColor: tokens.colors.surfaceMuted,
  },
  outline: {
    backgroundColor: "transparent",
  },
  brandTint: {
    backgroundColor: tokens.colors.brandTint,
  },
  paper: {
    backgroundColor: tokens.colors.paper,
  },
});
