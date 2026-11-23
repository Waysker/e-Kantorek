import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { TextField } from "../ui/TextField";
import { Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import { textStyles } from "../theme/text";
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

          <TextField
            style={styles.field}
            label={tr("E-mail", "Email")}
            error={showEmailError ? errors.email : null}
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
            editable={!isSubmitting}
          />

          <TextField
            style={styles.field}
            label={tr("Hasło", "Password")}
            error={showPasswordError ? errors.password : null}
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
            editable={!isSubmitting}
            onSubmitEditing={handleSubmit}
          />

          {errorMessage ? <View style={styles.field}><Notice tone="error">{errorMessage}</Notice></View> : null}
          {infoMessage ? <View style={styles.field}><Notice tone="success">{infoMessage}</Notice></View> : null}

          <Button
            size="lg"
            style={styles.submit}
            label={isSubmitting ? tr("Logowanie…", "Signing in…") : tr("Zaloguj się", "Sign in")}
            onPress={handleSubmit}
            disabled={isDisabled}
            loading={isSubmitting}
          />

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
  field: {
    marginTop: tokens.spacing.md,
  },
  submit: {
    marginTop: tokens.spacing.lg,
  },
  title: textStyles.pageTitle,
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 20,
    color: tokens.colors.muted,
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
