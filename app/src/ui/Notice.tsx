import type { ReactNode } from "react";
import { StyleSheet, Text } from "react-native";

import { tokens } from "../theme/tokens";

export type NoticeTone = "error" | "success" | "warning" | "info";

type NoticeProps = {
  tone: NoticeTone;
  children: ReactNode;
};

const TONES: Record<NoticeTone, { bg: string; fg: string }> = {
  error: { bg: tokens.colors.dangerSurface, fg: tokens.colors.dangerInk },
  success: { bg: tokens.colors.successSurface, fg: tokens.colors.successInk },
  warning: { bg: tokens.colors.warningSurface, fg: tokens.colors.warningInk },
  info: { bg: tokens.colors.surfaceMuted, fg: tokens.colors.neutralInk },
};

// Inline message bar: save results, errors, "unsaved changes".
export function Notice({ tone, children }: NoticeProps) {
  const colors = TONES[tone];
  return (
    <Text
      style={[styles.notice, { backgroundColor: colors.bg, color: colors.fg }]}
      accessibilityRole={tone === "error" ? "alert" : undefined}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  notice: {
    fontSize: 14,
    lineHeight: 20,
    borderRadius: tokens.radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    overflow: "hidden",
  },
});
