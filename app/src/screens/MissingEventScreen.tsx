import { Pressable, Text, View } from "react-native";

import { tr } from "../i18n";
import { colors, themedStyles } from "../theme/theme";
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

const styles = themedStyles((colors) => ({
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tokens.spacing.xl,
    backgroundColor: colors.background,
  },
  errorEyebrow: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: colors.muted,
  },
  inlineButton: {
    marginTop: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radii.round,
    backgroundColor: colors.brand,
  },
  inlineButtonLabel: {
    color: colors.onBrand,
    fontWeight: "700",
  },
}));
