import { Pressable, StyleSheet, Text } from "react-native";

import { tokens } from "../theme/tokens";

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  /** "action" = amber, for "needs your attention" filters. */
  tone?: "default" | "action";
  /** Show a red outline (form validation). */
  invalid?: boolean;
  /** "radio" for choosing one value, "button" for filters and toggles. */
  role?: "radio" | "button";
  /** For a chip that opens or closes a panel ("Własny zakres ▾"). */
  expanded?: boolean;
};

// Pill for picking a value or a filter: instruments, roles filter, date ranges.
export function Chip({
  label,
  selected = false,
  onPress,
  disabled,
  tone = "default",
  invalid,
  role = "button",
  expanded,
}: ChipProps) {
  const isAction = tone === "action";
  // Pressing the already-chosen radio does nothing, but it is not "unavailable".
  const blocksPress = disabled || (role === "radio" && selected);
  return (
    <Pressable
      onPress={onPress}
      disabled={blocksPress}
      hitSlop={4}
      accessibilityRole={role}
      accessibilityState={
        role === "radio"
          ? { checked: selected, disabled: disabled && !selected }
          : { selected, disabled, expanded }
      }
      style={(state) => [
        styles.chip,
        isAction && styles.chipAction,
        selected && (isAction ? styles.chipActionSelected : styles.chipSelected),
        invalid && !selected && styles.chipInvalid,
        disabled && !selected && styles.chipDisabled,
        (state as { hovered?: boolean }).hovered && !selected && !blocksPress && styles.chipHovered,
      ]}
    >
      <Text style={[styles.label, isAction && styles.labelAction, selected && styles.labelSelected]}>
        {/* One text node: browser translators replace text nodes, and React
            crashes if it has to insert a sibling next to a replaced one. */}
        {selected && role === "radio" ? `✓ ${label}` : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: tokens.controlHeight.sm,
    paddingHorizontal: 14,
    borderRadius: tokens.radii.round,
    borderWidth: 1,
    borderColor: tokens.colors.controlBorder,
    backgroundColor: tokens.colors.surface,
    justifyContent: "center",
  },
  chipHovered: {
    borderColor: tokens.colors.brand,
  },
  chipSelected: {
    backgroundColor: tokens.colors.brand,
    borderColor: tokens.colors.brand,
  },
  chipAction: {
    borderWidth: 1.5,
    borderColor: tokens.colors.warningBorder,
    backgroundColor: tokens.colors.warningSurface,
  },
  chipActionSelected: {
    backgroundColor: tokens.colors.warningStrong,
    borderColor: tokens.colors.warningStrong,
  },
  chipInvalid: {
    borderColor: tokens.colors.dangerInk,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.colors.ink,
  },
  labelAction: {
    color: tokens.colors.warningInk,
  },
  labelSelected: {
    color: tokens.colors.surface,
  },
});
