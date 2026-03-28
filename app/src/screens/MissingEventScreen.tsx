import { Pressable, StyleSheet, Text, View } from "react-native";

import { tr } from "../i18n";
import { tokens } from "../theme/tokens";

export function MissingEventScreen({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  return (
    <View style={styles.loadingScreen}>
      <Text style={styles.errorEyebrow}>{title}</Text>
      <Pressable onPress={onBack} style={styles.inlineButton}>
        <Text style={styles.inlineButtonLabel}>{tr("Wróć", "Back")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tokens.spacing.xl,
    backgroundColor: tokens.colors.background,
  },
  errorEyebrow: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: tokens.colors.muted,
  },
  inlineButton: {
    marginTop: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.brand,
  },
  inlineButtonLabel: {
    color: tokens.colors.surface,
    fontWeight: "700",
  },
});
