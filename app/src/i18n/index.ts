export type AppLocale = "pl" | "en";

function resolveLocale(): AppLocale {
  const raw = process.env.EXPO_PUBLIC_APP_LOCALE?.trim().toLowerCase();
  if (raw === "en") {
    return "en";
  }
  return "pl";
}

export const appLocale: AppLocale = resolveLocale();
export const isPolishLocale = appLocale === "pl";
export const appLocaleTag = isPolishLocale ? "pl-PL" : "en-GB";

export function tr(polish: string, english: string): string {
  return isPolishLocale ? polish : english;
}
