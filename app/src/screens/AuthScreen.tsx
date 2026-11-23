import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput } from "react-native";

import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { AuthLayout } from "../ui/AuthLayout";

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
    <AuthLayout>
          <Text style={styles.title}>{tr("Zaloguj się", "Sign in")}</Text>
          <Text style={styles.subtitle}>
            {tr("Kontem e-Kantorka, osobnym od konta na forum.", "With your e-Kantorek account, separate from the forum.")}
          </Text>

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
            placeholder="ty@przyklad.pl"
            placeholderTextColor={tokens.colors.muted}
            accessibilityLabel={tr("E-mail", "Email")}
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
            placeholderTextColor={tokens.colors.muted}
            accessibilityLabel={tr("Hasło", "Password")}
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
                ? tr("Logowanie…", "Signing in…")
                : tr("Zaloguj się", "Sign in")}
            </Text>
          </Pressable>

          <Pressable
            onPress={onGoToRegister}
            style={styles.secondaryButton}
            disabled={isSubmitting}
          >
            <Text style={styles.secondaryButtonLabel}>
              {tr("Nie masz konta? Załóż je", "No account? Create one")}
            </Text>
          </Pressable>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 26,
    lineHeight: 31,
    fontWeight: "800",
    letterSpacing: -0.4,
    color: tokens.colors.ink,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 20,
    color: tokens.colors.muted,
  },
  label: {
    marginTop: tokens.spacing.md,
    fontSize: 14,
    fontWeight: "600",
    color: tokens.colors.ink,
  },
  input: {
    marginTop: 6,
    minHeight: 48,
    borderWidth: 1,
    borderColor: tokens.colors.borderStrong,
    borderRadius: tokens.radii.md,
    paddingHorizontal: 14,
    fontSize: 16,
    color: tokens.colors.ink,
    backgroundColor: tokens.colors.surface,
  },
  inputError: {
    borderColor: tokens.colors.dangerInk,
  },
  fieldErrorText: {
    marginTop: 4,
    color: tokens.colors.dangerInk,
    fontSize: 13,
  },
  errorText: {
    marginTop: tokens.spacing.md,
    borderRadius: tokens.radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    overflow: "hidden",
    backgroundColor: tokens.colors.dangerSurface,
    color: tokens.colors.dangerInk,
    fontSize: 14,
  },
  infoText: {
    marginTop: tokens.spacing.md,
    borderRadius: tokens.radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    overflow: "hidden",
    backgroundColor: tokens.colors.successSurface,
    color: tokens.colors.successInk,
    fontSize: 14,
  },
  button: {
    marginTop: tokens.spacing.lg,
    minHeight: 48,
    borderRadius: tokens.radii.md,
    backgroundColor: tokens.colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabel: {
    color: tokens.colors.surface,
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    marginTop: tokens.spacing.sm,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonLabel: {
    color: tokens.colors.brand,
    fontSize: 15,
    fontWeight: "600",
  },
});
