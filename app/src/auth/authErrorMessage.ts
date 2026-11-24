import { tr } from "../i18n";

type AuthAction = "sign_in" | "sign_up" | "session" | "sign_out";

type AuthErrorLike = {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  name?: unknown;
};

// Turns a Supabase Auth error into a short Polish message for members.
// Matches on `code` (newer GoTrue) and falls back to the English message
// (older self-hosted GoTrue). The raw error goes to the console.
export function authErrorMessage(error: unknown, action: AuthAction): string {
  const details = (typeof error === "object" && error !== null ? error : {}) as AuthErrorLike;
  const code = typeof details.code === "string" ? details.code : "";
  const status = typeof details.status === "number" ? details.status : null;
  const message = typeof details.message === "string" ? details.message.toLowerCase() : "";
  const name = typeof details.name === "string" ? details.name : "";

  console.warn(`[auth:${action}]`, error);

  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return tr("Nieprawidłowy e-mail lub hasło.", "Incorrect email or password.");
  }
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return tr(
      "Najpierw potwierdź e-mail. Link jest w wiadomości wysłanej po założeniu konta.",
      "Confirm your email first. The link is in the message sent after signing up.",
    );
  }
  if (
    code === "user_already_exists" ||
    code === "email_exists" ||
    message.includes("already registered")
  ) {
    return tr(
      "Konto z tym adresem e-mail już istnieje. Zaloguj się.",
      "An account with this email already exists. Sign in instead.",
    );
  }
  if (code === "weak_password" || message.includes("password should")) {
    return tr("Hasło jest za słabe. Wybierz dłuższe.", "The password is too weak. Choose a longer one.");
  }
  if (code === "email_address_invalid" || (message.includes("email address") && message.includes("invalid"))) {
    return tr("Podaj poprawny adres e-mail.", "Enter a valid email address.");
  }
  if (code === "signup_disabled" || message.includes("signups not allowed")) {
    return tr("Zakładanie kont jest teraz wyłączone.", "Sign-up is currently turned off.");
  }
  if (code.startsWith("over_") || status === 429 || message.includes("rate limit")) {
    return tr(
      "Zbyt wiele prób. Odczekaj kilka minut i spróbuj ponownie.",
      "Too many attempts. Wait a few minutes and try again.",
    );
  }
  if (name === "AuthRetryableFetchError" || message.includes("failed to fetch") || message.includes("network")) {
    return tr(
      "Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.",
      "Can't reach the server. Check your connection and try again.",
    );
  }

  switch (action) {
    case "sign_in":
      return tr("Nie udało się zalogować. Spróbuj ponownie.", "Could not sign in. Try again.");
    case "sign_up":
      return tr("Nie udało się założyć konta. Spróbuj ponownie.", "Could not create the account. Try again.");
    case "session":
      return tr("Nie udało się sprawdzić sesji. Zaloguj się ponownie.", "Could not check your session. Sign in again.");
    case "sign_out":
      return tr("Nie udało się wylogować. Spróbuj ponownie.", "Could not sign out. Try again.");
  }
}
