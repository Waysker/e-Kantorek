import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { appLocaleTag, tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { formatDateLabel } from "../utils/format";

type FreshnessTone = "fresh" | "stale" | "unknown";

type DataFreshnessBannerProps = {
  dataSourceLabel: string;
  dataSourceGeneratedAt: string | null;
  expectedSyncIntervalHours?: number;
};

function formatDataSourceLabel(label: string) {
  if (label === "Supabase cloud") {
    return tr("Supabase (chmura)", "Supabase cloud");
  }
  if (label === "Local fallback") {
    return tr("Lokalny fallback", "Local fallback");
  }
  if (label === "Supabase cloud (pending)") {
    return tr("Supabase (oczekiwanie)", "Supabase cloud (pending)");
  }
  if (label === "Local snapshot") {
    return tr("Lokalny snapshot", "Local snapshot");
  }
  return label;
}

function formatRelativeAgeLabel(targetTimestampMs: number, nowTimestampMs: number) {
  const diffMs = targetTimestampMs - nowTimestampMs;
  const relativeFormatter = new Intl.RelativeTimeFormat(appLocaleTag, {
    numeric: "auto",
    style: "short",
  });

  const diffMinutes = Math.round(diffMs / (1000 * 60));
  if (Math.abs(diffMinutes) < 60) {
    return relativeFormatter.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  if (Math.abs(diffHours) < 48) {
    return relativeFormatter.format(diffHours, "hour");
  }

  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return relativeFormatter.format(diffDays, "day");
}

export function DataFreshnessBanner({
  dataSourceLabel,
  dataSourceGeneratedAt,
  expectedSyncIntervalHours = 4,
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

  const statusLabel =
    freshness.tone === "fresh"
      ? tr("Dane aktualne", "Data is up to date")
      : freshness.tone === "stale"
        ? tr(
            "Uwaga: dane moga byc nieaktualne",
            "Warning: data may be outdated",
          )
        : tr("Brak metadanych synchronizacji", "Sync metadata unavailable");

  const detailsLabel =
    freshness.syncedAtMs == null
      ? `${tr("Zrodlo", "Source")}: ${formatDataSourceLabel(dataSourceLabel)}. ${tr(
          "Brak czasu ostatniej synchronizacji, traktuj dane ostroznie.",
          "Last sync timestamp is missing, treat data carefully.",
        )}`
      : `${tr("Ostatnia synchronizacja", "Last sync")}: ${formatDateLabel(
          new Date(freshness.syncedAtMs).toISOString(),
        )} (${formatRelativeAgeLabel(freshness.syncedAtMs, nowTimestampMs)}). ${tr(
          "Oczekiwane odswiezenie",
          "Expected refresh",
        )}: <= ${expectedSyncIntervalHours}h. ${tr("Zrodlo", "Source")}: ${formatDataSourceLabel(
          dataSourceLabel,
        )}.`;

  return (
    <View
      style={[
        styles.container,
        freshness.tone === "fresh"
          ? styles.containerFresh
          : freshness.tone === "stale"
            ? styles.containerStale
            : styles.containerUnknown,
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

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    gap: 2,
  },
  containerFresh: {
    backgroundColor: tokens.colors.successSurface,
    borderBottomColor: tokens.colors.successInk,
  },
  containerStale: {
    backgroundColor: tokens.colors.dangerSurface,
    borderBottomColor: tokens.colors.dangerInk,
  },
  containerUnknown: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderBottomColor: tokens.colors.border,
  },
  statusLabel: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: tokens.colors.successInk,
    fontWeight: "700",
  },
  statusLabelStale: {
    color: tokens.colors.dangerInk,
  },
  statusLabelUnknown: {
    color: tokens.colors.muted,
  },
  detailsLabel: {
    fontSize: tokens.typography.caption,
    lineHeight: 16,
    color: tokens.colors.ink,
    fontWeight: "600",
  },
  detailsLabelStale: {
    color: tokens.colors.dangerInk,
  },
  detailsLabelUnknown: {
    color: tokens.colors.muted,
  },
});
