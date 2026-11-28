import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { CsvExportPanel } from "./attendance-manager/CsvExportPanel";
import { SectionGridPanel, type SectionGridTile } from "./attendance-manager/SectionGridPanel";
import { SectionMembersPanel, type SectionMemberCard } from "./attendance-manager/SectionMembersPanel";
import { SheetCheckPanel } from "./attendance-manager/SheetCheckPanel";
import { useAttendanceBootData, useAttendanceEntries } from "./attendance-manager/useAttendanceManagerData";
import type {
  ForumSnapshotPayload,
  MemberRow,
  SessionRow,
  SnapshotEventDetail,
} from "./attendance-manager/types";
import { supabaseAuthClient } from "../auth/supabaseAuthClient";
import { resolveEdgeFunctionUrl } from "../auth/edgeFunctionUrl";
import {
  canonicalizeInstrumentLabel,
  normalizeInstrumentKey,
  REHEARSAL_SECTION_ROWS,
} from "../domain/instruments";
import { tr } from "../i18n";
import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";
import { Button } from "../ui/Button";
import { textStyles } from "../theme/text";
import { Notice } from "../ui/Notice";
import { Icon } from "../ui/Icon";
import { formatDateLabel, stripTitleDatePrefix } from "../utils/format";

type AttendanceManagerScreenProps = {
  onBack?: () => void;
};

type ManagerSession = {
  key: string;
  event_id: string | null;
  title: string;
  event_date: string;
  source_header: string | null;
  source_column: string | null;
  /** No event row yet: the first save links or creates it. */
  isVirtual: boolean;
  /** Set for events from the forum ("forum-event-<tid>"). */
  forum_event_id: string | null;
};

const ATTENDANCE_CYCLE_SEQUENCE = [0, 1, 0.75, 0.5, 0.25] as const;
type AttendanceRatioValue = (typeof ATTENDANCE_CYCLE_SEQUENCE)[number];

type EnqueueResponsePayload = {
  status?: string;
  mode?: string;
  queue_id?: number;
  queued_count?: number;
  queue_ids?: number[];
  event_id?: string;
  event_resolution?: string;
  export_trigger?: {
    triggered?: boolean;
    ok?: boolean;
    status?: number;
    message?: string;
  };
  error?: string;
  message?: string;
};

type CalendarCell = {
  date: string;
  inCurrentMonth: boolean;
};

type GroupSummary = {
  points000: number;
  points025: number;
  points050: number;
  points075: number;
  points100: number;
};

type SaveFeedback = {
  count: number;
  wasAppliedDirectly: boolean;
  timestampMs: number;
  notes: string | null;
};

type SectionGridItem = {
  key: string;
  label: string;
  group: { instrument: string; members: MemberRow[] } | null;
};

const ATTENDANCE_WRITE_FUNCTION_NAME = "attendance_write_sheet_first";
const ATTENDANCE_WRITE_FUNCTION_URL = resolveAttendanceWriteFunctionUrl();
const ATTENDANCE_WRITE_UI_ENABLED = parseBooleanEnv(process.env.EXPO_PUBLIC_ATTENDANCE_WRITE_ENABLED);
const REHEARSAL_KEYWORDS = ["proba", "próba", "rehearsal", "wtorek", "czwartek", "tuesday", "thursday"];
const ATTENDANCE_RATIO_EPSILON = 0.001;
// Monday-first indexes of the planned rehearsal days (Tuesday, Thursday).
const REHEARSAL_WEEKDAY_INDEXES = new Set([1, 3]);

function resolveAttendanceWriteFunctionUrl(): string | null {
  return resolveEdgeFunctionUrl(
    ATTENDANCE_WRITE_FUNCTION_NAME,
    process.env.EXPO_PUBLIC_ATTENDANCE_WRITE_FUNCTION_URL,
    process.env.EXPO_PUBLIC_SUPABASE_URL,
  );
}

