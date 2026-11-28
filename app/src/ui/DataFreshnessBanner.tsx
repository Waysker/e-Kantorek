import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";

import { tr } from "../i18n";
import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";
import { formatDateLabel, formatRelativeTime } from "../utils/format";

type FreshnessTone = "fresh" | "stale" | "unknown";

type DataFreshnessBannerProps = {
  dataSourceLabel: string;
  dataSourceGeneratedAt: string | null;
  expectedSyncIntervalHours?: number;
};

function formatRelativeAgeLabel(targetTimestampMs: number, nowTimestampMs: number) {
  const diffMs = targetTimestampMs - nowTimestampMs;

  const diffMinutes = Math.round(diffMs / (1000 * 60));
  if (Math.abs(diffMinutes) < 60) {
    return formatRelativeTime(diffMinutes, "minute", {
      numeric: "auto",
      style: "short",
    });
  }

  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  if (Math.abs(diffHours) < 48) {
    return formatRelativeTime(diffHours, "hour", {
      numeric: "auto",
      style: "short",
    });
  }

  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return formatRelativeTime(diffDays, "day", {
    numeric: "auto",
    style: "short",
  });
}

export function DataFreshnessBanner({
  dataSourceLabel,
  dataSourceGeneratedAt,
  expectedSyncIntervalHours = 1,
}: DataFreshnessBannerProps) {
  const [nowTimestampMs, setNowTimestampMs] = useState(() => Date.now());

  useEffect(() => {
    const timerId = setInterval(() => {
      setNowTimestampMs(Date.now());
    }, 60_000);

    return () => clearInterval(timerId);
  }, []);

  const freshness = useMemo(() => {
    if (!dataSourceGeneratedAt) {
      return { tone: "unknown" as FreshnessTone, syncedAtMs: null };
    }

    const syncedAtMs = Date.parse(dataSourceGeneratedAt);
    if (!Number.isFinite(syncedAtMs)) {
      return { tone: "unknown" as FreshnessTone, syncedAtMs: null };
    }

    const expectedMaxAgeMs = expectedSyncIntervalHours * 60 * 60 * 1000;
    const ageMs = Math.max(0, nowTimestampMs - syncedAtMs);
    if (ageMs > expectedMaxAgeMs) {
      return { tone: "stale" as FreshnessTone, syncedAtMs };
    }

    return { tone: "fresh" as FreshnessTone, syncedAtMs };
  }, [dataSourceGeneratedAt, expectedSyncIntervalHours, nowTimestampMs]);

  // Show the banner only when data is stale or its freshness is unknown.
  if (freshness.tone === "fresh") {
    return null;
  }

  const statusLabel =
    freshness.tone === "stale"
      ? tr("Dane mogą być nieaktualne", "Data may be outdated")
      : tr("Nie wiemy, kiedy dane były aktualizowane", "Last update time unknown");

  const detailsLabel =
    freshness.syncedAtMs == null
      ? tr(
          "Sprawdź szczegóły wydarzeń na forum.",
          "Check event details on the forum.",
        )
      : `${tr("Ostatnia synchronizacja z forum", "Last forum sync")}: ${formatDateLabel(
          new Date(freshness.syncedAtMs).toISOString(),
        )} (${formatRelativeAgeLabel(freshness.syncedAtMs, nowTimestampMs)}).`;

  return (
    <View
      style={[
        styles.container,
        freshness.tone === "stale" ? styles.containerStale : styles.containerUnknown,
      ]}
    >
      <Text
        style={[
          styles.statusLabel,
          freshness.tone === "stale"
            ? styles.statusLabelStale
            : freshness.tone === "unknown"
              ? styles.statusLabelUnknown
              : null,
        ]}
      >
        {statusLabel}
      </Text>
      <Text
        style={[
          styles.detailsLabel,
          freshness.tone === "stale"
            ? styles.detailsLabelStale
            : freshness.tone === "unknown"
              ? styles.detailsLabelUnknown
              : null,
        ]}
      >
        {detailsLabel}
      </Text>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  container: {
    borderBottomWidth: 1,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    gap: 2,
  },
  containerStale: {
    backgroundColor: colors.dangerSurface,
    borderBottomColor: colors.dangerInk,
  },
  containerUnknown: {
    backgroundColor: colors.surfaceMuted,
    borderBottomColor: colors.border,
  },
  statusLabel: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: colors.successInk,
    fontWeight: "700",
  },
  statusLabelStale: {
    color: colors.dangerInk,
  },
  statusLabelUnknown: {
    color: colors.muted,
  },
  detailsLabel: {
    fontSize: tokens.typography.caption,
    lineHeight: 16,
    color: colors.ink,
    fontWeight: "600",
  },
  detailsLabelStale: {
    color: colors.dangerInk,
  },
  detailsLabelUnknown: {
    color: colors.muted,
  },
}));
