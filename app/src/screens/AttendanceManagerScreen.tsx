import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { supabaseAuthClient } from "../auth/supabaseAuthClient";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { SurfaceCard } from "../ui/SurfaceCard";
import { formatDateLabel } from "../utils/format";

type AttendanceManagerScreenProps = {
  onBack: () => void;
};

type MemberRow = {
  member_id: string;
  full_name: string;
  instrument: string;
  is_active: boolean;
};

type SessionRow = {
  event_id: string;
  title: string;
  event_date: string;
  source_header: string | null;
  source_column: string | null;
};

type ManagerSession = {
  key: string;
  event_id: string | null;
  title: string;
  event_date: string;
  source_header: string | null;
  source_column: string | null;
  isVirtual: boolean;
};

type AttendanceEntryRow = {
  member_id: string;
  attendance_ratio: number;
};

const ATTENDANCE_CYCLE_SEQUENCE = [0, 1, 0.75, 0.5, 0.25] as const;
type AttendanceRatioValue = (typeof ATTENDANCE_CYCLE_SEQUENCE)[number];

type EnqueueResponsePayload = {
  status?: string;
  queue_id?: number;
  queued_count?: number;
  queue_ids?: number[];
  event_id?: string;
  event_resolution?: string;
  error?: string;
  message?: string;
};

type SnapshotAttendanceParticipant = {
  fullName?: string;
};

type SnapshotAttendanceGroup = {
  status?: string;
  participants?: SnapshotAttendanceParticipant[];
};

type SnapshotEventDetail = {
  title?: string;
  startsAt?: string;
  attendanceGroups?: SnapshotAttendanceGroup[];
};

