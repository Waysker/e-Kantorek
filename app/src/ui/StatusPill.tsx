import { Text, View } from "react-native";

import type { AttendanceStatus } from "../domain/models";
import { tr } from "../i18n";
import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";

export type StatusMeta = {
  glyph: string;
  label: string;
  bg: string;
  fg: string;
  accent: string;
  needsAction: boolean;
};

// One status language for the whole app: colour + glyph + shape.
// "No response" is the only loud state (amber outline): it needs the user's action.
export function statusMeta(status: AttendanceStatus): StatusMeta {
  switch (status) {
    case "going":
      return {
        glyph: "✓",
        label: tr("Będę", "Going"),
        bg: colors.successSurface,
        fg: colors.successInk,
        accent: colors.successInk,
        needsAction: false,
      };
    case "not_going":
      return {
        glyph: "✕",
        label: tr("Nie będę", "Not going"),
        bg: colors.dangerSurface,
        fg: colors.dangerInk,
        accent: colors.dangerInk,
        needsAction: false,
      };
    case "maybe":
      return {
        glyph: "?",
        label: tr("Może", "Maybe"),
        bg: colors.neutralSurface,
        fg: colors.neutralInk,
        accent: colors.neutralInk,
        needsAction: false,
      };
    case "unknown":
      return {
        glyph: "",
        label: "",
        bg: colors.neutralSurface,
        fg: colors.neutralInk,
        accent: colors.border,
        needsAction: false,
      };
    default:
      return {
        glyph: "!",
        label: tr("Brak deklaracji", "No response"),
        bg: colors.warningSurface,
        fg: colors.warningInk,
        accent: colors.warningBorder,
        needsAction: true,
      };
  }
}

export function StatusPill({ status, large }: { status: AttendanceStatus; large?: boolean }) {
  if (status === "unknown") {
    return null;
  }
  const meta = statusMeta(status);
  return (
    <View
      style={[
        styles.pill,
        large && styles.pillLarge,
        { backgroundColor: meta.bg },
        meta.needsAction && { borderColor: meta.accent },
      ]}
    >
      <Text style={[styles.label, large && styles.labelLarge, { color: meta.fg }]}>
        {meta.glyph} {meta.label}
      </Text>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  pill: {
    alignSelf: "flex-start",
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: 5,
    borderRadius: tokens.radii.round,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  pillLarge: {
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
  },
  labelLarge: {
    fontSize: 15,
  },
}));
