import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { OraghInstrument } from "../auth/instruments";
import { ORAGH_INSTRUMENT_OPTIONS } from "../auth/instruments";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { TextField } from "../ui/TextField";
import { Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import { textStyles } from "../theme/text";
import { Chip } from "../ui/Chip";
import { AuthLayout } from "../ui/AuthLayout";

export type RegisterPayload = {
  firstName: string;
  lastName: string;
  instrument: OraghInstrument;
  email: string;
  password: string;
};

type RegisterScreenProps = {
  onRegister: (payload: RegisterPayload) => Promise<void>;
  onGoToSignIn: () => void;
  isSubmitting: boolean;
  errorMessage: string | null;
};

type RegisterField =
  | "firstName"
  | "lastName"
  | "instrument"
  | "email"
  | "password"
  | "passwordConfirmation";

type RegisterErrors = Record<RegisterField, string | null>;

const NAME_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿĄąĆćĘęŁłŃńÓóŚśŹźŻż' -]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRegister(input: {
  firstName: string;
  lastName: string;
  instrument: OraghInstrument | null;
  email: string;
  password: string;
  passwordConfirmation: string;
}): RegisterErrors {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = input.email.trim();

  return {
    firstName:
      firstName.length === 0
        ? tr("Imię jest wymagane.", "First name is required.")
        : NAME_REGEX.test(firstName)
          ? null
          : tr(
              "Imię może zawierać tylko litery, spacje, myślnik lub apostrof.",
              "First name can contain letters, spaces, hyphen, or apostrophe only.",
            ),
    lastName:
      lastName.length === 0
        ? tr("Nazwisko jest wymagane.", "Last name is required.")
        : NAME_REGEX.test(lastName)
          ? null
          : tr(
              "Nazwisko może zawierać tylko litery, spacje, myślnik lub apostrof.",
              "Last name can contain letters, spaces, hyphen, or apostrophe only.",
            ),
    instrument: input.instrument
      ? null
      : tr("Wybierz instrument główny.", "Select a primary instrument."),
    email:
      email.length === 0
        ? tr("E-mail jest wymagany.", "Email is required.")
        : EMAIL_REGEX.test(email)
          ? null
          : tr("Podaj poprawny adres e-mail.", "Enter a valid email address."),
    password:
      input.password.length === 0
        ? tr("Hasło jest wymagane.", "Password is required.")
        : input.password.length < 8
          ? tr("Hasło musi mieć co najmniej 8 znaków.", "Password must be at least 8 characters.")
          : !/[A-Za-z]/.test(input.password) || !/\d/.test(input.password)
            ? tr(
                "Hasło musi zawierać co najmniej jedną literę i jedną cyfrę.",
                "Password must include at least one letter and one number.",
              )
            : null,
    passwordConfirmation:
      input.passwordConfirmation.length === 0
        ? tr("Potwierdzenie hasła jest wymagane.", "Password confirmation is required.")
        : input.password === input.passwordConfirmation
          ? null
          : tr("Hasła muszą być takie same.", "Passwords must match."),
  };
}

