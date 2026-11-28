import type { ReactNode } from "react";
import { Text } from "react-native";

import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";

export type NoticeTone = "error" | "success" | "warning" | "info";

type NoticeProps = {
  tone: NoticeTone;
  children: ReactNode;
};

function toneColors(tone: NoticeTone): { bg: string; fg: string } {
  const tones: Record<NoticeTone, { bg: string; fg: string }> = {
    error: { bg: colors.dangerSurface, fg: colors.dangerInk },
    success: { bg: colors.successSurface, fg: colors.successInk },
    warning: { bg: colors.warningSurface, fg: colors.warningInk },
    info: { bg: colors.surfaceMuted, fg: colors.neutralInk },
  };
  return tones[tone];
}

// Inline message bar: save results, errors, "unsaved changes".
export function Notice({ tone, children }: NoticeProps) {
  const toneColor = toneColors(tone);
  return (
    <Text
      style={[styles.notice, { backgroundColor: toneColor.bg, color: toneColor.fg }]}
      accessibilityRole={tone === "error" ? "alert" : undefined}
    >
      {children}
    </Text>
  );
}

const styles = themedStyles((colors) => ({
  notice: {
    fontSize: 14,
    lineHeight: 20,
    borderRadius: tokens.radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    overflow: "hidden",
  },
}));
