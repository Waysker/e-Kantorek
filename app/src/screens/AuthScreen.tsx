import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { tr } from "../i18n";
import { tokens } from "../theme/tokens";

type AuthScreenProps = {
  onSignIn: (email: string, password: string) => Promise<void>;
  onGoToRegister: () => void;
  isSubmitting: boolean;
  errorMessage: string | null;
  infoMessage?: string | null;
};

type LoginErrors = {
  email: string | null;
  password: string | null;
};

function validateLogin(email: string, password: string): LoginErrors {
  const trimmedEmail = email.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  return {
    email:
      trimmedEmail.length === 0
        ? tr("E-mail jest wymagany.", "Email is required.")
        : emailRegex.test(trimmedEmail)
          ? null
          : tr("Podaj poprawny adres e-mail.", "Enter a valid email address."),
    password:
      password.trim().length === 0
        ? tr("Hasło jest wymagane.", "Password is required.")
        : null,
  };
}

export function AuthScreen({
  onSignIn,
  onGoToRegister,
  isSubmitting,
  errorMessage,
  infoMessage,
}: AuthScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);

  const errors = useMemo(() => validateLogin(email, password), [email, password]);
  const isDisabled =
    isSubmitting || Boolean(errors.email) || Boolean(errors.password);

  async function handleSubmit() {
    setSubmitAttempted(true);
    setEmailTouched(true);
    setPasswordTouched(true);

    if (isDisabled) {
      return;
    }
    await onSignIn(email.trim(), password);
  }

  const showEmailError = (emailTouched || submitAttempted) && errors.email;
  const showPasswordError = (passwordTouched || submitAttempted) && errors.password;

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.select({ ios: "padding", default: undefined })}
      >
        <View style={[styles.card, isDesktop && styles.cardDesktop]}>
          <Text style={styles.eyebrow}>ORAGH</Text>
          <Text style={styles.title}>{tr("Zaloguj się", "Sign in")}</Text>

          <Text style={styles.label}>{tr("E-mail", "Email")}</Text>
          <TextInput
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              if (!emailTouched) {
                setEmailTouched(true);
              }
            }}
            onBlur={() => setEmailTouched(true)}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="you@example.com"
            style={[styles.input, showEmailError ? styles.inputError : null]}
            editable={!isSubmitting}
          />
          {showEmailError ? (
            <Text style={styles.fieldErrorText}>{errors.email}</Text>
          ) : null}

          <Text style={styles.label}>{tr("Hasło", "Password")}</Text>
          <TextInput
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              if (!passwordTouched) {
                setPasswordTouched(true);
              }
            }}
            onBlur={() => setPasswordTouched(true)}
            secureTextEntry
            placeholder={tr("Twoje hasło", "Your password")}
            style={[styles.input, showPasswordError ? styles.inputError : null]}
            editable={!isSubmitting}
            onSubmitEditing={handleSubmit}
          />
          {showPasswordError ? (
            <Text style={styles.fieldErrorText}>{errors.password}</Text>
          ) : null}

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
          {infoMessage ? <Text style={styles.infoText}>{infoMessage}</Text> : null}

          <Pressable
            onPress={handleSubmit}
            style={[styles.button, isDisabled && styles.buttonDisabled]}
            disabled={isDisabled}
          >
            <Text style={styles.buttonLabel}>
              {isSubmitting
                ? tr("Logowanie...", "Signing in...")
                : tr("Zaloguj się", "Sign in")}
            </Text>
          </Pressable>

          <Pressable
            onPress={onGoToRegister}
            style={styles.secondaryButton}
            disabled={isSubmitting}
          >
            <Text style={styles.secondaryButtonLabel}>
              {tr("Załóż konto", "Create account")}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: tokens.colors.background,
  },
  keyboardContainer: {
    flex: 1,
    justifyContent: "center",
    padding: tokens.spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radii.lg,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    padding: tokens.spacing.lg,
  },
  cardDesktop: {
    padding: tokens.spacing.xl,
  },
  eyebrow: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1.1,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  title: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.hero,
    lineHeight: 34,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  label: {
    marginTop: tokens.spacing.md,
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  input: {
    marginTop: tokens.spacing.xs,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: 12,
    fontSize: tokens.typography.body,
    color: tokens.colors.ink,
    backgroundColor: tokens.colors.paper,
  },
  inputError: {
    borderColor: tokens.colors.dangerInk,
  },
  fieldErrorText: {
    marginTop: tokens.spacing.xs,
    color: tokens.colors.dangerInk,
    fontSize: tokens.typography.caption,
  },
  errorText: {
    marginTop: tokens.spacing.sm,
    color: tokens.colors.dangerInk,
    fontSize: tokens.typography.caption,
  },
  infoText: {
    marginTop: tokens.spacing.sm,
    color: tokens.colors.successInk,
    fontSize: tokens.typography.caption,
  },
  button: {
    marginTop: tokens.spacing.lg,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.brand,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonLabel: {
    color: tokens.colors.surface,
    fontSize: tokens.typography.body,
    fontWeight: "700",
  },
  secondaryButton: {
    marginTop: tokens.spacing.sm,
    borderRadius: tokens.radii.round,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: tokens.colors.surface,
  },
  secondaryButtonLabel: {
    color: tokens.colors.ink,
    fontSize: tokens.typography.body,
    fontWeight: "700",
  },
});
