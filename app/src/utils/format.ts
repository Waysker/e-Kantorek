import { appLocaleTag, tr } from "../i18n";

type RelativeTimeUnit = "minute" | "hour" | "day";

export function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat(appLocaleTag, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatRelativeTimeFallback(value: number, unit: RelativeTimeUnit): string {
  if (value === 0) {
    return tr("teraz", "now");
  }

  const absoluteValue = Math.abs(value);
  const isFuture = value > 0;
  const isPolish = appLocaleTag.toLowerCase().startsWith("pl");

  if (isPolish) {
    const shortLabel =
      unit === "minute" ? "min" : unit === "hour" ? "godz." : "dni";
    return isFuture
      ? `za ${absoluteValue} ${shortLabel}`
      : `${absoluteValue} ${shortLabel} temu`;
  }

  const englishLabel =
    unit === "minute"
      ? absoluteValue === 1
        ? "minute"
        : "minutes"
      : unit === "hour"
        ? absoluteValue === 1
          ? "hour"
          : "hours"
        : absoluteValue === 1
          ? "day"
          : "days";
  return isFuture
    ? `in ${absoluteValue} ${englishLabel}`
    : `${absoluteValue} ${englishLabel} ago`;
}

export function formatRelativeTime(
  value: number,
  unit: RelativeTimeUnit,
  options: Intl.RelativeTimeFormatOptions = {
    numeric: "always",
    style: "long",
  },
): string {
  if (
    typeof Intl !== "undefined" &&
    typeof Intl.RelativeTimeFormat === "function"
  ) {
    return new Intl.RelativeTimeFormat(appLocaleTag, options).format(value, unit);
  }

  return formatRelativeTimeFallback(value, unit);
}

export function formatRelativeLabel(value: string) {
  const now = Date.now();
  const target = new Date(value).getTime();
  const diffHours = Math.round((target - now) / (1000 * 60 * 60));

  if (Math.abs(diffHours) < 24) {
    return formatRelativeTime(diffHours, "hour", {
      numeric: "always",
      style: "long",
    });
  }

  return new Intl.DateTimeFormat(appLocaleTag, {
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}
