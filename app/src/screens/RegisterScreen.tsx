import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { OraghInstrument } from "../auth/instruments";
import { ORAGH_INSTRUMENT_OPTIONS } from "../auth/instruments";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
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
            <Text style={styles.subtitle}>
              {tr(
                "Konto w e-Kantorku jest osobne od konta na forum.",
                "Your e-Kantorek account is separate from the forum.",
              )}
            </Text>

            <Text style={styles.label}>{tr("Imię", "First name")}</Text>
            <TextInput
              value={firstName}
              onChangeText={(value) => {
                setFirstName(value);
                setFieldTouched("firstName");
                closeInstrumentMenu();
              }}
              onBlur={() => setFieldTouched("firstName")}
              placeholder={tr("Imię", "First name")}
              placeholderTextColor={tokens.colors.muted}
              style={[styles.input, showFirstNameError ? styles.inputError : null]}
              editable={!isSubmitting}
            />
            {showFirstNameError ? (
              <Text style={styles.fieldErrorText}>{errors.firstName}</Text>
            ) : null}

            <Text style={styles.label}>{tr("Nazwisko", "Last name")}</Text>
            <TextInput
              value={lastName}
              onChangeText={(value) => {
                setLastName(value);
                setFieldTouched("lastName");
                closeInstrumentMenu();
              }}
              onBlur={() => setFieldTouched("lastName")}
              placeholder={tr("Nazwisko", "Last name")}
              placeholderTextColor={tokens.colors.muted}
              style={[styles.input, showLastNameError ? styles.inputError : null]}
              editable={!isSubmitting}
            />
            {showLastNameError ? (
              <Text style={styles.fieldErrorText}>{errors.lastName}</Text>
            ) : null}

            <Text style={styles.label}>
              {tr("Instrument główny", "Primary instrument")}
            </Text>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {ORAGH_INSTRUMENT_OPTIONS.map((option) => {
                const isSelected = option === instrument;
                return (
                  <Pressable
                    key={option}
                    onPress={() => handleInstrumentSelect(option)}
                    disabled={isSubmitting}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isSelected }}
                    style={[
                      styles.chip,
                      isSelected && styles.chipSelected,
                      showInstrumentError ? styles.chipError : null,
                    ]}
                  >
                    <Text style={[styles.chipLabel, isSelected && styles.chipLabelSelected]}>
                      {isSelected ? "✓ " : ""}
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {showInstrumentError ? (
              <Text style={styles.fieldErrorText}>{errors.instrument}</Text>
            ) : null}

            <Text style={styles.label}>{tr("E-mail", "Email")}</Text>
            <TextInput
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
              placeholderTextColor={tokens.colors.muted}
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
                setFieldTouched("password");
                closeInstrumentMenu();
              }}
              onBlur={() => setFieldTouched("password")}
              secureTextEntry
              placeholder={tr("Hasło", "Password")}
              placeholderTextColor={tokens.colors.muted}
              style={[styles.input, showPasswordError ? styles.inputError : null]}
              editable={!isSubmitting}
            />
            {showPasswordError ? (
              <Text style={styles.fieldErrorText}>{errors.password}</Text>
            ) : null}

            <Text style={styles.label}>
              {tr("Potwierdź hasło", "Confirm password")}
            </Text>
            <TextInput
              value={passwordConfirmation}
              onChangeText={(value) => {
                setPasswordConfirmation(value);
                setFieldTouched("passwordConfirmation");
                closeInstrumentMenu();
              }}
              onBlur={() => setFieldTouched("passwordConfirmation")}
              secureTextEntry
              placeholder={tr("Powtórz hasło", "Repeat password")}
              placeholderTextColor={tokens.colors.muted}
              style={[
                styles.input,
                showPasswordConfirmationError ? styles.inputError : null,
              ]}
              editable={!isSubmitting}
              onSubmitEditing={handleSubmit}
            />
            {showPasswordConfirmationError ? (
              <Text style={styles.fieldErrorText}>{errors.passwordConfirmation}</Text>
            ) : null}

            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

            <Pressable
              onPress={handleSubmit}
              style={[styles.button, isDisabled && styles.buttonDisabled]}
              disabled={isDisabled}
            >
              <Text style={styles.buttonLabel}>
                {isSubmitting
                  ? tr("Tworzenie konta…", "Creating account…")
                  : tr("Załóż konto", "Create account")}
              </Text>
            </Pressable>

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
  chips: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: tokens.radii.round,
    borderWidth: 1,
    borderColor: tokens.colors.borderStrong,
    backgroundColor: tokens.colors.surface,
    justifyContent: "center",
  },
  chipSelected: {
    backgroundColor: tokens.colors.brand,
    borderColor: tokens.colors.brand,
  },
  chipError: {
    borderColor: tokens.colors.dangerInk,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.colors.ink,
  },
  chipLabelSelected: {
    color: tokens.colors.surface,
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