type ForumSnapshotPayload = {
  eventDetailsById?: Record<string, SnapshotEventDetail>;
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

const ATTENDANCE_WRITE_FUNCTION_NAME = "attendance_write_sheet_first";
const ATTENDANCE_WRITE_FUNCTION_URL = resolveAttendanceWriteFunctionUrl();
const ATTENDANCE_WRITE_UI_ENABLED = parseBooleanEnv(process.env.EXPO_PUBLIC_ATTENDANCE_WRITE_ENABLED);
const REHEARSAL_KEYWORDS = ["proba", "próba", "rehearsal", "wtorek", "czwartek", "tuesday", "thursday"];
const ATTENDANCE_RATIO_EPSILON = 0.001;

function resolveAttendanceWriteFunctionUrl(): string | null {
  const explicitUrl = process.env.EXPO_PUBLIC_ATTENDANCE_WRITE_FUNCTION_URL?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) {
    return null;
  }

  try {
    const parsed = new URL(supabaseUrl);
    const projectRef = parsed.hostname.split(".")[0]?.trim();
    if (!projectRef) {
      return null;
    }
    return `https://${projectRef}.functions.supabase.co/${ATTENDANCE_WRITE_FUNCTION_NAME}`;
  } catch {
    return null;
  }
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

function chooseDefaultSession(sessions: SessionRow[]): SessionRow | null {
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
    const instrument = normalizeWhitespace(member.instrument) || tr("Nieprzypisany", "Unassigned");
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

  const values = Object.values(payload.eventDetailsById);
  return values.filter((item) => item && typeof item === "object");
}

function scoreSnapshotTitleMatch(sessionTitle: string, eventTitle: string): number {
  const normalizedSessionTitle = normalizePersonName(sessionTitle);
  const normalizedEventTitle = normalizePersonName(eventTitle);
  if (!normalizedSessionTitle || !normalizedEventTitle) {
    return 0;
  }

  let score = 0;
  if (normalizedSessionTitle === normalizedEventTitle) {
    score += 1000;
  }
  if (normalizedEventTitle.includes(normalizedSessionTitle)) {
    score += 250;
  }
  if (normalizedSessionTitle.includes(normalizedEventTitle)) {
    score += 150;
  }

  const leftTokens = normalizedSessionTitle.split(" ").filter((token) => token.length >= 3);
  const rightTokens = new Set(normalizedEventTitle.split(" ").filter((token) => token.length >= 3));
  const overlap = leftTokens.filter((token) => rightTokens.has(token)).length;
  score += overlap * 25;

  return score;
}

function findMatchingSnapshotEvent(
  session: ManagerSession,
  snapshotEvents: SnapshotEventDetail[],
): SnapshotEventDetail | null {
  const dateMatches = snapshotEvents.filter((event) => parseDateOnly(event.startsAt) === session.event_date);
  if (dateMatches.length === 0) {
    return null;
  }

  if (dateMatches.length === 1) {
    return dateMatches[0];
  }

  const ranked = dateMatches
    .map((event) => ({
      event,
      score: scoreSnapshotTitleMatch(session.title, normalizeWhitespace(event.title ?? "")),
    }))
    .sort((left, right) => right.score - left.score);

  const best = ranked[0];
  const second = ranked[1];
  const scoreGap = second ? best.score - second.score : best.score;
  if (best.score <= 0 || scoreGap <= 0) {
    return null;
  }

  return best.event;
}

export function AttendanceManagerScreen({ onBack }: AttendanceManagerScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [snapshotPayload, setSnapshotPayload] = useState<ForumSnapshotPayload | null>(null);
  const [entriesByMemberId, setEntriesByMemberId] = useState<Record<string, number>>({});
  const [pendingAttendanceByMemberId, setPendingAttendanceByMemberId] = useState<Record<string, number>>({});
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(() => toIsoDateLocal(new Date()));
  const [visibleMonthKey, setVisibleMonthKey] = useState<string>(() => getMonthKeyFromIsoDate(toIsoDateLocal(new Date())));
  const [isBootLoading, setIsBootLoading] = useState(true);
  const [isEntriesLoading, setIsEntriesLoading] = useState(false);
  const [isBatchSaving, setIsBatchSaving] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  useEffect(() => {
    let isCancelled = false;

    async function loadBootData() {
      if (!supabaseAuthClient) {
        setErrorMessage(tr("Brak konfiguracji Supabase.", "Supabase is not configured."));
        setIsBootLoading(false);
        return;
      }

      setIsBootLoading(true);
      setErrorMessage(null);

      const [sessionsResult, membersResult, snapshotResult] = await Promise.all([
        supabaseAuthClient
          .from("events")
          .select("event_id,title,event_date,source_header,source_column")
          .order("event_date", { ascending: false })
          .limit(500),
        supabaseAuthClient
          .from("members")
          .select("member_id,full_name,instrument,is_active")
          .eq("is_active", true)
          .order("instrument", { ascending: true })
          .order("full_name", { ascending: true }),
        supabaseAuthClient
          .from("forum_snapshot_cache")
          .select("payload")
          .eq("snapshot_key", "forum")
          .maybeSingle<{ payload: ForumSnapshotPayload }>(),
      ]);

      if (isCancelled) {
        return;
      }

      if (sessionsResult.error) {
        setErrorMessage(sessionsResult.error.message);
        setIsBootLoading(false);
        return;
      }
      if (membersResult.error) {
        setErrorMessage(membersResult.error.message);
        setIsBootLoading(false);
        return;
      }

      const loadedSessions = (sessionsResult.data ?? []) as SessionRow[];
      const loadedMembers = (membersResult.data ?? []) as MemberRow[];
      setSessions(loadedSessions);
      setMembers(loadedMembers);
      setSnapshotPayload(snapshotResult.data?.payload ?? null);

      if (loadedSessions.length > 0) {
        const defaultSession = chooseDefaultSession(loadedSessions);
        if (defaultSession) {
          setSelectedSessionKey(defaultSession.event_id);
          setSelectedDate(defaultSession.event_date);
          setVisibleMonthKey(getMonthKeyFromIsoDate(defaultSession.event_date));
        }
      }

      setIsBootLoading(false);
    }

    void loadBootData();

    return () => {
      isCancelled = true;
    };
  }, []);

  const sessionsByDate = useMemo(() => {
    const grouped = new Map<string, SessionRow[]>();
    const sorted = [...sessions].sort((left, right) => {
      const byDate = left.event_date.localeCompare(right.event_date);
      if (byDate !== 0) {
        return byDate;
      }
      return left.title.localeCompare(right.title, "pl");
    });

    for (const session of sorted) {
      const bucket = grouped.get(session.event_date) ?? [];
      bucket.push(session);
      grouped.set(session.event_date, bucket);
    }

    return grouped;
  }, [sessions]);

  const expectedRehearsalSet = useMemo(() => {
    return new Set(buildExpectedRehearsalDates(new Date(), 20, 20));
  }, []);

  const calendarCells = useMemo(() => buildCalendarCells(visibleMonthKey), [visibleMonthKey]);

  const selectedDateSessions = useMemo<ManagerSession[]>(() => {
    const realSessions = (sessionsByDate.get(selectedDate) ?? []).map((session) => ({
      key: session.event_id,
      event_id: session.event_id,
      title: session.title,
      event_date: session.event_date,
      source_header: session.source_header,
      source_column: session.source_column,
      isVirtual: false,
    }));

    const shouldOfferVirtualRehearsal = expectedRehearsalSet.has(selectedDate) &&
      !realSessions.some((session) => isRehearsalLikeSession({
        event_id: session.key,
        title: session.title,
        event_date: session.event_date,
        source_header: session.source_header,
        source_column: session.source_column,
      }));

    if (!shouldOfferVirtualRehearsal) {
      return realSessions;
    }

    return [
      ...realSessions,
      {
        key: `virtual-rehearsal-${selectedDate}`,
        event_id: null,
        title: tr(`Próba ${selectedDate}`, `Rehearsal ${selectedDate}`),
        event_date: selectedDate,
        source_header: tr(`Próba ${selectedDate}`, `Rehearsal ${selectedDate}`),
        source_column: null,
        isVirtual: true,
      },
    ];
  }, [expectedRehearsalSet, selectedDate, sessionsByDate]);

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

  useEffect(() => {
    let isCancelled = false;

    async function loadEntries() {
      if (!supabaseAuthClient || !selectedCanonicalEventId) {
        setEntriesByMemberId({});
        return;
      }

      setIsEntriesLoading(true);
      setErrorMessage(null);
      const { data, error } = await supabaseAuthClient
        .from("attendance_entries")
        .select("member_id,attendance_ratio")
        .eq("event_id", selectedCanonicalEventId);

      if (isCancelled) {
        return;
      }

      if (error) {
        setErrorMessage(error.message);
        setIsEntriesLoading(false);
        return;
      }

      const map: Record<string, number> = {};
      for (const entry of (data ?? []) as AttendanceEntryRow[]) {
        map[entry.member_id] = Number(entry.attendance_ratio);
      }
      setEntriesByMemberId(map);
      setIsEntriesLoading(false);
    }

    void loadEntries();

    return () => {
      isCancelled = true;
    };
  }, [selectedCanonicalEventId]);

  const mergedEntriesByMemberId = useMemo(
    () => ({ ...entriesByMemberId, ...pendingAttendanceByMemberId }),
    [entriesByMemberId, pendingAttendanceByMemberId],
  );

  const pendingChangesCount = useMemo(
    () => Object.keys(pendingAttendanceByMemberId).length,
    [pendingAttendanceByMemberId],
  );

  const memberGroups = useMemo(() => groupMembersByInstrument(members), [members]);

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

  const snapshotEvents = useMemo(() => extractSnapshotEventDetails(snapshotPayload), [snapshotPayload]);

  const rsvpHintMemberIds = useMemo(() => {
    const hinted = new Set<string>();
    if (!selectedSession || selectedSession.isVirtual || snapshotEvents.length === 0) {
      return hinted;
    }

    const matchedSnapshotEvent = findMatchingSnapshotEvent(selectedSession, snapshotEvents);
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

  function handleSetAttendance(memberId: string, attendanceRatio: number) {
    if (!selectedSession) {
      setErrorMessage(tr("Najpierw wybierz sesję.", "Select a session first."));
      return;
    }

    setInfoMessage(null);
    setErrorMessage(null);
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
          "Funkcja zapisu nie jest skonfigurowana. Sprawdź EXPO_PUBLIC_SUPABASE_URL i deployment funkcji.",
          "Write function is not configured. Check EXPO_PUBLIC_SUPABASE_URL and function deployment.",
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
          eventId: selectedSession.event_id ?? selectedSession.key,
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
      if (selectedSession.isVirtual && resolvedEventId) {
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

      const queuedCount = typeof payload?.queued_count === "number" ? payload.queued_count : changes.length;
      const placeholderHint = payload?.event_resolution === "created_placeholder"
        ? tr(
          " Utworzono sesję roboczą i kolumna zostanie przygotowana przy zapisie.",
          " Working session was created and column will be prepared on write.",
        )
        : "";

      setInfoMessage(
        tr(`Zmieniono i zakolejkowano ${queuedCount} wpisów.`, `${queuedCount} changes queued.`) + placeholderHint,
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : tr("Nie udało się zapisać obecności.", "Failed to save attendance."),
      );
    } finally {
      setIsBatchSaving(false);
    }
  }

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={[
        styles.screenContent,
        isDesktop && styles.desktopContent,
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Pressable onPress={onBack} style={styles.backLink}>
        <Text style={styles.backLinkLabel}>{tr("Wróć do profilu", "Back to profile")}</Text>
      </Pressable>

      <SurfaceCard variant="default">
        <Text style={styles.cardEyebrow}>{tr("Panel zarządu", "Management panel")}</Text>
        <Text style={styles.title}>{tr("Faktyczna obecność", "Actual attendance")}</Text>
        <Text style={styles.copy}>
          {tr(
            "Klikaj w kafelek orkiestranta, aby przełączać punkty: 0 -> 1 -> 0.75 -> 0.50 -> 0.25. Deklaracje RSVP z eventów są tylko podpowiedzią i nie są źródłem prawdy.",
            "Click a member tile to cycle points: 0 -> 1 -> 0.75 -> 0.50 -> 0.25. RSVP declarations from events are only hints and are not the source of truth.",
          )}
        </Text>
        {!canWrite ? (
          <Text style={[styles.notice, styles.noticeError]}>
            {tr(
              ATTENDANCE_WRITE_UI_ENABLED
                ? "Zapis jest wyłączony: brak konfiguracji funkcji attendance_write_sheet_first dla tego buildu."
                : "Zapis jest wyłączony flagą EXPO_PUBLIC_ATTENDANCE_WRITE_ENABLED w tym buildzie.",
              ATTENDANCE_WRITE_UI_ENABLED
                ? "Write is disabled: attendance_write_sheet_first is not configured for this build."
                : "Write is disabled by EXPO_PUBLIC_ATTENDANCE_WRITE_ENABLED in this build.",
            )}
          </Text>
        ) : null}
        {infoMessage ? <Text style={[styles.notice, styles.noticeInfo]}>{infoMessage}</Text> : null}
        {errorMessage ? <Text style={[styles.notice, styles.noticeError]}>{errorMessage}</Text> : null}
      </SurfaceCard>

      <SurfaceCard variant="outline">
        <Text style={styles.sectionTitle}>{tr("Kalendarz sesji", "Session calendar")}</Text>
        <Text style={styles.copy}>
          {tr(
            "Wybierz dzień z kalendarza, a poniżej sesję dla tego dnia. Liczba oznacza ile sesji jest w dacie; P oznacza planowaną próbę (wt/czw).",
            "Pick a day from the calendar and then pick a session for that day. Number means how many sessions are on that date; R marks expected rehearsal days (Tue/Thu).",
          )}
        </Text>
        {isBootLoading ? (
          <Text style={styles.copy}>{tr("Ładowanie sesji...", "Loading sessions...")}</Text>
        ) : (
          <>
            <View style={styles.monthHeader}>
              <Pressable
                onPress={() => setVisibleMonthKey((current) => shiftMonthKey(current, -1))}
                style={styles.monthNavButton}
              >
                <Text style={styles.monthNavButtonLabel}>{tr("Poprzedni", "Prev")}</Text>
              </Pressable>
              <Text style={styles.monthLabel}>{formatMonthLabel(visibleMonthKey)}</Text>
              <Pressable
                onPress={() => setVisibleMonthKey((current) => shiftMonthKey(current, 1))}
                style={styles.monthNavButton}
              >
                <Text style={styles.monthNavButtonLabel}>{tr("Następny", "Next")}</Text>
              </Pressable>
            </View>

            <View style={styles.weekdayRow}>
              {weekdayLabels.map((label) => (
                <View key={label} style={styles.weekdayCell}>
                  <Text style={styles.weekdayLabel}>{label}</Text>
                </View>
              ))}
            </View>

            <View style={styles.calendarGrid}>
              {calendarCells.map((cell) => {
                const sessionsForDate = sessionsByDate.get(cell.date) ?? [];
                const hasSessions = sessionsForDate.length > 0;
                const isSelected = cell.date === selectedDate;
                const isToday = cell.date === todayIso;
                const rehearsalExpected = expectedRehearsalSet.has(cell.date);
                const rehearsalMissingMapping = rehearsalExpected && !sessionsForDate.some((session) => isRehearsalLikeSession(session));

                return (
                  <Pressable
                    key={cell.date}
                    onPress={() => {
                      setSelectedDate(cell.date);
                      setVisibleMonthKey(getMonthKeyFromIsoDate(cell.date));
                    }}
                    style={[
                      styles.dayCell,
                      !cell.inCurrentMonth && styles.dayCellOutsideMonth,
                      isSelected && styles.dayCellSelected,
                      isToday && styles.dayCellToday,
                      rehearsalMissingMapping && styles.dayCellGap,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayNumber,
                        !cell.inCurrentMonth && styles.dayNumberOutsideMonth,
                        isSelected && styles.dayNumberSelected,
                      ]}
                    >
                      {String(Number(cell.date.slice(8, 10)))}
                    </Text>

                    <View style={styles.dayIndicators}>
                      {hasSessions ? (
                        <View style={[styles.dayPill, styles.dayPillEvents]}>
                          <Text style={styles.dayPillLabel}>{sessionsForDate.length}</Text>
                        </View>
                      ) : null}
                      {rehearsalExpected ? (
                        <View
                          style={[
                            styles.dayPill,
                            rehearsalMissingMapping ? styles.dayPillMissing : styles.dayPillRehearsal,
                          ]}
                        >
                          <Text style={styles.dayPillLabel}>{tr("P", "R")}</Text>
                        </View>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.legendText}>
              {tr(
                "Liczba = ilość sesji, P = plan próby wt/czw, czerwone P = brak mapowania kolumny na ten dzień.",
                "Number = count of sessions, R = expected Tue/Thu rehearsal, red R = no mapped rehearsal column for that day.",
              )}
            </Text>

            <View style={styles.daySelectionBlock}>
              <Text style={styles.daySelectionTitle}>
                {tr("Wybrany dzień", "Selected day")}: {formatDateLabel(`${selectedDate}T12:00:00`)}
              </Text>
              {selectedDateSessions.length === 0 ? (
                <Text style={[styles.notice, styles.noticeError]}>
                  {tr(
                    "Brak sesji dla tej daty.",
                    "No sessions for this date.",
                  )}
                </Text>
              ) : (
                <View style={styles.sessionList}>
                  {selectedDateSessions.map((session) => {
                    const isSelected = session.key === selectedSessionKey;
                    const sourceMeta = normalizeWhitespace([session.source_header, session.source_column].filter(Boolean).join(" / "));

                    return (
                      <Pressable
                        key={session.key}
                        onPress={() => setSelectedSessionKey(session.key)}
                        style={[
                          styles.sessionListItem,
                          session.isVirtual && styles.sessionListItemVirtual,
                          isSelected && styles.sessionListItemActive,
                        ]}
                      >
                        <Text style={[styles.sessionListItemTitle, isSelected && styles.sessionListItemTitleActive]}>
                          {session.title}
                        </Text>
                        <Text style={styles.sessionListItemMeta}>
                          {session.isVirtual
                            ? tr(
                              "Próba bez kolumny w arkuszu: pierwszy zapis utworzy kolumnę automatycznie.",
                              "Rehearsal without sheet column: first write will create the column automatically.",
                            )
                            : sourceMeta || tr("bez metadanych kolumny", "no column metadata")}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        )}
      </SurfaceCard>

      <SurfaceCard variant="default">
        <Text style={styles.sectionTitle}>{tr("Odklikiwanie obecności", "Mark attendance")}</Text>
        {selectedSession ? (
          <Text style={styles.copy}>
            {tr("Aktywna sesja", "Active session")}: {formatDateLabel(`${selectedSession.event_date}T12:00:00`)}
            {" - "}
            {selectedSession.title}
            {selectedSession.isVirtual ? tr(" (utworzy nową kolumnę)", " (will create a new column)") : ""}
          </Text>
        ) : (
          <Text style={styles.copy}>{tr("Wybierz sesję z kalendarza powyżej.", "Pick a session from calendar above.")}</Text>
        )}
        {!selectedSession?.isVirtual && rsvpHintMemberIds.size > 0 ? (
          <Text style={styles.copy}>
            {tr(
              `Lekko podświetlono ${rsvpHintMemberIds.size} osób z deklaracją RSVP (podpowiedź).`,
              `${rsvpHintMemberIds.size} RSVP-declared members are softly highlighted (hint).`,
            )}
          </Text>
        ) : null}
        {pendingChangesCount > 0 ? (
          <Text style={styles.copy}>
            {tr(
              `Masz ${pendingChangesCount} zmian roboczych. Kliknij "Zapisz zmiany", gdy skończysz odklikiwanie.`,
              `${pendingChangesCount} staged changes. Click "Save changes" when done.`,
            )}
          </Text>
        ) : null}
        {isEntriesLoading ? (
          <Text style={styles.copy}>{tr("Ładowanie wpisów...", "Loading entries...")}</Text>
        ) : null}
        <View style={styles.batchActionsRow}>
          <Pressable
            disabled={!canWrite || !selectedSession || pendingChangesCount === 0 || isBatchSaving}
            onPress={() => {
              void handleSavePendingChanges();
            }}
            style={[
              styles.batchPrimaryButton,
              (!canWrite || !selectedSession || pendingChangesCount === 0 || isBatchSaving) && styles.batchButtonDisabled,
            ]}
          >
            <Text style={styles.batchPrimaryButtonLabel}>
              {isBatchSaving
                ? tr("Zapisywanie...", "Saving...")
                : tr(`Zapisz zmiany (${pendingChangesCount})`, `Save changes (${pendingChangesCount})`)}
            </Text>
          </Pressable>
          <Pressable
            disabled={pendingChangesCount === 0 || isBatchSaving}
            onPress={handleClearPendingChanges}
            style={[
              styles.batchSecondaryButton,
              (pendingChangesCount === 0 || isBatchSaving) && styles.batchButtonDisabled,
            ]}
          >
            <Text style={styles.batchSecondaryButtonLabel}>{tr("Wyczyść", "Clear")}</Text>
          </Pressable>
        </View>
      </SurfaceCard>

      {memberGroups.map((group) => {
        const summary = summarizeGroupMarks(group.members, mergedEntriesByMemberId);

        return (
          <SurfaceCard key={group.instrument} variant="outline">
            <View style={styles.instrumentHeader}>
              <View style={styles.instrumentHeaderTextCol}>
                <Text style={styles.instrumentTitle}>{group.instrument}</Text>
                <Text style={styles.instrumentSummary}>
                  {`1.00: ${summary.points100} · 0.75: ${summary.points075} · 0.50: ${summary.points050} · 0.25: ${summary.points025} · 0.00: ${summary.points000}`}
                </Text>
              </View>
            </View>

            <View style={[styles.memberRows, isDesktop && styles.memberRowsDesktop]}>
              {group.members.map((member) => {
                const ratio = mergedEntriesByMemberId[member.member_id];
                const mark = markFromRatio(ratio);
                const nextRatio = getNextAttendanceRatio(ratio);
                const isRsvpHinted = rsvpHintMemberIds.has(member.member_id);
                const hasPendingOverride = Object.prototype.hasOwnProperty.call(pendingAttendanceByMemberId, member.member_id);
                const isTileDisabled = !canWrite || !selectedSession || isBatchSaving;

                return (
                  <Pressable
                    key={member.member_id}
                    disabled={isTileDisabled}
                    onPress={() => {
                      handleSetAttendance(member.member_id, nextRatio);
                    }}
                    style={[
                      styles.memberRow,
                      isDesktop && styles.memberRowDesktop,
                      isDesktop && { width: desktopTileWidth },
                      isRsvpHinted && styles.memberRowHinted,
                      hasPendingOverride && styles.memberRowPending,
                      isTileDisabled && styles.memberRowDisabled,
                    ]}
                  >
                    <View style={styles.memberTextCol}>
                      <View style={styles.memberNameRow}>
                        <Text numberOfLines={1} style={styles.memberName}>{member.full_name}</Text>
                        {isRsvpHinted ? (
                          <Text style={styles.memberHintBadge}>{tr("RSVP", "RSVP")}</Text>
                        ) : null}
                      </View>
                      <Text
                        style={[
                          styles.memberMeta,
                          mark === 1
                            ? styles.memberMetaPresent
                            : mark === 0
                              ? styles.memberMetaAbsent
                              : null,
                        ]}
                      >
                        {formatMarkLabel(mark)}
                        {hasPendingOverride ? tr(" · do zapisu", " · pending save") : ""}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.cycleButton,
                        styles.cycleButtonActive,
                        mark === 1 ? styles.cycleButtonActiveStrong : null,
                      ]}
                    >
                      <Text style={styles.cycleButtonLabel}>{formatAttendanceValue(mark)}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </SurfaceCard>
        );
      })}
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
  desktopContent: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 1800,
  },
  backLink: {
    marginBottom: tokens.spacing.xs,
  },
  backLinkLabel: {
    color: tokens.colors.brand,
    fontWeight: "700",
  },
  cardEyebrow: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: tokens.colors.muted,
    marginBottom: tokens.spacing.xs,
    fontWeight: "700",
  },
  title: {
    fontSize: tokens.typography.hero,
    lineHeight: 34,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  sectionTitle: {
    fontSize: tokens.typography.title,
    lineHeight: 28,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  copy: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.body,
    lineHeight: 22,
    color: tokens.colors.muted,
  },
  notice: {
    marginTop: tokens.spacing.sm,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.xs,
    borderRadius: tokens.radii.md,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
  },
  noticeInfo: {
    backgroundColor: tokens.colors.brandTint,
    color: tokens.colors.brand,
  },
  noticeError: {
    backgroundColor: tokens.colors.dangerSurface,
    color: tokens.colors.dangerInk,
  },
  monthHeader: {
    marginTop: tokens.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacing.sm,
  },
  monthNavButton: {
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.round,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.xs,
    backgroundColor: tokens.colors.surface,
  },
  monthNavButtonLabel: {
    color: tokens.colors.muted,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
  },
  monthLabel: {
    flex: 1,
    textAlign: "center",
    color: tokens.colors.ink,
    fontSize: tokens.typography.body,
    fontWeight: "700",
  },
  weekdayRow: {
    marginTop: tokens.spacing.sm,
    flexDirection: "row",
  },
  weekdayCell: {
    width: "14.2857%",
    alignItems: "center",
  },
  weekdayLabel: {
    fontSize: 11,
    color: tokens.colors.muted,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  calendarGrid: {
    marginTop: tokens.spacing.xs,
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    overflow: "hidden",
    backgroundColor: tokens.colors.surface,
  },
  dayCell: {
    width: "14.2857%",
    minHeight: 72,
    borderWidth: 0.5,
    borderColor: tokens.colors.border,
    paddingHorizontal: 6,
    paddingVertical: 6,
    justifyContent: "space-between",
    backgroundColor: tokens.colors.surface,
  },
  dayCellOutsideMonth: {
    backgroundColor: tokens.colors.surfaceMuted,
    opacity: 0.55,
  },
  dayCellToday: {
    borderColor: tokens.colors.brand,
  },
  dayCellSelected: {
    backgroundColor: tokens.colors.brandTint,
    borderColor: tokens.colors.brand,
  },
  dayCellGap: {
    backgroundColor: tokens.colors.dangerSurface,
  },
  dayNumber: {
    color: tokens.colors.ink,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
  },
  dayNumberOutsideMonth: {
    color: tokens.colors.muted,
  },
  dayNumberSelected: {
    color: tokens.colors.brand,
  },
  dayIndicators: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 2,
  },
  dayPill: {
    borderRadius: tokens.radii.round,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  dayPillEvents: {
    backgroundColor: tokens.colors.brandTint,
  },
  dayPillRehearsal: {
    backgroundColor: tokens.colors.successSurface,
  },
  dayPillMissing: {
    backgroundColor: tokens.colors.dangerSurface,
  },
  dayPillLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: tokens.colors.ink,
  },
  legendText: {
    marginTop: tokens.spacing.xs,
    fontSize: 11,
    lineHeight: 16,
    color: tokens.colors.muted,
  },
  daySelectionBlock: {
    marginTop: tokens.spacing.sm,
    gap: tokens.spacing.xs,
  },
  daySelectionTitle: {
    color: tokens.colors.ink,
    fontSize: tokens.typography.body,
    fontWeight: "700",
  },
  sessionList: {
    gap: tokens.spacing.xs,
  },
  sessionListItem: {
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.xs,
    backgroundColor: tokens.colors.surface,
  },
  sessionListItemVirtual: {
    borderStyle: "dashed",
    borderColor: tokens.colors.brand,
    backgroundColor: tokens.colors.brandTint,
  },
  sessionListItemActive: {
    borderColor: tokens.colors.brand,
    backgroundColor: tokens.colors.brandTint,
  },
  sessionListItemTitle: {
    color: tokens.colors.ink,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
  },
  sessionListItemTitleActive: {
    color: tokens.colors.brand,
  },
  sessionListItemMeta: {
    marginTop: 2,
    color: tokens.colors.muted,
    fontSize: 11,
  },
  instrumentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.spacing.sm,
    paddingBottom: tokens.spacing.xs,
  },
  instrumentHeaderTextCol: {
    flex: 1,
    gap: 2,
  },
  instrumentTitle: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  instrumentSummary: {
    fontSize: 11,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  batchActionsRow: {
    marginTop: tokens.spacing.sm,
    flexDirection: "row",
    gap: tokens.spacing.xs,
  },
  batchPrimaryButton: {
    flex: 1,
    borderRadius: tokens.radii.round,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    backgroundColor: tokens.colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  batchPrimaryButtonLabel: {
    color: tokens.colors.surface,
    fontWeight: "700",
    fontSize: tokens.typography.caption,
  },
  batchSecondaryButton: {
    borderRadius: tokens.radii.round,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    backgroundColor: tokens.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  batchSecondaryButtonLabel: {
    color: tokens.colors.muted,
    fontWeight: "700",
    fontSize: tokens.typography.caption,
  },
  batchButtonDisabled: {
    opacity: 0.45,
  },
  memberRows: {
    gap: 6,
  },
  memberRowsDesktop: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  memberRow: {
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: tokens.colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  memberRowHinted: {
    backgroundColor: tokens.colors.brandTint,
    borderColor: tokens.colors.brand,
  },
  memberRowPending: {
    borderColor: tokens.colors.brand,
  },
  memberRowDisabled: {
    opacity: 0.65,
  },
  memberRowDesktop: {
    minHeight: 54,
  },
  memberTextCol: {
    flex: 1,
    gap: 2,
  },
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  memberName: {
    flexShrink: 1,
    fontSize: tokens.typography.body,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  memberHintBadge: {
    fontSize: 10,
    color: tokens.colors.brand,
    borderWidth: 1,
    borderColor: tokens.colors.brand,
    borderRadius: tokens.radii.round,
    paddingHorizontal: 6,
    paddingVertical: 1,
    fontWeight: "700",
  },
  memberMeta: {
    fontSize: 11,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  memberMetaPresent: {
    color: tokens.colors.successInk,
  },
  memberMetaAbsent: {
    color: tokens.colors.dangerInk,
  },
  cycleButton: {
    minWidth: 66,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: tokens.radii.round,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    backgroundColor: tokens.colors.surface,
    alignItems: "center",
  },
  cycleButtonActive: {
    borderColor: tokens.colors.brand,
    backgroundColor: tokens.colors.brandTint,
  },
  cycleButtonActiveStrong: {
    borderColor: tokens.colors.successInk,
    backgroundColor: tokens.colors.successSurface,
  },
  cycleButtonLabel: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
});
