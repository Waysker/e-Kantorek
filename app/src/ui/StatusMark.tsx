import { StyleSheet, Text, View } from "react-native";

import { tokens } from "../theme/tokens";
import { statusMeta } from "./StatusPill";

type StatusMarkProps = {
  status: "going" | "not_going";
  /** 18 on phones, 20 on desktop. */
  size?: 18 | 20;
};

// One person's declaration in a tally: filled ✓ for going, outlined ✕ for not
// going (glyph and shape differ, so it reads without colour). Decoration only:
// the written count next to it carries the meaning for screen readers.
export function StatusMark({ status, size = 18 }: StatusMarkProps) {
  const meta = statusMeta(status);
  const isGoing = status === "going";
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={[
        styles.mark,
        { width: size, height: size },
        isGoing
          ? { backgroundColor: tokens.colors.successInk }
          : { backgroundColor: meta.bg, borderWidth: 1.5, borderColor: meta.fg },
      ]}
    >
      <Text
        style={[
          styles.glyph,
          { fontSize: size === 20 ? 11 : 10, color: isGoing ? tokens.colors.surface : meta.fg },
        ]}
      >
        {meta.glyph}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    borderRadius: tokens.radii.round,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: {
    fontWeight: "700",
    lineHeight: 12,
  },
});