function parseBooleanEnv(rawValue: string | undefined): boolean {
  const normalized = (rawValue ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizeWhitespace(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchText(value: unknown): string {
  return normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function normalizePersonName(value: unknown): string {
  return normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseIsoDateAsLocalNoon(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00`);
}

function parseDateOnly(value: string | undefined): string | null {
  const normalized = normalizeWhitespace(value ?? "");
  if (!normalized) {
    return null;
  }

  const exact = normalized.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (exact) {
    return exact[1];
  }

  const fromIso = normalized.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (fromIso) {
    return fromIso[1];
  }

  return null;
}

function toIsoDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekdayMonToSun(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay();
}

function getMonthKeyFromIsoDate(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function parseMonthKey(monthKey: string): Date {
  return new Date(`${monthKey}-01T12:00:00`);
}

function shiftMonthKey(monthKey: string, delta: number): string {
  const date = parseMonthKey(monthKey);
  date.setMonth(date.getMonth() + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(monthKey: string): string {
  const label = new Intl.DateTimeFormat("pl-PL", {
    month: "long",
    year: "numeric",
  }).format(parseMonthKey(monthKey));

  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatTimeLabel(timestampMs: number): string {
  return new Intl.DateTimeFormat("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestampMs));
}

function buildCalendarCells(monthKey: string): CalendarCell[] {
  const monthStart = parseMonthKey(monthKey);
  const offsetToMonday = weekdayMonToSun(monthStart) - 1;
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - offsetToMonday);

  const cells: CalendarCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const isoDate = toIsoDateLocal(date);

    cells.push({
      date: isoDate,
      inCurrentMonth: getMonthKeyFromIsoDate(isoDate) === monthKey,
    });
  }

  return cells;
}

function isRehearsalLikeSession(session: SessionRow): boolean {
  const haystack = normalizeSearchText([session.title, session.source_header, session.source_column].filter(Boolean).join(" "));
  return REHEARSAL_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function normalizeSessionTitleForDedup(title: string): string {
  return normalizeSearchText(title)
    .replace(/\b20\d{2}[./-]\d{1,2}[./-]\d{1,2}\b/g, " ")
    .replace(/\b20\d{2}[./-]\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}[./-]\d{1,2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function filterShadowPlaceholderSessions(sessions: SessionRow[]): SessionRow[] {
  if (sessions.length <= 1) {
    return sessions;
  }

  const byKey = new Map<string, SessionRow[]>();
  for (const session of sessions) {
    const titleKey = normalizeSessionTitleForDedup(session.title);
    const key = `${session.event_date}::${titleKey || normalizeSearchText(session.title)}`;
    const bucket = byKey.get(key) ?? [];
    bucket.push(session);
    byKey.set(key, bucket);
  }

  const filtered: SessionRow[] = [];
  for (const session of sessions) {
    const titleKey = normalizeSessionTitleForDedup(session.title);
    const key = `${session.event_date}::${titleKey || normalizeSearchText(session.title)}`;
    const bucket = byKey.get(key) ?? [];
    if (bucket.length <= 1) {
      filtered.push(session);
      continue;
    }

    const hasMappedSource = bucket.some((candidate) => normalizeWhitespace(candidate.source_column).length > 0);
    if (!hasMappedSource) {
      filtered.push(session);
      continue;
    }

    const isMapped = normalizeWhitespace(session.source_column).length > 0;
    if (isMapped) {
      filtered.push(session);
    }
  }

  return filtered;
}

function isSameAttendanceRatio(left: number | undefined, right: number): boolean {
  if (left == null || !Number.isFinite(left)) {
    return false;
  }
  return Math.abs(left - right) <= ATTENDANCE_RATIO_EPSILON;
}

function markFromRatio(attendanceRatio: number | undefined): AttendanceRatioValue {
  for (const option of ATTENDANCE_CYCLE_SEQUENCE) {
    if (isSameAttendanceRatio(attendanceRatio, option)) {
      return option;
    }
  }

  return 0;
}

function formatAttendanceValue(value: AttendanceRatioValue): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  const rounded = Number(value.toFixed(2));
  return String(rounded);
}

function formatMarkLabel(mark: AttendanceRatioValue): string {
  return tr(`${formatAttendanceValue(mark)} pkt`, `${formatAttendanceValue(mark)} pts`);
}

function getNextAttendanceRatio(currentRatio: number | undefined): AttendanceRatioValue {
  const currentMark = markFromRatio(currentRatio);
  const currentIndex = ATTENDANCE_CYCLE_SEQUENCE.findIndex((option) => option === currentMark);
  if (currentIndex < 0) {
    return ATTENDANCE_CYCLE_SEQUENCE[1];
  }

  return ATTENDANCE_CYCLE_SEQUENCE[(currentIndex + 1) % ATTENDANCE_CYCLE_SEQUENCE.length];
}

function buildExpectedRehearsalDates(now: Date, pastWeeks = 8, futureWeeks = 6): string[] {
  const start = new Date(now);
  start.setDate(start.getDate() - pastWeeks * 7);
  const end = new Date(now);
  end.setDate(end.getDate() + futureWeeks * 7);

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const weekday = weekdayMonToSun(cursor);
    if (weekday === 2 || weekday === 4) {
      dates.push(toIsoDateLocal(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function chooseDefaultSession(allSessions: SessionRow[]): SessionRow | null {
  // Only events the panel lists: forum-linked ones and rehearsals.
  const sessions = allSessions.filter((session) => Boolean(session.forum_event_id) || isRehearsalLikeSession(session));
  if (sessions.length === 0) {
    return null;
  }
  const now = Date.now();
  let selected = sessions[0];
  let selectedDistance = Math.abs(parseIsoDateAsLocalNoon(selected.event_date).getTime() - now);

  for (const session of sessions) {
    const distance = Math.abs(parseIsoDateAsLocalNoon(session.event_date).getTime() - now);
    if (distance < selectedDistance) {
      selected = session;
      selectedDistance = distance;
    }
  }

  return selected;
}

function extractResponseErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const asRecord = payload as Record<string, unknown>;
  const message = typeof asRecord.message === "string" ? asRecord.message.trim() : "";
  if (message) {
    return message;
  }
  const error = typeof asRecord.error === "string" ? asRecord.error.trim() : "";
  if (error) {
    return error;
  }
  return null;
}

function groupMembersByInstrument(members: MemberRow[]): Array<{ instrument: string; members: MemberRow[] }> {
  const grouped = new Map<string, MemberRow[]>();
  for (const member of members) {
    const instrument = canonicalizeInstrumentLabel(member.instrument, tr("Nieprzypisany", "Unassigned"));
    const bucket = grouped.get(instrument) ?? [];
    bucket.push(member);
    grouped.set(instrument, bucket);
  }

  return Array.from(grouped.entries())
    .map(([instrument, instrumentMembers]) => ({
      instrument,
      members: [...instrumentMembers].sort((left, right) => left.full_name.localeCompare(right.full_name, "pl")),
    }))
    .sort((left, right) => left.instrument.localeCompare(right.instrument, "pl"));
}

function summarizeGroupMarks(members: MemberRow[], entriesByMemberId: Record<string, number>): GroupSummary {
  let points000 = 0;
  let points025 = 0;
  let points050 = 0;
  let points075 = 0;
  let points100 = 0;

  for (const member of members) {
    const mark = markFromRatio(entriesByMemberId[member.member_id]);
    if (mark === 0) {
      points000 += 1;
    } else if (mark === 0.25) {
      points025 += 1;
    } else if (mark === 0.5) {
      points050 += 1;
    } else if (mark === 0.75) {
      points075 += 1;
    } else if (mark === 1) {
      points100 += 1;
    }
  }

  return { points000, points025, points050, points075, points100 };
}

function extractSnapshotEventDetails(payload: ForumSnapshotPayload | null): SnapshotEventDetail[] {
  if (!payload || typeof payload !== "object" || !payload.eventDetailsById) {
    return [];
  }

  return Object.entries(payload.eventDetailsById)
    .filter(([, item]) => item && typeof item === "object")
    .map(([id, item]) => ({ ...item, id }));
}

export function AttendanceManagerScreen({ onBack }: AttendanceManagerScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;

  const [pendingAttendanceByMemberId, setPendingAttendanceByMemberId] = useState<Record<string, number>>({});
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(() => toIsoDateLocal(new Date()));
  const [visibleMonthKey, setVisibleMonthKey] = useState<string>(() => getMonthKeyFromIsoDate(toIsoDateLocal(new Date())));
  const [isBatchSaving, setIsBatchSaving] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSaveFeedback, setLastSaveFeedback] = useState<SaveFeedback | null>(null);
  const [selectedSectionKey, setSelectedSectionKey] = useState<string | null>(null);

  const canWrite = Boolean(
    ATTENDANCE_WRITE_UI_ENABLED &&
      supabaseAuthClient &&
      ATTENDANCE_WRITE_FUNCTION_URL,
  );

  const todayIso = useMemo(() => toIsoDateLocal(new Date()), []);
  const weekdayLabels = useMemo(
    () => [
      tr("Pon", "Mon"),
      tr("Wt", "Tue"),
      tr("Śr", "Wed"),
      tr("Czw", "Thu"),
      tr("Pt", "Fri"),
      tr("Sob", "Sat"),
      tr("Niedz", "Sun"),
    ],
    [],
  );
  const desktopTileWidth = useMemo(() => {
    if (!isDesktop) {
      return "100%";
    }
    if (width >= 1900) {
      return "24%";
    }
    if (width >= 1500) {
      return "32%";
    }
    return "49%";
  }, [isDesktop, width]);
  const memberGridColumns = useMemo(() => {
    if (!isDesktop) {
      return 1;
    }
    if (width >= 1900) {
      return 4;
    }
    if (width >= 1500) {
      return 3;
    }
    return 2;
  }, [isDesktop, width]);

  const handleDefaultSessionResolved = useCallback((defaultSession: SessionRow) => {
    setSelectedSessionKey(defaultSession.event_id);
    setSelectedDate(defaultSession.event_date);
    setVisibleMonthKey(getMonthKeyFromIsoDate(defaultSession.event_date));
  }, []);

  const {
    sessions,
    members,
    snapshotPayload,
    isBootLoading,
    setSessions,
  } = useAttendanceBootData({
    client: supabaseAuthClient,
    setErrorMessage,
    normalizeSessions: filterShadowPlaceholderSessions,
    chooseDefaultSession,
    onDefaultSession: handleDefaultSessionResolved,
  });

  const expectedRehearsalSet = useMemo(() => {
    return new Set(buildExpectedRehearsalDates(new Date(), 20, 20));
  }, []);

  const snapshotEvents = useMemo(() => extractSnapshotEventDetails(snapshotPayload), [snapshotPayload]);

  // The forum is the one source of events (docs/reference/attendance-model.md,
  // step 6): the panel lists forum events, plus rehearsals (sheet rehearsals, or a
  // planned Tuesday/Thursday one). Sheet events that are not on the forum and are
  // not rehearsals are not offered.
  const panelSessions = useMemo<ManagerSession[]>(() => {
    const result: ManagerSession[] = [];
    const rowByForumId = new Map<string, SessionRow>();
    for (const row of sessions) {
      if (row.forum_event_id) {
        rowByForumId.set(row.forum_event_id, row);
      }
    }

    const listedForumIds = new Set<string>();
    for (const detail of snapshotEvents) {
      const forumId = normalizeWhitespace(detail.id ?? "");
      const eventDate = parseDateOnly(detail.startsAt);
      if (!forumId || !eventDate) {
        continue;
      }
      listedForumIds.add(forumId);
      const linked = rowByForumId.get(forumId) ?? null;
      result.push({
        key: `forum:${forumId}`,
        event_id: linked?.event_id ?? null,
        title: stripTitleDatePrefix(normalizeWhitespace(detail.title ?? "")) || (linked?.title ?? ""),
        event_date: eventDate,
        source_header: linked?.source_header ?? null,
        source_column: linked?.source_column ?? null,
        isVirtual: !linked,
        forum_event_id: forumId,
      });
    }

    // Forum events saved earlier stay listed after the forum snapshot drops them.
    for (const [forumId, row] of rowByForumId) {
      if (listedForumIds.has(forumId)) {
        continue;
      }
      result.push({
        key: `forum:${forumId}`,
        event_id: row.event_id,
        title: row.title,
        event_date: row.event_date,
        source_header: row.source_header,
        source_column: row.source_column,
        isVirtual: false,
        forum_event_id: forumId,
      });
    }

    const rehearsalDates = new Set<string>();
    for (const row of sessions) {
      if (row.forum_event_id || !isRehearsalLikeSession(row)) {
        continue;
      }
      rehearsalDates.add(row.event_date);
      result.push({
        key: row.event_id,
        event_id: row.event_id,
        title: row.title,
        event_date: row.event_date,
        source_header: row.source_header,
        source_column: row.source_column,
        isVirtual: false,
        forum_event_id: null,
      });
    }

    for (const date of expectedRehearsalSet) {
      if (rehearsalDates.has(date)) {
        continue;
      }
      result.push({
        key: `virtual-rehearsal-${date}`,
        event_id: null,
        title: tr("Próba", "Rehearsal"),
        event_date: date,
        source_header: tr(`Próba ${date}`, `Rehearsal ${date}`),
        source_column: null,
        isVirtual: true,
        forum_event_id: null,
      });
    }

    return result.sort((left, right) => {
      const byDate = left.event_date.localeCompare(right.event_date);
      if (byDate !== 0) {
        return byDate;
      }
      // Forum events first, rehearsals after them on the same day.
      if (Boolean(left.forum_event_id) !== Boolean(right.forum_event_id)) {
        return left.forum_event_id ? -1 : 1;
      }
      return left.title.localeCompare(right.title, "pl");
    });
  }, [expectedRehearsalSet, sessions, snapshotEvents]);

  const sessionsByDate = useMemo(() => {
    const grouped = new Map<string, ManagerSession[]>();
    for (const session of panelSessions) {
      const bucket = grouped.get(session.event_date) ?? [];
      bucket.push(session);
      grouped.set(session.event_date, bucket);
    }
    return grouped;
  }, [panelSessions]);

  const calendarCells = useMemo(() => buildCalendarCells(visibleMonthKey), [visibleMonthKey]);

  const selectedDateSessions = useMemo<ManagerSession[]>(
    () => sessionsByDate.get(selectedDate) ?? [],
    [selectedDate, sessionsByDate],
  );

  useEffect(() => {
    if (selectedDateSessions.length === 0) {
      setSelectedSessionKey(null);
      return;
    }

    if (!selectedSessionKey || !selectedDateSessions.some((session) => session.key === selectedSessionKey)) {
      setSelectedSessionKey(selectedDateSessions[0].key);
    }
  }, [selectedDateSessions, selectedSessionKey]);

  const selectedSession = useMemo(
    () => selectedDateSessions.find((session) => session.key === selectedSessionKey) ?? null,
    [selectedDateSessions, selectedSessionKey],
  );

  useEffect(() => {
    setPendingAttendanceByMemberId({});
  }, [selectedSessionKey]);

  const selectedCanonicalEventId = selectedSession?.event_id ?? null;
  const {
    entriesByMemberId,
    isEntriesLoading,
    setEntriesByMemberId,
  } = useAttendanceEntries({
    client: supabaseAuthClient,
    selectedCanonicalEventId,
    setErrorMessage,
  });

  const mergedEntriesByMemberId = useMemo(
    () => ({ ...entriesByMemberId, ...pendingAttendanceByMemberId }),
    [entriesByMemberId, pendingAttendanceByMemberId],
  );

  const pendingChangesCount = useMemo(
    () => Object.keys(pendingAttendanceByMemberId).length,
    [pendingAttendanceByMemberId],
  );

  const memberGroups = useMemo(() => groupMembersByInstrument(members), [members]);
  const sectionGridRows = useMemo<SectionGridItem[][]>(() => {
    const groupByKey = new Map<string, { instrument: string; members: MemberRow[] }>();
    for (const group of memberGroups) {
      groupByKey.set(normalizeInstrumentKey(group.instrument), group);
    }

    const rows: SectionGridItem[][] = REHEARSAL_SECTION_ROWS.map((row) =>
      row.map((label) => {
        const key = normalizeInstrumentKey(label);
        const group = groupByKey.get(key) ?? null;
        return {
          key,
          label,
          group,
        };
      }),
    );

    return rows;
  }, [memberGroups]);
  const sectionByKey = useMemo(() => {
    const map = new Map<string, SectionGridItem>();
    for (const row of sectionGridRows) {
      for (const item of row) {
        map.set(item.key, item);
      }
    }
    return map;
  }, [sectionGridRows]);
  const selectedSection = useMemo(
    () => (selectedSectionKey ? sectionByKey.get(selectedSectionKey) ?? null : null),
    [sectionByKey, selectedSectionKey],
  );
  const selectedSectionMembers = selectedSection?.group?.members ?? [];
  const selectedSectionSummary = useMemo(
    () => summarizeGroupMarks(selectedSectionMembers, mergedEntriesByMemberId),
    [mergedEntriesByMemberId, selectedSectionMembers],
  );
  const sectionGridRowsDisplay = useMemo<SectionGridTile[][]>(() => {
    return sectionGridRows.map((row) =>
      row.map((item) => {
        const sectionMembers = item.group?.members ?? [];
        const summary = summarizeGroupMarks(sectionMembers, mergedEntriesByMemberId);
        const totalMembers = sectionMembers.length;
        const markedMembers = Math.max(totalMembers - summary.points000, 0);
        return {
          key: item.key,
          label: item.label,
          totalMembers,
          markedMembers,
        };
      }),
    );
  }, [mergedEntriesByMemberId, sectionGridRows]);

  useEffect(() => {
    if (!selectedSectionKey) {
      return;
    }
    if (!sectionByKey.has(selectedSectionKey)) {
      setSelectedSectionKey(null);
    }
  }, [sectionByKey, selectedSectionKey]);

  const memberIdByNormalizedName = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      const normalizedName = normalizePersonName(member.full_name);
      if (normalizedName && !map.has(normalizedName)) {
        map.set(normalizedName, member.member_id);
      }
    }
    return map;
  }, [members]);

  const rsvpHintMemberIds = useMemo(() => {
    const hinted = new Set<string>();
    // Declarations exist only for forum events; rehearsals have no forum poll.
    if (!selectedSession?.forum_event_id || snapshotEvents.length === 0) {
      return hinted;
    }

    const matchedSnapshotEvent = snapshotEvents.find((event) => event.id === selectedSession.forum_event_id) ?? null;
    if (!matchedSnapshotEvent) {
      return hinted;
    }

    for (const group of matchedSnapshotEvent.attendanceGroups ?? []) {
      const normalizedStatus = normalizeSearchText(group.status ?? "");
      if (normalizedStatus !== "going" && normalizedStatus !== "maybe") {
        continue;
      }

      for (const participant of group.participants ?? []) {
        const memberId = memberIdByNormalizedName.get(normalizePersonName(participant.fullName ?? ""));
        if (memberId) {
          hinted.add(memberId);
        }
      }
    }

    return hinted;
  }, [memberIdByNormalizedName, selectedSession, snapshotEvents]);
  const selectedSectionMemberCards = useMemo<SectionMemberCard[]>(() => {
    const hasSelectedSession = Boolean(selectedSession);
    const memberCards: SectionMemberCard[] = selectedSectionMembers.map((member) => {
      const ratio = mergedEntriesByMemberId[member.member_id];
      const mark = markFromRatio(ratio);
      const nextRatio = getNextAttendanceRatio(ratio);
      const isRsvpHinted = rsvpHintMemberIds.has(member.member_id);
      const hasPendingOverride = Object.prototype.hasOwnProperty.call(pendingAttendanceByMemberId, member.member_id);
      const isDisabled = !canWrite || !hasSelectedSession || isBatchSaving;

      return {
        kind: "member",
        key: member.member_id,
        memberId: member.member_id,
        fullName: member.full_name,
        mark,
        nextRatio,
        isRsvpHinted,
        hasPendingOverride,
        isDisabled,
      };
    });

    if (memberGridColumns <= 1 || memberCards.length === 0) {
      return memberCards;
    }

    const remainder = memberCards.length % memberGridColumns;
    if (remainder === 0) {
      return memberCards;
    }

    const placeholderCount = memberGridColumns - remainder;
    const placeholderItems: SectionMemberCard[] = Array.from({ length: placeholderCount }).map((_, index) => ({
      kind: "placeholder",
      key: `placeholder-${selectedSectionKey ?? "section"}-${index}`,
    }));

    return [...memberCards, ...placeholderItems];
  }, [
    canWrite,
    isBatchSaving,
    memberGridColumns,
    mergedEntriesByMemberId,
    pendingAttendanceByMemberId,
    rsvpHintMemberIds,
    selectedSectionKey,
    selectedSectionMembers,
    selectedSession,
  ]);
  const selectedSectionSummaryText = useMemo(
    () =>
      `1.00: ${selectedSectionSummary.points100} · 0.75: ${selectedSectionSummary.points075} · 0.50: ${selectedSectionSummary.points050} · 0.25: ${selectedSectionSummary.points025} · 0.00: ${selectedSectionSummary.points000}`,
    [selectedSectionSummary],
  );

  function handleSetAttendance(memberId: string, attendanceRatio: number) {
    if (!selectedSession) {
      setErrorMessage(tr("Najpierw wybierz sesję.", "Select a session first."));
      return;
    }

    setInfoMessage(null);
    setErrorMessage(null);
    setLastSaveFeedback(null);
    setPendingAttendanceByMemberId((current) => ({
      ...current,
      [memberId]: attendanceRatio,
    }));
  }

  function handleClearPendingChanges() {
    setPendingAttendanceByMemberId({});
    setInfoMessage(null);
  }

  async function handleSavePendingChanges() {
    if (!supabaseAuthClient || !ATTENDANCE_WRITE_FUNCTION_URL) {
      setErrorMessage(
        tr(
          "Zapisywanie obecności nie jest skonfigurowane w tej wersji aplikacji.",
          "Saving attendance is not configured in this build.",
        ),
      );
      return;
    }

    if (!selectedSession) {
      setErrorMessage(tr("Najpierw wybierz sesję.", "Select a session first."));
      return;
    }

    const changes = Object.entries(pendingAttendanceByMemberId).map(([memberId, attendanceRatio]) => ({
      memberId,
      attendanceRatio,
    }));
    if (changes.length === 0) {
      setInfoMessage(tr("Brak zmian do zapisania.", "No pending changes to save."));
      return;
    }

    setInfoMessage(null);
    setErrorMessage(null);
    setLastSaveFeedback(null);
    setIsBatchSaving(true);

    try {
      const { data: sessionData, error: sessionError } = await supabaseAuthClient.auth.getSession();
      if (sessionError) {
        throw new Error(sessionError.message);
      }

      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error(
          tr(
            "Brak aktywnej sesji użytkownika. Zaloguj się ponownie.",
            "No active user session. Please sign in again.",
          ),
        );
      }

      const response = await fetch(ATTENDANCE_WRITE_FUNCTION_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "enqueue_batch",
          // Forum events are found by forumEventId; the key "forum:…" is not an event id.
          eventId: selectedSession.event_id ?? (selectedSession.forum_event_id ? "" : selectedSession.key),
          forumEventId: selectedSession.forum_event_id ?? undefined,
          eventDate: selectedSession.event_date,
          eventTitle: selectedSession.title,
          source: "manager_panel",
          requestNote: `manager-attendance-batch:${selectedSession.key}`,
          changes,
        }),
      });

      let payload: EnqueueResponsePayload | null = null;
      try {
        payload = await response.json() as EnqueueResponsePayload;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const details = extractResponseErrorMessage(payload);
        throw new Error(
          details ||
            tr(
              "Nie udało się dodać zmian obecności do kolejki.",
              "Failed to enqueue attendance changes.",
            ),
        );
      }

      const resolvedEventId = normalizeWhitespace(payload?.event_id ?? "");
      const savedForumEventId = selectedSession.forum_event_id;
      if (savedForumEventId && resolvedEventId) {
        // The forum event is now linked to an event row (a sheet event with a
        // matching title, or a new one); the session keeps its "forum:…" key.
        setSessions((current) => {
          const hasRow = current.some((row) => row.event_id === resolvedEventId);
          if (hasRow) {
            return current.map((row) =>
              row.event_id === resolvedEventId ? { ...row, forum_event_id: savedForumEventId } : row,
            );
          }
          return [
            {
              event_id: resolvedEventId,
              title: selectedSession.title,
              event_date: selectedSession.event_date,
              source_header: null,
              source_column: null,
              forum_event_id: savedForumEventId,
            },
            ...current,
          ];
        });
      } else if (selectedSession.isVirtual && resolvedEventId) {
        setSessions((current) => {
          if (current.some((row) => row.event_id === resolvedEventId)) {
            return current;
          }

          return [
            {
              event_id: resolvedEventId,
              title: selectedSession.title,
              event_date: selectedSession.event_date,
              source_header: selectedSession.source_header,
              source_column: null,
            },
            ...current,
          ];
        });
        setSelectedSessionKey(resolvedEventId);
      }

      setEntriesByMemberId((current) => ({ ...current, ...pendingAttendanceByMemberId }));
      setPendingAttendanceByMemberId({});

      const changedCount = typeof payload?.queued_count === "number" ? payload.queued_count : changes.length;
      const isAppliedDirectly = normalizeSearchText(payload?.status ?? "") === "applied";
      const placeholderHint = payload?.event_resolution === "created_placeholder"
        ? tr(
          "Dodano nową sesję; kolumna w arkuszu powstanie przy zapisie.",
          "Added a new session; its sheet column will be created on save.",
        )
        : "";
      const exportHint = payload?.export_trigger?.triggered && payload?.export_trigger?.ok === false
        ? tr(
          "Zapisano, ale nie udało się przenieść zmian do arkusza obecności.",
          "Saved, but the changes could not be copied to the attendance sheet.",
        )
        : "";
      const notes = [placeholderHint, exportHint].filter((value) => value.length > 0).join(" ");
      setInfoMessage(notes || null);
      setLastSaveFeedback({
        count: changedCount,
        wasAppliedDirectly: isAppliedDirectly,
        timestampMs: Date.now(),
        notes: notes || null,
      });
    } catch (error) {
      setLastSaveFeedback(null);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : tr("Nie udało się zapisać obecności.", "Failed to save attendance."),
      );
    } finally {
      setIsBatchSaving(false);
    }
  }

  const sessionTotals = sectionGridRowsDisplay.flat().reduce(
    (totals, tile) => ({
      marked: totals.marked + tile.markedMembers,
      total: totals.total + tile.totalMembers,
    }),
    { marked: 0, total: 0 },
  );
  const saveDisabled = !canWrite || !selectedSession || pendingChangesCount === 0 || isBatchSaving;

  const sessionPicker = (
    <View style={styles.card}>
      {isBootLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.brand} size="small" />
          <Text style={styles.muted}>{tr("Ładowanie sesji…", "Loading sessions…")}</Text>
        </View>
      ) : (
        <>
          <View style={styles.monthHeader}>
            <Text style={styles.monthLabel}>{formatMonthLabel(visibleMonthKey)}</Text>
            <View style={styles.monthNav}>
              <Pressable
                onPress={() => setVisibleMonthKey((current) => shiftMonthKey(current, -1))}
                style={styles.iconButton}
                accessibilityRole="button"
                accessibilityLabel={tr("Poprzedni miesiąc", "Previous month")}
              >
                <Icon name="chevronLeft" size={18} color={colors.ink} />
              </Pressable>
              <Pressable
                onPress={() => setVisibleMonthKey((current) => shiftMonthKey(current, 1))}
                style={styles.iconButton}
                accessibilityRole="button"
                accessibilityLabel={tr("Następny miesiąc", "Next month")}
              >
                <Icon name="chevronRight" size={18} color={colors.ink} />
              </Pressable>
            </View>
          </View>

          <View style={styles.weekdayRow}>
            {weekdayLabels.map((label, index) => (
              <Text
                key={label}
                style={[styles.weekdayLabel, REHEARSAL_WEEKDAY_INDEXES.has(index) && styles.rehearsalColumnHead]}
              >
                {label}
              </Text>
            ))}
          </View>

          <View style={styles.calendarGrid}>
            {calendarCells.map((cell) => {
              const allSessionsForDate = sessionsByDate.get(cell.date) ?? [];
              // Counted: forum events and sheet rehearsals. Planned rehearsals are shown
              // by the shaded Tuesday/Thursday columns instead of a mark per day.
              const sessionsForDate = allSessionsForDate.filter(
                (session) => Boolean(session.forum_event_id) || !session.isVirtual,
              );
              const hasSessions = sessionsForDate.length > 0;
              const isSelected = cell.date === selectedDate;
              const isToday = cell.date === todayIso;
              const isRehearsalWeekday = REHEARSAL_WEEKDAY_INDEXES.has(
                weekdayMonToSun(parseIsoDateAsLocalNoon(cell.date)) - 1,
              );

              return (
                <View key={cell.date} style={[styles.dayCellSlot, isRehearsalWeekday && styles.rehearsalColumn]}>
                  <Pressable
                    onPress={() => {
                      setSelectedDate(cell.date);
                      setVisibleMonthKey(getMonthKeyFromIsoDate(cell.date));
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    style={[
                      styles.dayCell,
                      hasSessions && styles.dayCellHasSessions,
                      isToday && styles.dayCellToday,
                      isSelected && styles.dayCellSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayNumber,
                        !cell.inCurrentMonth && styles.dayNumberOutside,
                        hasSessions && styles.dayNumberStrong,
                        isSelected && styles.dayNumberSelected,
                      ]}
                    >
                      {String(Number(cell.date.slice(8, 10)))}
                    </Text>
                    <View style={styles.dayMarks}>
                      {hasSessions ? (
                        <Text style={[styles.dayMark, isSelected && styles.dayNumberSelected]}>
                          {sessionsForDate.length}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </View>

          <Text style={styles.legend}>
            {tr(
              "Liczba = wydarzenia w dniu · zacienione kolumny wt i czw = dni prób",
              "Number = events that day · shaded Tue and Thu columns = rehearsal days",
            )}
          </Text>

          <View style={styles.sessionBlock}>
            <Text style={styles.kicker}>{formatDateLabel(`${selectedDate}T12:00:00`)}</Text>
            {selectedDateSessions.length === 0 ? (
              <Text style={styles.muted}>{tr("Brak sesji w tym dniu.", "No sessions on this day.")}</Text>
            ) : (
              selectedDateSessions.map((session) => {
                const isSelected = session.key === selectedSessionKey;
                const sourceMeta = normalizeWhitespace(
                  [session.source_header, session.source_column].filter(Boolean).join(" / "),
                );
                return (
                  <Pressable
                    key={session.key}
                    onPress={() => setSelectedSessionKey(session.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    style={[
                      styles.sessionRow,
                      session.isVirtual && styles.sessionRowVirtual,
                      isSelected && styles.sessionRowSelected,
                    ]}
                  >
                    <Text style={[styles.sessionTitle, isSelected && styles.sessionTitleSelected]}>
                      {session.title}
                    </Text>
                    <Text style={styles.sessionMeta} numberOfLines={2}>
                      {session.forum_event_id
                        ? session.isVirtual
                          ? tr("Z forum · jeszcze bez wpisów w aplikacji", "From the forum · nothing entered in the app yet")
                          : tr("Z forum", "From the forum")
                        : session.isVirtual
                          ? tr(
                              "Brak kolumny w arkuszu: pierwszy zapis ją utworzy.",
                              "No sheet column yet: the first save creates it.",
                            )
                          : sourceMeta || tr("bez metadanych kolumny", "no column metadata")}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </View>
        </>
      )}
    </View>
  );

  const markingPanel = (
    <View style={styles.card}>
      {!selectedSection ? (
        <SectionGridPanel rows={sectionGridRowsDisplay} onSelectSection={setSelectedSectionKey} />
      ) : (
        <SectionMembersPanel
          sectionLabel={selectedSection.label}
          sectionSummaryText={selectedSectionSummaryText}
          cards={selectedSectionMemberCards}
          hasMembers={selectedSectionMembers.length > 0}
          memberGridColumns={memberGridColumns}
          isDesktop={isDesktop}
          desktopTileWidth={desktopTileWidth}
          selectedSessionKey={selectedSessionKey}
          pendingChangesCount={pendingChangesCount}
          isBatchSaving={isBatchSaving}
          onBackToSections={() => setSelectedSectionKey(null)}
          onSetAttendance={handleSetAttendance}
          formatMarkLabel={formatMarkLabel}
          formatAttendanceValue={formatAttendanceValue}
        />
      )}
    </View>
  );

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={[styles.content, isDesktop && styles.contentDesktop]}
      showsVerticalScrollIndicator={false}
    >
      {onBack ? (
        <Pressable onPress={onBack} style={styles.backLink} accessibilityRole="button">
          <Text style={styles.backLinkLabel}>{tr("‹ Wróć", "‹ Back")}</Text>
        </Pressable>
      ) : null}

      <View style={[styles.header, isDesktop && styles.headerDesktop]}>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>{tr("Wpisywanie obecności", "Attendance entry")}</Text>
          <Text style={styles.title} numberOfLines={2}>
            {selectedSession
              ? `${selectedSession.title}`
              : tr("Wybierz sesję", "Pick a session")}
          </Text>
          <Text style={styles.muted}>
            {selectedSession
              ? `${formatDateLabel(`${selectedSession.event_date}T12:00:00`)}${
                  selectedSession.isVirtual && !selectedSession.forum_event_id
                    ? tr(" · utworzy nową kolumnę", " · will create a new column")
                    : ""
                }`
              : tr("Dzień i sesję wybierzesz w kalendarzu.", "Pick the day and session in the calendar.")}
          </Text>
        </View>
        <View style={styles.headerActions}>
          {selectedSession && sessionTotals.total > 0 ? (
            <View style={styles.counter} accessibilityLabel={tr("Odklikani", "Marked")}>
              <Text style={styles.counterValue}>{sessionTotals.marked}</Text>
              <Text style={styles.counterTotal}> / {sessionTotals.total}</Text>
            </View>
          ) : null}
          <Button
            variant="secondary"
            label={tr("Wyczyść", "Clear")}
            disabled={pendingChangesCount === 0 || isBatchSaving}
            onPress={handleClearPendingChanges}
          />
          <Button
            label={
              isBatchSaving
                ? tr("Zapisywanie…", "Saving…")
                : pendingChangesCount > 0
                  ? tr(`Zapisz (${pendingChangesCount})`, `Save (${pendingChangesCount})`)
                  : tr("Zapisz", "Save")
            }
            disabled={saveDisabled}
            loading={isBatchSaving}
            onPress={() => void handleSavePendingChanges()}
          />
        </View>
      </View>

      {/* Off when EXPO_PUBLIC_ATTENDANCE_WRITE_ENABLED is unset or attendance_write_sheet_first is not configured. */}
      {!canWrite ? (
        <Notice tone="error">
          {tr(
            "Zapisywanie obecności jest wyłączone w tej wersji aplikacji.",
            "Saving attendance is turned off in this build.",
          )}
        </Notice>
      ) : null}
      {errorMessage ? <Notice tone="error">{errorMessage}</Notice> : null}
      {infoMessage ? <Notice tone="info">{infoMessage}</Notice> : null}
      {isBatchSaving ? (
        <Notice tone="info">
          {tr(
            `Zapisywanie ${pendingChangesCount} zmian: aktualizacja bazy i synchronizacja z arkuszem.`,
            `Saving ${pendingChangesCount} changes: updating the database and syncing the sheet.`,
          )}
        </Notice>
      ) : null}
      {!isBatchSaving && lastSaveFeedback ? (
        <Notice tone="success">
          {lastSaveFeedback.wasAppliedDirectly
            ? tr(
                `Zapisano ${lastSaveFeedback.count} wpisów o ${formatTimeLabel(lastSaveFeedback.timestampMs)}.`,
                `${lastSaveFeedback.count} changes saved at ${formatTimeLabel(lastSaveFeedback.timestampMs)}.`,
              )
            : tr(
                `Zakolejkowano ${lastSaveFeedback.count} wpisów o ${formatTimeLabel(lastSaveFeedback.timestampMs)}.`,
                `${lastSaveFeedback.count} changes queued at ${formatTimeLabel(lastSaveFeedback.timestampMs)}.`,
              )}
          {lastSaveFeedback.notes ? ` ${lastSaveFeedback.notes}` : ""}
        </Notice>
      ) : null}
      {pendingChangesCount > 0 && !isBatchSaving ? (
        <Notice tone="warning">
          {tr(
            `${pendingChangesCount} niezapisanych zmian.`,
            `${pendingChangesCount} unsaved changes.`,
          )}
        </Notice>
      ) : null}
      {rsvpHintMemberIds.size > 0 ? (
        <Text style={styles.hint}>
          {tr(
            `Podświetlono ${rsvpHintMemberIds.size} osób zadeklarowanych na forum (podpowiedź).`,
            `${rsvpHintMemberIds.size} members who declared on the forum are highlighted (hint).`,
          )}
        </Text>
      ) : null}
      {isEntriesLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.brand} size="small" />
          <Text style={styles.muted}>{tr("Ładowanie wpisów…", "Loading entries…")}</Text>
        </View>
      ) : null}

      {isDesktop ? (
        <View style={styles.columns}>
          <View style={styles.sideColumn}>
            {sessionPicker}
            <SheetCheckPanel refreshKey={lastSaveFeedback?.timestampMs} />
            <CsvExportPanel />
          </View>
          <View style={styles.mainColumn}>{markingPanel}</View>
        </View>
      ) : (
        <>
          {sessionPicker}
          {markingPanel}
          <SheetCheckPanel refreshKey={lastSaveFeedback?.timestampMs} />
          <CsvExportPanel />
        </>
      )}
    </ScrollView>
  );
}

const styles = themedStyles((colors) => ({
  screenScroll: {
    flex: 1,
  },
  content: {
    padding: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  contentDesktop: {
    width: "100%",
    maxWidth: 1280,
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
    color: colors.brand,
    fontWeight: "600",
  },
  header: {
    gap: tokens.spacing.sm,
    paddingBottom: tokens.spacing.xs,
  },
  headerDesktop: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  headerText: {
    flexShrink: 1,
    gap: 2,
  },
  kicker: textStyles.kicker,
  title: textStyles.pageTitle,
  muted: {
    fontSize: 14,
    color: colors.muted,
  },
  hint: {
    fontSize: 13,
    color: colors.muted,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.xs,
  },
  counter: {
    flexDirection: "row",
    alignItems: "baseline",
    marginRight: tokens.spacing.sm,
  },
  counterValue: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.ink,
  },
  counterTotal: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.muted,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.xs,
  },
  columns: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tokens.spacing.md,
    marginTop: tokens.spacing.xs,
  },
  sideColumn: {
    width: 320,
    gap: tokens.spacing.md,
  },
  mainColumn: {
    flex: 1,
    minWidth: 0,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: tokens.radii.lg,
    padding: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  monthLabel: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.ink,
    textTransform: "capitalize",
  },
  monthNav: {
    flexDirection: "row",
    gap: 4,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: tokens.radii.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  weekdayRow: {
    flexDirection: "row",
  },
  weekdayLabel: {
    width: `${100 / 7}%`,
    textAlign: "center",
    fontSize: 11,
    fontWeight: "600",
    color: colors.muted,
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dayCellSlot: {
    width: `${100 / 7}%`,
    padding: 2,
  },
  dayCell: {
    height: 44,
    borderRadius: tokens.radii.sm,
    borderWidth: 1.5,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  // Tuesday/Thursday rehearsal days: a neutral band down the whole column.
  rehearsalColumn: {
    backgroundColor: colors.surfaceMuted,
  },
  rehearsalColumnHead: {
    backgroundColor: colors.surfaceMuted,
    borderTopLeftRadius: tokens.radii.sm,
    borderTopRightRadius: tokens.radii.sm,
    paddingVertical: 4,
    color: colors.ink,
  },
  dayCellHasSessions: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  dayCellToday: {
    borderColor: colors.brand,
  },
  dayCellSelected: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  dayNumber: {
    fontSize: 14,
    color: colors.ink,
  },
  dayNumberOutside: {
    color: colors.controlBorder,
  },
  dayNumberStrong: {
    fontWeight: "700",
  },
  dayNumberSelected: {
    color: colors.onBrand,
  },
  dayMarks: {
    flexDirection: "row",
    gap: 3,
  },
  dayMark: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.muted,
  },
  legend: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
  },
  sessionBlock: {
    gap: 6,
    paddingTop: tokens.spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceMuted,
  },
  sessionRow: {
    borderRadius: tokens.radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  sessionRowVirtual: {
    borderStyle: "dashed",
    borderColor: colors.controlBorder,
  },
  sessionRowSelected: {
    backgroundColor: colors.brandTint,
    borderColor: colors.brand,
    borderStyle: "solid",
  },
  sessionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
  },
  sessionTitleSelected: {
    color: colors.successInk,
  },
  sessionMeta: {
    fontSize: 12,
    color: colors.muted,
  },
}));
