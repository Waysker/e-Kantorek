import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";
import { Icon, type IconName } from "./Icon";

export type SegmentOption<K extends string> = {
  key: K;
  label: string;
  icon?: IconName;
};

type SegmentedControlProps<K extends string> = {
  options: SegmentOption<K>[];
  value: K;
  onChange: (key: K) => void;
  style?: StyleProp<ViewStyle>;
  /** Name of the whole control for screen readers ("Wygląd"). */
  accessibilityLabel?: string;
};

// Switch between views of the same content (Lista / Kalendarz, Nadchodzące / Minione).
// For choosing a value in a form use Chip; for status use StatusPill.
export function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
  style,
  accessibilityLabel,
}: SegmentedControlProps<K>) {
  return (
    <View style={[styles.track, style]} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const isActive = option.key === value;
        const color = isActive ? colors.ink : colors.muted;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            style={[styles.segment, isActive && styles.segmentActive]}
          >
            {option.icon ? <Icon name={option.icon} size={16} color={color} /> : null}
            <Text style={[styles.label, { color }]} numberOfLines={2}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themedStyles((colors) => ({
  track: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: tokens.radii.md,
    backgroundColor: colors.surfaceMuted,
  },
  segment: {
    flex: 1,
    minHeight: tokens.controlHeight.sm,
    paddingHorizontal: 6,
    borderRadius: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  segmentActive: {
    backgroundColor: colors.surface,
    ...tokens.shadow.raised,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
}));