export function RegisterScreen({
  onRegister,
  onGoToSignIn,
  isSubmitting,
  errorMessage,
}: RegisterScreenProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [instrument, setInstrument] = useState<OraghInstrument | null>(null);
  const [isInstrumentMenuOpen, setIsInstrumentMenuOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<RegisterField, boolean>>({
    firstName: false,
    lastName: false,
    instrument: false,
    email: false,
    password: false,
    passwordConfirmation: false,
  });

  const errors = useMemo(
    () =>
      validateRegister({
        firstName,
        lastName,
        instrument,
        email,
        password,
        passwordConfirmation,
      }),
    [firstName, lastName, instrument, email, password, passwordConfirmation],
  );

  const hasErrors = Object.values(errors).some(Boolean);
  const isDisabled = isSubmitting || hasErrors;

  function setFieldTouched(field: RegisterField) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  function shouldShowError(field: RegisterField) {
    return (touched[field] || submitAttempted) && errors[field];
  }

  function closeInstrumentMenu() {
    if (isInstrumentMenuOpen) {
      setIsInstrumentMenuOpen(false);
    }
  }

  async function handleSubmit() {
    setSubmitAttempted(true);
    setTouched({
      firstName: true,
      lastName: true,
      instrument: true,
      email: true,
      password: true,
      passwordConfirmation: true,
    });

    if (isDisabled || !instrument) {
      return;
    }

    await onRegister({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      instrument,
      email: email.trim(),
      password,
    });
  }

  function handleInstrumentSelect(option: OraghInstrument) {
    setInstrument(option);
    setFieldTouched("instrument");
    setIsInstrumentMenuOpen(false);
  }

  const showFirstNameError = shouldShowError("firstName");
  const showLastNameError = shouldShowError("lastName");
  const showInstrumentError = shouldShowError("instrument");
  const showEmailError = shouldShowError("email");
  const showPasswordError = shouldShowError("password");
  const showPasswordConfirmationError = shouldShowError("passwordConfirmation");

  return (
    <AuthLayout>
            <Text style={styles.title}>{tr("Załóż konto", "Create account")}</Text>

            <TextField
              style={styles.field}
              label={tr("Imię", "First name")}
              error={showFirstNameError ? errors.firstName : null}
              value={firstName}
              onChangeText={(value) => {
                setFirstName(value);
                setFieldTouched("firstName");
                closeInstrumentMenu();
              }}
              onBlur={() => setFieldTouched("firstName")}
              editable={!isSubmitting}
            />

            <TextField
              style={styles.field}
              label={tr("Nazwisko", "Last name")}
              error={showLastNameError ? errors.lastName : null}
              value={lastName}
              onChangeText={(value) => {
                setLastName(value);
                setFieldTouched("lastName");
                closeInstrumentMenu();
              }}
              onBlur={() => setFieldTouched("lastName")}
              editable={!isSubmitting}
            />

            <Text style={styles.label}>
              {tr("Instrument główny", "Primary instrument")}
            </Text>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {ORAGH_INSTRUMENT_OPTIONS.map((option) => (
                <Chip
                  key={option}
                  role="radio"
                  label={option}
                  selected={option === instrument}
                  disabled={isSubmitting}
                  invalid={Boolean(showInstrumentError)}
                  onPress={() => handleInstrumentSelect(option)}
                />
              ))}
            </View>
            {showInstrumentError ? (
              <Text style={styles.fieldErrorText}>{errors.instrument}</Text>
            ) : null}

            <TextField
              style={styles.field}
              label={tr("E-mail", "Email")}
              error={showEmailError ? errors.email : null}
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                setFieldTouched("email");
                closeInstrumentMenu();
              }}
              onBlur={() => setFieldTouched("email")}
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
                setFieldTouched("password");
                closeInstrumentMenu();
              }}
              onBlur={() => setFieldTouched("password")}
              secureTextEntry
              editable={!isSubmitting}
            />

            <TextField
              style={styles.field}
              label={tr("Potwierdź hasło", "Confirm password")}
              error={showPasswordConfirmationError ? errors.passwordConfirmation : null}
              value={passwordConfirmation}
              onChangeText={(value) => {
                setPasswordConfirmation(value);
                setFieldTouched("passwordConfirmation");
                closeInstrumentMenu();
              }}
              onBlur={() => setFieldTouched("passwordConfirmation")}
              secureTextEntry
              editable={!isSubmitting}
              onSubmitEditing={handleSubmit}
            />

            {errorMessage ? <View style={styles.field}><Notice tone="error">{errorMessage}</Notice></View> : null}

            <Button
              size="lg"
              style={styles.submit}
              label={isSubmitting ? tr("Tworzenie konta…", "Creating account…") : tr("Załóż konto", "Create account")}
              onPress={handleSubmit}
              disabled={isDisabled}
              loading={isSubmitting}
            />

            <Pressable
              onPress={onGoToSignIn}
              style={styles.secondaryButton}
              disabled={isSubmitting}
            >
              <Text style={styles.secondaryButtonLabel}>
                {tr("Masz już konto? Zaloguj się", "Have an account? Sign in")}
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
  label: {
    marginTop: tokens.spacing.md,
    fontSize: 14,
    fontWeight: "600",
    color: tokens.colors.ink,
  },
  fieldErrorText: {
    marginTop: 4,
    color: tokens.colors.dangerInk,
    fontSize: 13,
  },
  title: textStyles.pageTitle,
  chips: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
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
