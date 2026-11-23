import { StyleSheet, Text, View } from "react-native";

import type { AttendanceStatus } from "../domain/models";
import { tr } from "../i18n";
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
        bg: tokens.colors.successSurface,
        fg: tokens.colors.successInk,
        accent: tokens.colors.successInk,
        needsAction: false,
      };
    case "not_going":
      return {
        glyph: "✕",
        label: tr("Nie będę", "Not going"),
        bg: tokens.colors.dangerSurface,
        fg: tokens.colors.dangerInk,
        accent: tokens.colors.dangerInk,
        needsAction: false,
      };
    case "maybe":
      return {
        glyph: "?",
        label: tr("Może", "Maybe"),
        bg: tokens.colors.neutralSurface,
        fg: tokens.colors.neutralInk,
        accent: tokens.colors.neutralInk,
        needsAction: false,
      };
    default:
      return {
        glyph: "!",
        label: tr("Brak deklaracji", "No response"),
        bg: tokens.colors.warningSurface,
        fg: tokens.colors.warningInk,
        accent: tokens.colors.warningBorder,
        needsAction: true,
      };
  }
}

export function StatusPill({ status, large }: { status: AttendanceStatus; large?: boolean }) {
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

const styles = StyleSheet.create({
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
});
