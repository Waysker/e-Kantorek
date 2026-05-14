import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
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
  event_id: string;
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

type ScopePreset = "season" | "30d" | "90d" | "current_month" | "previous_month" | "last_3_months" | "ytd" | "all";
type SortMode = "alpha" | "points_section" | "points_all";

type SyncRunRow = {
  finished_at: string | null;
};

const ATTENDANCE_ENTRIES_PAGE_SIZE = 1000;

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

function parseIsoMonthStrict(value: string): { year: number; monthIndex: number; normalized: string } | null {
  const normalized = normalizeWhitespace(value);
  const match = normalized.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return {
    year,
    monthIndex: month - 1,
    normalized: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`,
  };
}

function getDefaultSeasonScope(todayDate = new Date()): { startDate: string; endDate: string } {
  const today = new Date(todayDate);
  const year = today.getMonth() >= 9 ? today.getFullYear() : today.getFullYear() - 1;
  return {
    startDate: `${year}-10-01`,
    endDate: toIsoDateLocal(today),
  };
}

function getCalendarMonthBounds(year: number, monthIndex: number): { startDate: string; endDate: string } {
  const monthStart = new Date(year, monthIndex, 1);
  const monthEnd = new Date(year, monthIndex + 1, 0);
  return {
    startDate: toIsoDateLocal(monthStart),
    endDate: toIsoDateLocal(monthEnd),
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

  if (preset === "current_month" || preset === "previous_month" || preset === "last_3_months") {
    if (preset === "current_month") {
      return getCalendarMonthBounds(now.getFullYear(), now.getMonth());
    }

    if (preset === "previous_month") {
      return getCalendarMonthBounds(now.getFullYear(), now.getMonth() - 1);
    }

    const rangeStart = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const rangeEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      startDate: toIsoDateLocal(rangeStart),
      endDate: toIsoDateLocal(rangeEnd),
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

function compareMembersByName(left: MemberSummaryRow, right: MemberSummaryRow): number {
  return left.fullName.localeCompare(right.fullName, "pl");
}

function compareMembersByPoints(left: MemberSummaryRow, right: MemberSummaryRow): number {
  if (left.points !== right.points) {
    return right.points - left.points;
  }
  return compareMembersByName(left, right);
}

function normalizeNameKey(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function splitFullName(fullName: string): { firstName: string; lastName: string; fullName: string } {
  const tokens = normalizeWhitespace(fullName).split(" ").filter(Boolean);
  const firstName = normalizeNameKey(tokens[0] ?? "");
  const lastName = normalizeNameKey(tokens.slice(1).join(" "));
  const normalizedFullName = normalizeNameKey(tokens.join(" "));
  return {
    firstName,
    lastName,
    fullName: normalizedFullName,
  };
}

function damerauLevenshteinDistanceAtMostOne(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  const leftLength = left.length;
  const rightLength = right.length;
  const diff = Math.abs(leftLength - rightLength);
  if (diff > 1) {
    return false;
  }

  if (leftLength === rightLength) {
    let mismatchCount = 0;
    let firstMismatch = -1;
    let secondMismatch = -1;
    for (let index = 0; index < leftLength; index += 1) {
      if (left[index] !== right[index]) {
        mismatchCount += 1;
        if (mismatchCount === 1) {
          firstMismatch = index;
        } else if (mismatchCount === 2) {
          secondMismatch = index;
        } else {
          return false;
        }
      }
    }
    if (mismatchCount <= 1) {
      return true;
    }
    return (
      firstMismatch >= 0 &&
      secondMismatch >= 0 &&
      secondMismatch === firstMismatch + 1 &&
      left[firstMismatch] === right[secondMismatch] &&
      left[secondMismatch] === right[firstMismatch]
    );
  }

  const longer = leftLength > rightLength ? left : right;
  const shorter = leftLength > rightLength ? right : left;
  let longerIndex = 0;
  let shorterIndex = 0;
  let edits = 0;
  while (longerIndex < longer.length && shorterIndex < shorter.length) {
    if (longer[longerIndex] === shorter[shorterIndex]) {
      longerIndex += 1;
      shorterIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) {
      return false;
    }
    longerIndex += 1;
  }
  return true;
}

function shouldHideLikelyDuplicateZeroPointRow(
  candidate: MemberSummaryRow,
  members: MemberSummaryRow[],
): boolean {
  if (candidate.points !== 0) {
    return false;
  }

  const candidateName = splitFullName(candidate.fullName);
  if (!candidateName.fullName) {
    return false;
  }

  for (const other of members) {
    if (other.memberId === candidate.memberId) {
      continue;
    }
    if (other.points <= 0) {
      continue;
    }

    const otherName = splitFullName(other.fullName);
    if (!otherName.fullName) {
      continue;
    }

    if (candidateName.fullName === otherName.fullName) {
      return true;
    }

    if (
      candidateName.firstName &&
      candidateName.lastName &&
      candidateName.firstName === otherName.firstName &&
      damerauLevenshteinDistanceAtMostOne(candidateName.lastName, otherName.lastName)
    ) {
      return true;
    }
  }

  return false;
}

async function fetchAttendanceEntriesForEvents(eventIds: string[]): Promise<AttendanceEntryRow[]> {
  if (!supabaseAuthClient || eventIds.length === 0) {
    return [];
  }

  const allRows: AttendanceEntryRow[] = [];
  let pageStart = 0;

  while (true) {
    const pageEnd = pageStart + ATTENDANCE_ENTRIES_PAGE_SIZE - 1;
    const { data, error } = await supabaseAuthClient
      .from("attendance_entries")
      .select("event_id,member_id,attendance_ratio,updated_at")
      .in("event_id", eventIds)
      .order("event_id", { ascending: true })
      .order("member_id", { ascending: true })
      .range(pageStart, pageEnd);

    if (error) {
      throw new Error(error.message);
    }

    const rows = (data ?? []) as AttendanceEntryRow[];
    allRows.push(...rows);

    if (rows.length < ATTENDANCE_ENTRIES_PAGE_SIZE) {
      break;
    }

    pageStart += ATTENDANCE_ENTRIES_PAGE_SIZE;
  }

  return allRows;
}

export function AttendanceSummaryScreen({ onBack }: AttendanceSummaryScreenProps) {
  const { width: viewportWidth } = useWindowDimensions();
  const isDesktopLayout = viewportWidth >= tokens.breakpoints.desktop;
  const memberTableMaxWidth = useMemo(() => {
    if (!isDesktopLayout) {
      return null;
    }
    if (viewportWidth >= 1600) {
      return 980;
    }
    if (viewportWidth >= 1280) {
      return 860;
    }
    return 740;
  }, [isDesktopLayout, viewportWidth]);
  const webDateInputProps = useMemo(() => {
    if (Platform.OS !== "web") {
      return {};
    }
    return { type: "date" };
  }, []);
  const webMonthInputProps = useMemo(() => {
    if (Platform.OS !== "web") {
      return {};
    }
    return { type: "month" };
  }, []);

  const defaultScope = useMemo(() => getDefaultSeasonScope(), []);
  const defaultMonthInput = useMemo(() => toIsoDateLocal(new Date()).slice(0, 7), []);
  const [scopeStartDate, setScopeStartDate] = useState(defaultScope.startDate);
  const [scopeEndDate, setScopeEndDate] = useState(defaultScope.endDate);
  const [startDateInput, setStartDateInput] = useState(defaultScope.startDate);
  const [endDateInput, setEndDateInput] = useState(defaultScope.endDate);
  const [singleMonthInput, setSingleMonthInput] = useState(defaultMonthInput);
  const [totalEvents, setTotalEvents] = useState(0);
  const [sections, setSections] = useState<SectionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [consistencyNotice, setConsistencyNotice] = useState<string | null>(null);
  const [latestRefSyncAt, setLatestRefSyncAt] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("alpha");

  const displaySections = useMemo<SectionSummary[]>(() => {
    if (sortMode === "alpha") {
      return sections;
    }

    if (sortMode === "points_section") {
      return sections.map((section) => ({
        ...section,
        members: [...section.members].sort(compareMembersByPoints),
      }));
    }

    const allMembers = sections
      .flatMap((section) => section.members)
      .sort(compareMembersByPoints);

    return allMembers.length > 0
      ? [{
        key: "all-members",
        label: tr("Wszyscy", "All members"),
        members: allMembers,
      }]
      : [];
  }, [sections, sortMode]);

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

  const applySingleMonthScope = useCallback(() => {
    const parsedMonth = parseIsoMonthStrict(singleMonthInput);
    if (!parsedMonth) {
      setErrorMessage(
        tr(
          "Miesiąc musi być w formacie RRRR-MM.",
          "Month must use YYYY-MM format.",
        ),
      );
      return;
    }

    const monthBounds = getCalendarMonthBounds(parsedMonth.year, parsedMonth.monthIndex);
    setSingleMonthInput(parsedMonth.normalized);
    setStartDateInput(monthBounds.startDate);
    setEndDateInput(monthBounds.endDate);
    setScopeStartDate(monthBounds.startDate);
    setScopeEndDate(monthBounds.endDate);
    setErrorMessage(null);
  }, [singleMonthInput]);

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

      setIsLoading(true);
      setErrorMessage(null);
      setConsistencyNotice(null);

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
            .maybeSingle<SyncRunRow>(),
        ]);

        if (isDisposed) {
          return;
        }

        if (membersResult.error) {
          throw new Error(membersResult.error.message);
        }

        const members = ((membersResult.data ?? []) as MemberRow[]).filter(
          (member) => normalizeWhitespace(member.member_id).length > 0,
        );
        if (eventsResult.error) {
          throw new Error(eventsResult.error.message);
        }

        const latestSyncFinishedAt = normalizeWhitespace(latestSyncRunResult.data?.finished_at ?? "");
        const hasSyncMetadataError = Boolean(latestSyncRunResult.error);
        setLatestRefSyncAt(latestSyncFinishedAt || null);

        const events = (eventsResult.data ?? []) as Array<{ event_id: string }>;

        const eventIds = events
          .map((event) => normalizeWhitespace(event.event_id))
          .filter((eventId) => eventId.length > 0);

        const eventsCount = eventIds.length;
        setTotalEvents(eventsCount);

        const entries = eventIds.length > 0
          ? await fetchAttendanceEntriesForEvents(eventIds)
          : [];

        if (isDisposed) {
          return;
        }

        let changedAfterSyncCount = 0;
        for (const entry of entries) {
          const updatedAt = normalizeWhitespace(entry.updated_at);
          if (updatedAt && updatedAt > latestSyncFinishedAt) {
            changedAfterSyncCount += 1;
          }
        }

        if (hasSyncMetadataError) {
          setConsistencyNotice(
            tr(
              "Nie udało się pobrać metadanych ostatniego syncu ref -> DB. Pokazuję bieżące dane z DB.",
              "Could not load latest ref -> DB sync metadata. Showing current DB data.",
            ),
          );
        } else if (!latestSyncFinishedAt) {
          setConsistencyNotice(
            tr(
              "Brak zakończonego syncu ref -> DB. Pokazuję bieżące dane z DB; mogą różnić się od arkusza ref.",
              "No completed ref -> DB sync found. Showing current DB data, which may differ from the ref sheet.",
            ),
          );
        } else if (changedAfterSyncCount > 0) {
          setConsistencyNotice(
            tr(
              `Wykryto ${changedAfterSyncCount} zmian obecności po ostatnim syncu ref -> DB. Pokazuję aktualny stan DB, który może chwilowo różnić się od ref.`,
              `Detected ${changedAfterSyncCount} attendance changes after the last ref -> DB sync. Showing current DB state, which may temporarily differ from ref.`,
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
            members: rows
              .filter((row) => !shouldHideLikelyDuplicateZeroPointRow(row, rows))
              .sort(compareMembersByName),
            }));

        setSections(nextSections);
      } catch (error) {
        setSections([]);
        setTotalEvents(0);
        setLatestRefSyncAt(null);
        setConsistencyNotice(null);
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
        <Text style={styles.cardSecondary}>
          {tr("Ostatni sync ref -> DB", "Last ref -> DB sync")}: {latestRefSyncAt ?? tr("brak", "none")}
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
          <Pressable style={styles.presetButton} onPress={() => applyPreset("current_month")}>
            <Text style={styles.presetButtonLabel}>{tr("Aktualny miesiąc", "Current month")}</Text>
          </Pressable>
          <Pressable style={styles.presetButton} onPress={() => applyPreset("previous_month")}>
            <Text style={styles.presetButtonLabel}>{tr("Poprzedni miesiąc", "Previous month")}</Text>
          </Pressable>
          <Pressable style={styles.presetButton} onPress={() => applyPreset("last_3_months")}>
            <Text style={styles.presetButtonLabel}>{tr("Ostatnie 3 miesiące", "Last 3 months")}</Text>
          </Pressable>
          <Pressable style={styles.presetButton} onPress={() => applyPreset("ytd")}>
            <Text style={styles.presetButtonLabel}>{tr("Rok", "YTD")}</Text>
          </Pressable>
          <Pressable style={styles.presetButton} onPress={() => applyPreset("all")}>
            <Text style={styles.presetButtonLabel}>{tr("Wszystko", "All")}</Text>
          </Pressable>
        </View>

        <View style={styles.singleMonthRow}>
          <View style={styles.singleMonthInputBlock}>
            <Text style={styles.scopeInputLabel}>{tr("Miesiąc", "Month")}</Text>
            <TextInput
              {...(webMonthInputProps as any)}
              value={singleMonthInput}
              onChangeText={setSingleMonthInput}
              placeholder="YYYY-MM"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={Platform.OS === "web" ? "default" : "numbers-and-punctuation"}
              style={styles.scopeInput}
            />
          </View>
          <Pressable style={styles.singleMonthApplyButton} onPress={applySingleMonthScope}>
            <Text style={styles.applyButtonLabel}>{tr("Ustaw miesiąc", "Apply month")}</Text>
          </Pressable>
        </View>

        <View style={styles.scopeInputsRow}>
          <View style={styles.scopeInputBlock}>
            <Text style={styles.scopeInputLabel}>{tr("Od", "From")}</Text>
            <TextInput
              {...(webDateInputProps as any)}
              value={startDateInput}
              onChangeText={setStartDateInput}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={Platform.OS === "web" ? "default" : "numbers-and-punctuation"}
              style={styles.scopeInput}
            />
          </View>
          <View style={styles.scopeInputBlock}>
            <Text style={styles.scopeInputLabel}>{tr("Do", "To")}</Text>
            <TextInput
              {...(webDateInputProps as any)}
              value={endDateInput}
              onChangeText={setEndDateInput}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={Platform.OS === "web" ? "default" : "numbers-and-punctuation"}
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
        <View style={styles.sortRow}>
          <Pressable
            style={[styles.presetButton, sortMode === "alpha" && styles.presetButtonActive]}
            onPress={() => setSortMode("alpha")}
          >
            <Text style={[styles.presetButtonLabel, sortMode === "alpha" && styles.presetButtonLabelActive]}>
              {tr("A-Z", "A-Z")}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.presetButton, sortMode === "points_section" && styles.presetButtonActive]}
            onPress={() => setSortMode("points_section")}
          >
            <Text
              style={[
                styles.presetButtonLabel,
                sortMode === "points_section" && styles.presetButtonLabelActive,
              ]}
            >
              {tr("Punkty sekcje", "Points by section")}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.presetButton, sortMode === "points_all" && styles.presetButtonActive]}
            onPress={() => setSortMode("points_all")}
          >
            <Text
              style={[
                styles.presetButtonLabel,
                sortMode === "points_all" && styles.presetButtonLabelActive,
              ]}
            >
              {tr("Punkty wszyscy", "Points all")}
            </Text>
          </Pressable>
        </View>

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

        {!isLoading && !errorMessage && consistencyNotice ? (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>{consistencyNotice}</Text>
          </View>
        ) : null}

        {!isLoading && !errorMessage && displaySections.length === 0 ? (
          <Text style={styles.cardBody}>
            {tr("Brak muzyków lub danych do policzenia w tym zakresie.", "No members or no data to compute in this scope.")}
          </Text>
        ) : null}

        {!isLoading && !errorMessage
          ? displaySections.map((section) => (
              <View key={section.key} style={styles.sectionBlock}>
                <Text style={styles.sectionLabel}>{section.label}</Text>
                <View
                  style={[
                    styles.memberTable,
                    isDesktopLayout && styles.memberTableDesktop,
                    isDesktopLayout && memberTableMaxWidth ? { maxWidth: memberTableMaxWidth } : null,
                  ]}
                >
                  {section.members.map((member) => (
                    <View
                      key={member.memberId}
                      style={[styles.memberRow, isDesktopLayout && styles.memberRowDesktop]}
                    >
                      <Text
                        style={[styles.memberName, isDesktopLayout && styles.memberNameDesktop]}
                        numberOfLines={1}
                      >
                        {member.fullName}
                      </Text>
                      <View
                        style={[styles.memberMetrics, isDesktopLayout && styles.memberMetricsDesktop]}
                      >
                        <Text
                          style={[styles.memberPercent, isDesktopLayout && styles.memberPercentDesktop]}
                        >
                          {formatPercent(member.percent)}
                        </Text>
                        <Text
                          style={[styles.memberPoints, isDesktopLayout && styles.memberPointsDesktop]}
                        >
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
  presetButtonActive: {
    backgroundColor: tokens.colors.brand,
    borderColor: tokens.colors.brand,
  },
  presetButtonLabelActive: {
    color: tokens.colors.surface,
  },
  scopeInputsRow: {
    marginTop: tokens.spacing.md,
    flexDirection: "row",
    gap: tokens.spacing.sm,
    flexWrap: "wrap",
  },
  singleMonthRow: {
    marginTop: tokens.spacing.md,
    flexDirection: "row",
    gap: tokens.spacing.sm,
    flexWrap: "wrap",
    alignItems: "flex-end",
  },
  singleMonthInputBlock: {
    flexGrow: 1,
    minWidth: 160,
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
  singleMonthApplyButton: {
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
  sortRow: {
    marginTop: tokens.spacing.sm,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.xs,
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
  noticeBox: {
    marginTop: tokens.spacing.md,
    padding: tokens.spacing.sm,
    borderRadius: tokens.radii.md,
    backgroundColor: tokens.colors.brandTint,
    borderWidth: 1,
    borderColor: tokens.colors.border,
  },
  noticeText: {
    color: tokens.colors.successInk,
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
  memberTableDesktop: {
    width: "100%",
    alignSelf: "center",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacing.sm,
    paddingVertical: 4,
    direction: "ltr",
  },
  memberRowDesktop: {
    justifyContent: "flex-start",
    gap: tokens.spacing.md,
  },
  memberName: {
    flex: 1,
    fontSize: tokens.typography.body,
    lineHeight: 22,
    color: tokens.colors.ink,
    textAlign: "left",
  },
  memberNameDesktop: {
    flexGrow: 1,
    flexShrink: 1,
  },
  memberMetrics: {
    alignItems: "flex-end",
    minWidth: 110,
  },
  memberMetricsDesktop: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "flex-end",
    gap: tokens.spacing.md,
    minWidth: 210,
    flexShrink: 0,
  },
  memberPercent: {
    fontSize: tokens.typography.body,
    lineHeight: 20,
    fontWeight: "700",
    color: tokens.colors.ink,
  },
  memberPercentDesktop: {
    minWidth: 72,
    textAlign: "right",
  },
  memberPoints: {
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    color: tokens.colors.muted,
  },
  memberPointsDesktop: {
    minWidth: 84,
    textAlign: "right",
  },
});
