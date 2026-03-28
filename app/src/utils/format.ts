import { appLocaleTag, tr } from "../i18n";

export function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat(appLocaleTag, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function formatRelativeLabel(value: string) {
  const now = Date.now();
  const target = new Date(value).getTime();
  const diffHours = Math.round((target - now) / (1000 * 60 * 60));

  if (Math.abs(diffHours) < 24) {
    if (diffHours === 0) {
      return tr("teraz", "now");
    }

    const relativeFormatter = new Intl.RelativeTimeFormat(appLocaleTag, {
      numeric: "always",
      style: "long",
    });
    return relativeFormatter.format(diffHours, "hour");
  }

  return new Intl.DateTimeFormat(appLocaleTag, {
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}
