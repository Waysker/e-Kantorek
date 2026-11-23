import { StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";

import { tokens } from "../theme/tokens";

type TextFieldProps = Omit<TextInputProps, "style"> & {
  /** Visible label above the field (also its accessibility label). Omit only when a nearby heading names it. */
  label?: string;
  /** Validation message under the field; turns the outline red. */
  error?: string | null;
  /** Small help text under the field. */
  hint?: string;
  style?: StyleProp<ViewStyle>;
};

// Labelled text input: forms (sign-in, sign-up), search, date and month fields.
export function TextField({ label, error, hint, style, accessibilityLabel, ...inputProps }: TextFieldProps) {
  return (
    <View style={[styles.wrap, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        {...inputProps}
        accessibilityLabel={accessibilityLabel ?? label}
        placeholderTextColor={inputProps.placeholderTextColor ?? tokens.colors.muted}
        style={[styles.input, error ? styles.inputError : null]}
      />
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.colors.ink,
  },
  input: {
    minHeight: tokens.controlHeight.lg,
    borderWidth: 1,
    borderColor: tokens.colors.controlBorder,
    borderRadius: tokens.radii.md,
    paddingHorizontal: 14,
    fontSize: 16,
    color: tokens.colors.ink,
    backgroundColor: tokens.colors.surface,
  },
  inputError: {
    borderColor: tokens.colors.dangerInk,
  },
  error: {
    fontSize: 13,
    color: tokens.colors.dangerInk,
  },
  hint: {
    fontSize: 13,
    color: tokens.colors.muted,
  },
});
