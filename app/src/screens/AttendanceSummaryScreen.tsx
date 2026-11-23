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
import { formatDateLabel } from "../utils/format";

type AttendanceSummaryScreenProps = {
  onBack?: () => void;
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

function surnameKey(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] ?? fullName;
}

// Sorted by surname (last word of "First Last"), then by full name.
function compareMembersByName(left: MemberSummaryRow, right: MemberSummaryRow): number {
  return (
    surnameKey(left.fullName).localeCompare(surnameKey(right.fullName), "pl") ||
    left.fullName.localeCompare(right.fullName, "pl")
  );
}

const SCOPE_DATE_FORMAT = new Intl.DateTimeFormat("pl-PL", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatScopeDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) {
    return isoDate;
  }
  return SCOPE_DATE_FORMAT.format(new Date(year, month - 1, day, 12));
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
  const [activeScope, setActiveScope] = useState<ScopePreset | "custom" | "month">("season");
  const [showCustomScope, setShowCustomScope] = useState(false);

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
    setActiveScope(preset);
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
    setActiveScope("custom");
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
    setActiveScope("month");
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
              "Nie wiemy, kiedy ostatnio zsynchronizowano arkusz obecności. Pokazuję bieżące dane z bazy.",
              "Could not load latest ref -> DB sync metadata. Showing current DB data.",
            ),
          );
        } else if (!latestSyncFinishedAt) {
          setConsistencyNotice(
            tr(
              "Arkusz obecności nie był jeszcze synchronizowany z bazą. Pokazuję bieżące dane z bazy; mogą różnić się od arkusza.",
              "No completed ref -> DB sync found. Showing current DB data, which may differ from the ref sheet.",
            ),
          );
        } else if (changedAfterSyncCount > 0) {
          setConsistencyNotice(
            tr(
              `${changedAfterSyncCount} zmian obecności wpisano po ostatniej synchronizacji z arkuszem. Pokazuję aktualny stan bazy; arkusz może się chwilowo różnić.`,
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

  const presetOptions: Array<{ key: ScopePreset; label: string }> = [
    { key: "season", label: tr("Sezon", "Season") },
    { key: "current_month", label: tr("Ten miesiąc", "This month") },
    { key: "previous_month", label: tr("Poprzedni miesiąc", "Last month") },
    { key: "30d", label: tr("30 dni", "30 days") },
    { key: "90d", label: tr("90 dni", "90 days") },
    { key: "last_3_months", label: tr("3 miesiące", "3 months") },
    { key: "ytd", label: tr("Ten rok", "This year") },
    { key: "all", label: tr("Wszystko", "All") },
  ];
  const sortOptions: Array<{ key: SortMode; label: string }> = [
    { key: "alpha", label: tr("A–Z", "A–Z") },
    { key: "points_section", label: tr("Punkty w sekcjach", "Points by section") },
    { key: "points_all", label: tr("Ranking", "Ranking") },
  ];

  const scopeLabel =
    activeScope === "all"
      ? tr(`Wszystkie dane, do ${formatScopeDate(scopeEndDate)}`, `All data, up to ${formatScopeDate(scopeEndDate)}`)
      : `${formatScopeDate(scopeStartDate)} – ${formatScopeDate(scopeEndDate)}`;

  // Desktop: two balanced columns of section cards (no gaps between cards of
  // different heights). The "ranking" view is a single long list.
  const sectionColumns: SectionSummary[][] =
    isDesktopLayout && sortMode !== "points_all" ? [[], []] : [[]];
  const columnLoad = sectionColumns.map(() => 0);
  for (const section of displaySections) {
    const target = columnLoad.length > 1 && columnLoad[1] < columnLoad[0] ? 1 : 0;
    sectionColumns[target].push(section);
    columnLoad[target] += section.members.length + 2;
  }

  function renderSection(section: SectionSummary) {
    const isRanking = sortMode === "points_all";
    return (
      <View key={section.key} style={styles.sectionCard}>
        {!isRanking ? (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.label}</Text>
            <Text style={styles.sectionCount}>{section.members.length}</Text>
          </View>
        ) : null}
        {section.members.map((member, index) => {
          const percent = Math.max(0, Math.min(100, member.percent));
          return (
            <View key={member.memberId} style={[styles.memberRow, index > 0 && styles.memberRowDivider]}>
              {isRanking ? <Text style={styles.rank}>{index + 1}</Text> : null}
              <View style={styles.memberMain}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {member.fullName}
                </Text>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      { width: `${percent}%` },
                      percent < 50 && styles.fillLow,
                    ]}
                  />
                </View>
              </View>
              <View style={styles.memberMetrics}>
                <Text style={styles.memberPercent}>{formatPercent(member.percent)}</Text>
                <Text style={styles.memberPoints}>
                  {formatPoints(member.points)} {tr("pkt", "pts")}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={[styles.content, isDesktopLayout && styles.contentDesktop]}
      showsVerticalScrollIndicator={false}
    >
      {onBack ? (
        <Pressable style={styles.backLink} onPress={onBack} accessibilityRole="button">
          <Text style={styles.backLinkLabel}>{tr("‹ Wróć", "‹ Back")}</Text>
        </Pressable>
      ) : null}

      <View style={styles.header}>
        <Text style={styles.kicker}>{tr("Podsumowanie i punkty", "Summary and points")}</Text>
        <Text style={styles.title}>{scopeLabel}</Text>
        <Text style={styles.muted}>
          {isLoading
            ? tr("Liczę…", "Calculating…")
            : tr(`Wydarzeń w zakresie: ${totalEvents}`, `Events in range: ${totalEvents}`)}
          {" · "}
          {tr("synchronizacja danych", "data sync")}:{" "}
          {latestRefSyncAt ? formatDateLabel(latestRefSyncAt) : tr("brak", "none")}
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.chips}>
          {presetOptions.map((option) => {
            const isActive = activeScope === option.key;
            return (
              <Pressable
                key={option.key}
                onPress={() => applyPreset(option.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                style={[styles.chip, isActive && styles.chipActive]}
              >
                <Text style={[styles.chipLabel, isActive && styles.chipLabelActive]}>{option.label}</Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setShowCustomScope((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showCustomScope }}
            style={[
              styles.chip,
              (activeScope === "custom" || activeScope === "month") && styles.chipActive,
            ]}
          >
            <Text
              style={[
                styles.chipLabel,
                (activeScope === "custom" || activeScope === "month") && styles.chipLabelActive,
              ]}
            >
              {tr("Własny zakres", "Custom range")} {showCustomScope ? "▴" : "▾"}
            </Text>
          </Pressable>
        </View>

        {showCustomScope ? (
          <View style={styles.customScope}>
            <View style={styles.inputRow}>
              <View style={styles.inputBlock}>
                <Text style={styles.inputLabel}>{tr("Miesiąc", "Month")}</Text>
                <TextInput
                  {...(webMonthInputProps as any)}
                  value={singleMonthInput}
                  onChangeText={setSingleMonthInput}
                  placeholder="RRRR-MM"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType={Platform.OS === "web" ? "default" : "numbers-and-punctuation"}
                  style={styles.input}
                />
              </View>
              <Pressable style={styles.secondaryButton} onPress={applySingleMonthScope} accessibilityRole="button">
                <Text style={styles.secondaryButtonLabel}>{tr("Pokaż miesiąc", "Show month")}</Text>
              </Pressable>
            </View>
            <View style={styles.inputRow}>
              <View style={styles.inputBlock}>
                <Text style={styles.inputLabel}>{tr("Od", "From")}</Text>
                <TextInput
                  {...(webDateInputProps as any)}
                  value={startDateInput}
                  onChangeText={setStartDateInput}
                  placeholder="RRRR-MM-DD"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType={Platform.OS === "web" ? "default" : "numbers-and-punctuation"}
                  style={styles.input}
                />
              </View>
              <View style={styles.inputBlock}>
                <Text style={styles.inputLabel}>{tr("Do", "To")}</Text>
                <TextInput
                  {...(webDateInputProps as any)}
                  value={endDateInput}
                  onChangeText={setEndDateInput}
                  placeholder="RRRR-MM-DD"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType={Platform.OS === "web" ? "default" : "numbers-and-punctuation"}
                  style={styles.input}
                />
              </View>
              <Pressable style={styles.secondaryButton} onPress={applyCustomScope} accessibilityRole="button">
                <Text style={styles.secondaryButtonLabel}>{tr("Przelicz", "Apply")}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.segmented} accessibilityRole="tablist">
        {sortOptions.map((option) => {
          const isActive = sortMode === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => setSortMode(option.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              style={[styles.segment, isActive && styles.segmentActive]}
            >
              <Text style={[styles.segmentLabel, isActive && styles.segmentLabelActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={tokens.colors.brand} />
        </View>
      ) : null}

      {!isLoading && errorMessage ? (
        <Text style={[styles.notice, styles.noticeError]}>{errorMessage}</Text>
      ) : null}

      {!isLoading && !errorMessage && consistencyNotice ? (
        <Text style={[styles.notice, styles.noticeWarning]}>{consistencyNotice}</Text>
      ) : null}

      {!isLoading && !errorMessage && displaySections.length === 0 ? (
        <Text style={styles.muted}>
          {tr("Brak muzyków lub danych do policzenia w tym zakresie.", "No members or no data in this range.")}
        </Text>
      ) : null}

      {!isLoading && !errorMessage && displaySections.length > 0 ? (
        <View style={[styles.sections, sectionColumns.length > 1 && styles.sectionsColumns]}>
          {sectionColumns.map((column, columnIndex) => (
            <View key={columnIndex} style={styles.sectionColumn}>
              {column.map((section) => renderSection(section))}
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screenScroll: {
    flex: 1,
  },
  content: {
    padding: tokens.spacing.md,
    gap: tokens.spacing.md,
  },
  contentDesktop: {
    width: "100%",
    maxWidth: 1120,
    alignSelf: "center",
    paddingHorizontal: tokens.spacing.xl,
    paddingTop: tokens.spacing.lg,
  },
  backLink: {
    alignSelf: "flex-start",
    minHeight: 32,
    justifyContent: "center",
  },
  backLinkLabel: {
    color: tokens.colors.brand,
    fontWeight: "600",
  },
  header: {
    gap: 2,
  },
  kicker: {
    fontSize: tokens.typography.caption,
    fontWeight: "600",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: tokens.colors.muted,
  },
  title: {
    fontSize: 26,
    lineHeight: 31,
    fontWeight: "800",
    letterSpacing: -0.4,
    color: tokens.colors.ink,
  },
  muted: {
    fontSize: 14,
    color: tokens.colors.muted,
  },
  card: {
    backgroundColor: tokens.colors.surface,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.lg,
    padding: tokens.spacing.sm,
    gap: tokens.spacing.sm,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: tokens.radii.round,
    borderWidth: 1,
    borderColor: tokens.colors.borderStrong,
    backgroundColor: tokens.colors.surface,
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: tokens.colors.brand,
    borderColor: tokens.colors.brand,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.colors.ink,
  },
  chipLabelActive: {
    color: tokens.colors.surface,
  },
  customScope: {
    gap: tokens.spacing.sm,
    paddingTop: tokens.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: tokens.colors.surfaceMuted,
  },
  inputRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: tokens.spacing.xs,
  },
  inputBlock: {
    flexGrow: 1,
    flexBasis: 140,
    gap: 4,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: tokens.colors.muted,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: tokens.colors.borderStrong,
    borderRadius: tokens.radii.md,
    paddingHorizontal: 12,
    fontSize: 15,
    color: tokens.colors.ink,
    backgroundColor: tokens.colors.surface,
  },
  secondaryButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: tokens.radii.md,
    borderWidth: 1,
    borderColor: tokens.colors.borderStrong,
    backgroundColor: tokens.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: tokens.colors.ink,
  },
  segmented: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: tokens.radii.md,
    backgroundColor: tokens.colors.surfaceMuted,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  segmentActive: {
    backgroundColor: tokens.colors.surface,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  segmentLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.colors.muted,
    textAlign: "center",
  },
  segmentLabelActive: {
    color: tokens.colors.ink,
  },
  loadingRow: {
    paddingVertical: tokens.spacing.lg,
    alignItems: "center",
  },
  notice: {
    fontSize: 14,
    lineHeight: 20,
    borderRadius: tokens.radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    overflow: "hidden",
  },
  noticeError: {
    backgroundColor: tokens.colors.dangerSurface,
    color: tokens.colors.dangerInk,
  },
  noticeWarning: {
    backgroundColor: tokens.colors.warningSurface,
    color: tokens.colors.warningInk,
  },
  sections: {
    gap: tokens.spacing.sm,
  },
  sectionsColumns: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  sectionColumn: {
    flex: 1,
    minWidth: 0,
    gap: tokens.spacing.sm,
  },
  sectionCard: {
    backgroundColor: tokens.colors.surface,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.lg,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 6,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 6,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: tokens.colors.ink,
  },
  sectionCount: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.colors.muted,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 9,
  },
  memberRowDivider: {
    borderTopWidth: 1,
    borderTopColor: tokens.colors.surfaceMuted,
  },
  rank: {
    width: 24,
    fontSize: 13,
    fontWeight: "600",
    color: tokens.colors.muted,
    textAlign: "right",
  },
  memberMain: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  memberName: {
    fontSize: 15,
    color: tokens.colors.ink,
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: tokens.colors.surfaceMuted,
    overflow: "hidden",
  },
  fill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: tokens.colors.brand,
  },
  fillLow: {
    backgroundColor: tokens.colors.warningBorder,
  },
  memberMetrics: {
    alignItems: "flex-end",
    minWidth: 64,
  },
  memberPercent: {
    fontSize: 15,
    fontWeight: "700",
    color: tokens.colors.ink,
  },
  memberPoints: {
    fontSize: 12,
    color: tokens.colors.muted,
  },
});
