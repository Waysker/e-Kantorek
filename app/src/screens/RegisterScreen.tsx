import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { OraghInstrument } from "../auth/instruments";
import { ORAGH_INSTRUMENT_OPTIONS } from "../auth/instruments";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";

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
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;
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
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.select({ ios: "padding", default: undefined })}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.card, isDesktop && styles.cardDesktop]}>
            <Text style={styles.eyebrow}>ORAGH</Text>
            <Text style={styles.title}>{tr("Załóż konto", "Create account")}</Text>

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
              style={[styles.input, showLastNameError ? styles.inputError : null]}
              editable={!isSubmitting}
            />
            {showLastNameError ? (
              <Text style={styles.fieldErrorText}>{errors.lastName}</Text>
            ) : null}

            <Text style={styles.label}>
              {tr("Instrument główny", "Primary instrument")}
            </Text>
            <View style={styles.dropdownWrap}>
              <Pressable
                style={[
                  styles.dropdownField,
                  isInstrumentMenuOpen && styles.dropdownFieldOpen,
                  showInstrumentError ? styles.dropdownFieldError : null,
                ]}
                onPress={() => {
                  if (isSubmitting) {
                    return;
                  }
                  setFieldTouched("instrument");
                  setIsInstrumentMenuOpen((current) => !current);
                }}
                disabled={isSubmitting}
              >
                <Text
                  style={[
                    styles.dropdownFieldLabel,
                    !instrument && styles.dropdownFieldPlaceholder,
                  ]}
                >
                  {instrument ?? tr("Wybierz instrument...", "Select instrument...")}
                </Text>
                <Text style={styles.dropdownFieldChevron}>
                  {isInstrumentMenuOpen ? "^" : "v"}
                </Text>
              </Pressable>

              {isInstrumentMenuOpen ? (
                <View style={styles.dropdownMenu}>
                  <ScrollView
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator
                    style={styles.dropdownScroll}
                  >
                    {ORAGH_INSTRUMENT_OPTIONS.map((option) => (
                      <Pressable
                        key={option}
                        onPress={() => handleInstrumentSelect(option)}
                        style={[
                          styles.dropdownOption,
                          option === instrument && styles.dropdownOptionSelected,
                        ]}
                      >
                        <Text
                          style={[
                            styles.dropdownOptionLabel,
                            option === instrument &&
                              styles.dropdownOptionLabelSelected,
                          ]}
                        >
                          {option}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
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
                setFieldTouched("password");
                closeInstrumentMenu();
              }}
              onBlur={() => setFieldTouched("password")}
              secureTextEntry
              placeholder={tr("Hasło", "Password")}
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
                  ? tr("Tworzenie konta...", "Creating account...")
                  : tr("Załóż konto", "Create account")}
              </Text>
            </Pressable>

            <Pressable
              onPress={onGoToSignIn}
              style={styles.secondaryButton}
              disabled={isSubmitting}
            >
              <Text style={styles.secondaryButtonLabel}>
                {tr("Wróć do logowania", "Back to sign in")}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
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
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: tokens.spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 560,
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
  dropdownWrap: {
    position: "relative",
    zIndex: 10,
    marginTop: tokens.spacing.xs,
  },
  dropdownField: {
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: 12,
    backgroundColor: tokens.colors.paper,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacing.sm,
  },
  dropdownFieldOpen: {
    borderColor: tokens.colors.brand,
  },
  dropdownFieldError: {
    borderColor: tokens.colors.dangerInk,
  },
  dropdownFieldLabel: {
    flex: 1,
    color: tokens.colors.ink,
    fontSize: tokens.typography.body,
  },
  dropdownFieldPlaceholder: {
    color: tokens.colors.muted,
  },
  dropdownFieldChevron: {
    color: tokens.colors.muted,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
  },
  dropdownMenu: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    backgroundColor: tokens.colors.surface,
    overflow: "hidden",
    maxHeight: 240,
  },
  dropdownScroll: {
    maxHeight: 240,
  },
  dropdownOption: {
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
  },
  dropdownOptionSelected: {
    backgroundColor: tokens.colors.brandTint,
  },
  dropdownOptionLabel: {
    color: tokens.colors.ink,
    fontSize: tokens.typography.body,
  },
  dropdownOptionLabelSelected: {
    color: tokens.colors.brand,
    fontWeight: "700",
  },
  errorText: {
    marginTop: tokens.spacing.sm,
    color: tokens.colors.dangerInk,
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
