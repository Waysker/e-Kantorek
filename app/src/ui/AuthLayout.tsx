import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { tr } from "../i18n";
import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";

type AuthLayoutProps = {
  children: ReactNode;
};

// Shared frame for sign-in and sign-up: brand panel (left on desktop, top on
// phones) and the form on a white card.
export function AuthLayout({ children }: AuthLayoutProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;

  const brand = (
    <View style={[styles.brand, isDesktop && styles.brandDesktop]}>
      <Text style={[styles.wordmark, isDesktop && styles.wordmarkDesktop]}>e-Kantorek</Text>
      <Text style={styles.orchestra}>Orkiestra Reprezentacyjna AGH</Text>
      {isDesktop ? (
        <Text style={styles.tagline}>
          {tr(
            "Wydarzenia, deklaracje, skład i setlisty w jednym miejscu. Dane z forum, bez szukania po wątkach.",
            "Events, declarations, line-ups and setlists in one place. Forum data without digging through threads.",
          )}
        </Text>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={[styles.screen, isDesktop && styles.screenDesktop]} edges={["top"]}>
      {isDesktop ? brand : null}
      <KeyboardAvoidingView
        style={styles.formSide}
        behavior={Platform.select({ ios: "padding", default: undefined })}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, isDesktop && styles.scrollContentDesktop]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {!isDesktop ? brand : null}
          <View style={[styles.card, isDesktop && styles.cardDesktop]}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = themedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenDesktop: {
    flexDirection: "row",
  },
  brand: {
    backgroundColor: colors.brandDeep,
    paddingHorizontal: tokens.spacing.lg,
    paddingTop: tokens.spacing.xl,
    paddingBottom: 56,
    gap: 4,
  },
  brandDesktop: {
    width: "42%",
    maxWidth: 560,
    justifyContent: "center",
    paddingHorizontal: 56,
    paddingBottom: tokens.spacing.xl,
    gap: tokens.spacing.sm,
  },
  wordmark: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "800",
    letterSpacing: -0.6,
    color: colors.onStrong,
  },
  wordmarkDesktop: {
    fontSize: 48,
    lineHeight: 54,
  },
  orchestra: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.brandDeepAccent,
  },
  tagline: {
    marginTop: tokens.spacing.md,
    maxWidth: 420,
    fontSize: 17,
    lineHeight: 25,
    color: colors.brandDeepMuted,
  },
  formSide: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: tokens.spacing.xl,
  },
  scrollContentDesktop: {
    justifyContent: "center",
    padding: tokens.spacing.xl,
  },
  card: {
    alignSelf: "stretch",
    marginTop: -32,
    marginHorizontal: tokens.spacing.md,
    backgroundColor: colors.surface,
    borderRadius: tokens.radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: tokens.spacing.lg,
  },
  cardDesktop: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    marginHorizontal: 0,
    marginTop: 0,
    padding: tokens.spacing.xl,
  },
}));
