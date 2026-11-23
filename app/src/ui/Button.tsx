import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

import { tokens } from "../theme/tokens";
import { Icon, type IconName } from "./Icon";

type ButtonProps = {
  label: string;
  onPress?: () => void;
  /** primary = the one main action on a screen; secondary = everything else. */
  variant?: "primary" | "secondary";
  /** md (44) for toolbars and cards; lg (48) for forms and the declaration CTA. */
  size?: "md" | "lg";
  disabled?: boolean;
  loading?: boolean;
  /** Icon after the label, e.g. "external" for links that leave the app. */
  trailingIcon?: IconName;
  accessibilityRole?: "button" | "link";
  style?: StyleProp<ViewStyle>;
};

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  disabled,
  loading,
  trailingIcon,
  accessibilityRole = "button",
  style,
}: ButtonProps) {
  const isPrimary = variant === "primary";
  const color = isPrimary ? tokens.colors.surface : tokens.colors.ink;
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={(state) => [
        styles.button,
        { minHeight: tokens.controlHeight[size] },
        isPrimary ? styles.primary : styles.secondary,
        (state as { hovered?: boolean }).hovered && !isDisabled && (isPrimary ? styles.primaryHovered : styles.secondaryHovered),
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={color} /> : null}
      <Text style={[styles.label, size === "lg" && styles.labelLarge, { color }]}>{label}</Text>
      {trailingIcon && !loading ? (
        <Icon name={trailingIcon} size={16} color={color} strokeWidth={2.2} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 18,
    borderRadius: tokens.radii.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primary: {
    backgroundColor: tokens.colors.brand,
  },
  primaryHovered: {
    backgroundColor: tokens.colors.successInk,
  },
  secondary: {
    borderWidth: 1,
    borderColor: tokens.colors.controlBorder,
    backgroundColor: tokens.colors.surface,
  },
  secondaryHovered: {
    backgroundColor: tokens.colors.paper,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
  },
  labelLarge: {
    fontSize: 16,
  },
});
