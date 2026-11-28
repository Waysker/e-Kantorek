import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";

type EmptyStateProps = {
  title?: string;
  /** What will appear here and when ("Wątki z forum pojawią się tutaj automatycznie."). */
  children: ReactNode;
  tone?: "neutral" | "done";
};

// Dashed box for "nothing here yet". `done` = an empty list that is good news
// ("✓ Wszyscy mają przypisany instrument").
export function EmptyState({ title, children, tone = "neutral" }: EmptyStateProps) {
  return (
    <View style={styles.box}>
      {title ? <Text style={[styles.title, tone === "done" && styles.titleDone]}>{title}</Text> : null}
      <Text style={styles.copy}>{children}</Text>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  box: {
    padding: tokens.spacing.lg,
    borderRadius: tokens.radii.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    gap: tokens.spacing.xs,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.ink,
  },
  titleDone: {
    color: colors.successInk,
  },
  copy: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
}));
