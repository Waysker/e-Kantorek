import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { supabaseAuthClient } from "../auth/supabaseAuthClient";
import {
  CANONICAL_INSTRUMENT_OPTIONS,
  canonicalizeInstrumentLabel,
  normalizeInstrumentKey,
} from "../domain/instruments";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { SurfaceCard } from "../ui/SurfaceCard";

type AttendanceSummaryScreenProps = {
  onBack: () => void;
};

type MemberRow = {
  member_id: string;
  full_name: string;
  instrument: string | null;
};

type AttendanceEntryRow = {
  member_id: string;
  attendance_ratio: number;
  updated_at: string;
};

type MemberSummaryRow = {
  memberId: string;
  fullName: string;
  points: number;
  percent: number;
};

type SectionSummary = {
  key: string;
  label: string;
  members: MemberSummaryRow[];
};

type ScopePreset = "season" | "30d" | "90d" | "ytd" | "all";

const REFERENCE_SHEET_ID = normalizeWhitespace(
  process.env.EXPO_PUBLIC_ATTENDANCE_REFERENCE_SHEET_ID ?? "",
);

function normalizeWhitespace(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function toIsoDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDateStrict(value: string): string | null {
  const normalized = normalizeWhitespace(value);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const date = new Date(`${normalized}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return toIsoDateLocal(date) === normalized ? normalized : null;
}

function getDefaultSeasonScope(todayDate = new Date()): { startDate: string; endDate: string } {
  const today = new Date(todayDate);
  const year = today.getMonth() >= 9 ? today.getFullYear() : today.getFullYear() - 1;
  return {
    startDate: `${year}-10-01`,
    endDate: toIsoDateLocal(today),
  };
}

function getPresetScope(preset: ScopePreset): { startDate: string; endDate: string } {
  const now = new Date();
  const endDate = toIsoDateLocal(now);

  if (preset === "season") {
    return getDefaultSeasonScope(now);
  }

  if (preset === "30d" || preset === "90d") {
    const dayOffset = preset === "30d" ? 29 : 89;
    const start = new Date(now);
    start.setDate(now.getDate() - dayOffset);
    return {
      startDate: toIsoDateLocal(start),
      endDate,
    };
  }

  if (preset === "ytd") {
    return {
      startDate: `${now.getFullYear()}-01-01`,
      endDate,
    };
  }

  return {
    startDate: "2000-01-01",
    endDate,
  };
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/, "");
}

function compareSectionLabels(left: string, right: string): number {
  const leftIndex = CANONICAL_INSTRUMENT_OPTIONS.findIndex(
    (option) => normalizeInstrumentKey(option) === normalizeInstrumentKey(left),
  );
  const rightIndex = CANONICAL_INSTRUMENT_OPTIONS.findIndex(
    (option) => normalizeInstrumentKey(option) === normalizeInstrumentKey(right),
  );

  if (leftIndex >= 0 && rightIndex >= 0) {
    return leftIndex - rightIndex;
  }

  if (leftIndex >= 0) {
    return -1;
  }

  if (rightIndex >= 0) {
    return 1;
  }

  return left.localeCompare(right, "pl");
}

export function AttendanceSummaryScreen({ onBack }: AttendanceSummaryScreenProps) {
  const defaultScope = useMemo(() => getDefaultSeasonScope(), []);
  const [scopeStartDate, setScopeStartDate] = useState(defaultScope.startDate);
  const [scopeEndDate, setScopeEndDate] = useState(defaultScope.endDate);
  const [startDateInput, setStartDateInput] = useState(defaultScope.startDate);
  const [endDateInput, setEndDateInput] = useState(defaultScope.endDate);
  const [totalEvents, setTotalEvents] = useState(0);
  const [sections, setSections] = useState<SectionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const applyPreset = useCallback((preset: ScopePreset) => {
    const next = getPresetScope(preset);
    setStartDateInput(next.startDate);
    setEndDateInput(next.endDate);
    setScopeStartDate(next.startDate);
    setScopeEndDate(next.endDate);
    setErrorMessage(null);
  }, []);

  const applyCustomScope = useCallback(() => {
    const parsedStartDate = parseIsoDateStrict(startDateInput);
    const parsedEndDate = parseIsoDateStrict(endDateInput);

    if (!parsedStartDate || !parsedEndDate) {
      setErrorMessage(
        tr(
          "Zakres dat musi być w formacie RRRR-MM-DD.",
          "Date range must use YYYY-MM-DD format.",
        ),
      );
      return;
    }

    if (parsedStartDate > parsedEndDate) {
      setErrorMessage(
        tr("Data początkowa nie może być późniejsza niż końcowa.", "Start date cannot be after end date."),
      );
      return;
    }

    setScopeStartDate(parsedStartDate);
    setScopeEndDate(parsedEndDate);
    setErrorMessage(null);
  }, [endDateInput, startDateInput]);

  useEffect(() => {
    let isDisposed = false;

    async function loadSummary() {
      if (!supabaseAuthClient) {
        setErrorMessage(tr("Brak konfiguracji Supabase.", "Supabase is not configured."));
        setSections([]);
        setTotalEvents(0);
        setIsLoading(false);
        return;
      }

      if (!REFERENCE_SHEET_ID) {
        setErrorMessage(
          tr(
            "Brak EXPO_PUBLIC_ATTENDANCE_REFERENCE_SHEET_ID. Panel liczy tylko dane z ref attendance.",
            "Missing EXPO_PUBLIC_ATTENDANCE_REFERENCE_SHEET_ID. This panel computes only from ref attendance data.",
          ),
        );
        setSections([]);
        setTotalEvents(0);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        const [membersResult, eventsResult, latestSyncRunResult] = await Promise.all([
          supabaseAuthClient
            .from("members")
            .select("member_id,full_name,instrument")
            .eq("is_active", true)
            .order("instrument", { ascending: true })
            .order("full_name", { ascending: true }),
          supabaseAuthClient
            .from("events")
            .select("event_id")
            .eq("source_sheet_id", REFERENCE_SHEET_ID)
            .gte("event_date", scopeStartDate)
            .lte("event_date", scopeEndDate)
            .order("event_date", { ascending: true }),
          supabaseAuthClient
            .from("sync_runs")
            .select("finished_at")
            .eq("pipeline_name", "sheet_to_supabase_sync")
            .eq("status", "success")
            .not("finished_at", "is", null)
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle<{ finished_at: string }>(),
        ]);

        if (isDisposed) {
          return;
        }

        if (membersResult.error) {
          throw new Error(membersResult.error.message);
        }

        if (eventsResult.error) {
          throw new Error(eventsResult.error.message);
        }
        if (latestSyncRunResult.error) {
          throw new Error(latestSyncRunResult.error.message);
        }

        const members = ((membersResult.data ?? []) as MemberRow[]).filter(
          (member) => normalizeWhitespace(member.member_id).length > 0,
        );
        const latestSyncFinishedAt = normalizeWhitespace(latestSyncRunResult.data?.finished_at ?? "");
        if (!latestSyncFinishedAt) {
          throw new Error(
            tr(
              "Brak zakończonego synca ref -> DB (sheet_to_supabase_sync). Nie liczę podsumowania z niezweryfikowanego stanu.",
              "No completed ref -> DB sync (sheet_to_supabase_sync). Summary is blocked for unverified state.",
            ),
          );
        }

        const eventIds = (eventsResult.data ?? [])
          .map((event) => normalizeWhitespace(event.event_id))
          .filter((eventId) => eventId.length > 0);

        const eventsCount = eventIds.length;
        setTotalEvents(eventsCount);

        let entries: AttendanceEntryRow[] = [];
        if (eventIds.length > 0) {
          const entriesResult = await supabaseAuthClient
            .from("attendance_entries")
            .select("member_id,attendance_ratio,updated_at")
            .in("event_id", eventIds);

          if (entriesResult.error) {
            throw new Error(entriesResult.error.message);
          }

          entries = (entriesResult.data ?? []) as AttendanceEntryRow[];
        }

        if (isDisposed) {
          return;
        }

        const latestEntryUpdatedAt = entries.reduce<string>(
          (currentLatest, entry) => {
            const updatedAt = normalizeWhitespace(entry.updated_at);
            if (!updatedAt) {
              return currentLatest;
            }
            return !currentLatest || updatedAt > currentLatest ? updatedAt : currentLatest;
          },
          "",
        );

        if (latestEntryUpdatedAt && latestEntryUpdatedAt > latestSyncFinishedAt) {
          throw new Error(
            tr(
              "Wykryto zmiany obecności po ostatnim syncu ref -> DB. Podsumowanie zablokowane, żeby nie pokazać punktacji różnej od ref.",
              "Detected attendance changes after the last ref -> DB sync. Summary is blocked to avoid showing values that can differ from ref.",
            ),
          );
        }

        const pointsByMemberId = new Map<string, number>();
        for (const entry of entries) {
          const memberId = normalizeWhitespace(entry.member_id);
          if (!memberId) {
            continue;
          }
          const currentPoints = pointsByMemberId.get(memberId) ?? 0;
          const nextPoints = currentPoints + Number(entry.attendance_ratio ?? 0);
          pointsByMemberId.set(memberId, nextPoints);
        }

        const sectionBuckets = new Map<string, MemberSummaryRow[]>();
        for (const member of members) {
          const sectionLabel = canonicalizeInstrumentLabel(
            member.instrument,
            tr("Nieprzypisany", "Unassigned"),
          );

          const points = pointsByMemberId.get(member.member_id) ?? 0;
          const percent = eventsCount > 0 ? (points / eventsCount) * 100 : 0;
          const row: MemberSummaryRow = {
            memberId: member.member_id,
            fullName: member.full_name,
            points,
            percent,
          };

          const bucket = sectionBuckets.get(sectionLabel) ?? [];
          bucket.push(row);
          sectionBuckets.set(sectionLabel, bucket);
        }

        const nextSections = Array.from(sectionBuckets.entries())
          .sort(([leftLabel], [rightLabel]) => compareSectionLabels(leftLabel, rightLabel))
          .map(([label, rows]) => ({
            key: normalizeInstrumentKey(label),
            label,
            members: [...rows].sort((left, right) => left.fullName.localeCompare(right.fullName, "pl")),
          }));

        setSections(nextSections);
      } catch (error) {
        setSections([]);
        setTotalEvents(0);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : tr("Nie udało się policzyć podsumowania obecności.", "Failed to compute attendance summary."),
        );
      } finally {
        if (!isDisposed) {
          setIsLoading(false);
        }
      }
    }

    void loadSummary();

    return () => {
      isDisposed = true;
    };
  }, [scopeEndDate, scopeStartDate]);

  return (
    <ScrollView style={styles.screenScroll} contentContainerStyle={styles.screenContent}>
      <SurfaceCard variant="default">
        <Text style={styles.cardEyebrow}>{tr("Panel obecności", "Attendance panel")}</Text>
        <Text style={styles.cardTitle}>{tr("Podsumowanie sekcyjne", "Section attendance summary")}</Text>
        <Text style={styles.cardBody}>
          {tr(
            "Źródło prawdy: ref attendance. Wynik liczymy wyłącznie z wydarzeń zsynchronizowanych z arkusza referencyjnego.",
            "Source of truth: ref attendance. We compute only from events synced from the reference sheet.",
          )}
        </Text>
        <Text style={styles.cardSecondary}>
          {tr("Ref sheet", "Ref sheet")}: {REFERENCE_SHEET_ID || "-"}
        </Text>
        <Pressable style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonLabel}>{tr("← Wróć do profilu", "← Back to profile")}</Text>
        </Pressable>
      </SurfaceCard>

      <SurfaceCard variant="default">
        <Text style={styles.sectionTitle}>{tr("Zakres liczenia", "Calculation scope")}</Text>
        <Text style={styles.cardSecondary}>
          {tr("Domyślnie: od 1 października do dziś.", "Default: from October 1st to today.")}
        </Text>

        <View style={styles.presetRow}>
          <Pressable style={styles.presetButton} onPress={() => applyPreset("season")}>
            <Text style={styles.presetButtonLabel}>{tr("Sezon", "Season")}</Text>
          </Pressable>
          <Pressable style={styles.presetButton} onPress={() => applyPreset("30d")}>
            <Text style={styles.presetButtonLabel}>{tr("30 dni", "30 days")}</Text>
          </Pressable>
          <Pressable style={styles.presetButton} onPress={() => applyPreset("90d")}>
            <Text style={styles.presetButtonLabel}>{tr("90 dni", "90 days")}</Text>
          </Pressable>
          <Pressable style={styles.presetButton} onPress={() => applyPreset("ytd")}>
            <Text style={styles.presetButtonLabel}>{tr("Rok", "YTD")}</Text>
          </Pressable>
          <Pressable style={styles.presetButton} onPress={() => applyPreset("all")}>
            <Text style={styles.presetButtonLabel}>{tr("Wszystko", "All")}</Text>
          </Pressable>
        </View>

        <View style={styles.scopeInputsRow}>
          <View style={styles.scopeInputBlock}>
            <Text style={styles.scopeInputLabel}>{tr("Od", "From")}</Text>
            <TextInput
              value={startDateInput}
              onChangeText={setStartDateInput}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.scopeInput}
            />
          </View>
          <View style={styles.scopeInputBlock}>
            <Text style={styles.scopeInputLabel}>{tr("Do", "To")}</Text>
            <TextInput
              value={endDateInput}
              onChangeText={setEndDateInput}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.scopeInput}
            />
          </View>
        </View>

        <Pressable style={styles.applyButton} onPress={applyCustomScope}>
          <Text style={styles.applyButtonLabel}>{tr("Przelicz zakres", "Apply scope")}</Text>
        </Pressable>

        <Text style={styles.cardSecondary}>
          {tr("Aktywny zakres", "Active scope")}: {scopeStartDate} → {scopeEndDate}
        </Text>
      </SurfaceCard>

      <SurfaceCard variant="default">
        <Text style={styles.sectionTitle}>{tr("Wynik", "Result")}</Text>
        <Text style={styles.cardSecondary}>
          {tr("Liczba wydarzeń w zakresie", "Number of events in scope")}: {totalEvents}
        </Text>

        {isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={tokens.colors.brand} />
          </View>
        ) : null}

        {!isLoading && errorMessage ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {!isLoading && !errorMessage && sections.length === 0 ? (
          <Text style={styles.cardBody}>
            {tr("Brak muzyków lub danych do policzenia w tym zakresie.", "No members or no data to compute in this scope.")}
          </Text>
        ) : null}

        {!isLoading && !errorMessage
          ? sections.map((section) => (
              <View key={section.key} style={styles.sectionBlock}>
                <Text style={styles.sectionLabel}>{section.label}</Text>
                <View style={styles.memberTable}>
                  {section.members.map((member) => (
                    <View key={member.memberId} style={styles.memberRow}>
                      <Text style={styles.memberName}>{member.fullName}</Text>
                      <View style={styles.memberMetrics}>
                        <Text style={styles.memberPercent}>{formatPercent(member.percent)}</Text>
                        <Text style={styles.memberPoints}>
                          {formatPoints(member.points)} {tr("pkt", "pts")}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ))
          : null}
      </SurfaceCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screenScroll: {
    flex: 1,
  },
  screenContent: {
    padding: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  cardEyebrow: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: tokens.colors.muted,
    marginBottom: tokens.spacing.xs,
    fontWeight: "700",
  },
  cardTitle: {
    fontSize: tokens.typography.title,
    lineHeight: 28,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  cardBody: {
    marginTop: tokens.spacing.sm,
    fontSize: tokens.typography.body,
    lineHeight: 23,
    color: tokens.colors.ink,
  },
  cardSecondary: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    color: tokens.colors.muted,
  },
  backButton: {
    marginTop: tokens.spacing.md,
    alignSelf: "flex-start",
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: tokens.colors.border,
  },
  backButtonLabel: {
    color: tokens.colors.ink,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  sectionTitle: {
    fontSize: tokens.typography.body,
    lineHeight: 24,
    fontWeight: "700",
    color: tokens.colors.ink,
  },
  presetRow: {
    marginTop: tokens.spacing.sm,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.xs,
  },
  presetButton: {
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.xs,
    borderRadius: tokens.radii.round,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    backgroundColor: tokens.colors.surfaceMuted,
  },
  presetButtonLabel: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.ink,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  scopeInputsRow: {
    marginTop: tokens.spacing.md,
    flexDirection: "row",
    gap: tokens.spacing.sm,
    flexWrap: "wrap",
  },
  scopeInputBlock: {
    flexGrow: 1,
    minWidth: 160,
  },
  scopeInputLabel: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
    marginBottom: tokens.spacing.xs,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  scopeInput: {
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.sm,
    color: tokens.colors.ink,
    backgroundColor: tokens.colors.surface,
  },
  applyButton: {
    marginTop: tokens.spacing.md,
    alignSelf: "flex-start",
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.brand,
  },
  applyButtonLabel: {
    color: tokens.colors.surface,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  loadingWrap: {
    marginTop: tokens.spacing.md,
    alignItems: "flex-start",
  },
  errorBox: {
    marginTop: tokens.spacing.md,
    padding: tokens.spacing.sm,
    borderRadius: tokens.radii.md,
    backgroundColor: tokens.colors.dangerSurface,
  },
  errorText: {
    color: tokens.colors.dangerInk,
    fontSize: tokens.typography.body,
    lineHeight: 22,
  },
  sectionBlock: {
    marginTop: tokens.spacing.md,
    borderTopWidth: 1,
    borderTopColor: tokens.colors.border,
    paddingTop: tokens.spacing.sm,
  },
  sectionLabel: {
    fontSize: tokens.typography.body,
    lineHeight: 24,
    fontWeight: "700",
    color: tokens.colors.ink,
    marginBottom: tokens.spacing.xs,
  },
  memberTable: {
    gap: tokens.spacing.xs,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacing.sm,
    paddingVertical: 4,
  },
  memberName: {
    flex: 1,
    fontSize: tokens.typography.body,
    lineHeight: 22,
    color: tokens.colors.ink,
  },
  memberMetrics: {
    alignItems: "flex-end",
    minWidth: 110,
  },
  memberPercent: {
    fontSize: tokens.typography.body,
    lineHeight: 20,
    fontWeight: "700",
    color: tokens.colors.ink,
  },
  memberPoints: {
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    color: tokens.colors.muted,
  },
});
