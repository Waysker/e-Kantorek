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

type AttendanceEntryRow = {
  member_id: string;
  attendance_ratio: number;
};

type AttendanceMark = "present" | "absent" | "unknown";

type EnqueueResponsePayload = {
  status?: string;
  queue_id?: number;
  error?: string;
  message?: string;
};

type CalendarCell = {
  date: string;
  inCurrentMonth: boolean;
};

type GroupSummary = {
  present: number;
  absent: number;
  unknown: number;
};

const ATTENDANCE_WRITE_FUNCTION_NAME = "attendance_write_sheet_first";
const ATTENDANCE_WRITE_FUNCTION_URL = resolveAttendanceWriteFunctionUrl();
const ATTENDANCE_WRITE_UI_ENABLED = parseBooleanEnv(process.env.EXPO_PUBLIC_ATTENDANCE_WRITE_ENABLED);

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

function parseIsoDateAsLocalNoon(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00`);
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

function markFromRatio(attendanceRatio: number | undefined): AttendanceMark {
  if (attendanceRatio == null || !Number.isFinite(attendanceRatio)) {
    return "unknown";
  }
  return attendanceRatio >= 0.75 ? "present" : "absent";
}

function formatMarkLabel(mark: AttendanceMark): string {
  if (mark === "present") {
    return tr("obecny", "present");
  }
  if (mark === "absent") {
    return tr("nieobecny", "absent");
  }
  return tr("brak wpisu", "not marked");
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
  let present = 0;
  let absent = 0;
  let unknown = 0;

  for (const member of members) {
    const mark = markFromRatio(entriesByMemberId[member.member_id]);
    if (mark === "present") {
      present += 1;
    } else if (mark === "absent") {
      absent += 1;
    } else {
      unknown += 1;
    }
  }

  return { present, absent, unknown };
}

export function AttendanceManagerScreen({ onBack }: AttendanceManagerScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [entriesByMemberId, setEntriesByMemberId] = useState<Record<string, number>>({});
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(() => toIsoDateLocal(new Date()));
  const [visibleMonthKey, setVisibleMonthKey] = useState<string>(() => getMonthKeyFromIsoDate(toIsoDateLocal(new Date())));
  const [expandedInstruments, setExpandedInstruments] = useState<Record<string, boolean>>({});
  const [isBootLoading, setIsBootLoading] = useState(true);
  const [isEntriesLoading, setIsEntriesLoading] = useState(false);
  const [isSavingByMemberId, setIsSavingByMemberId] = useState<Record<string, boolean>>({});
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

      const [sessionsResult, membersResult] = await Promise.all([
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

      if (loadedSessions.length > 0) {
        const defaultSession = chooseDefaultSession(loadedSessions);
        if (defaultSession) {
          setSelectedSessionId(defaultSession.event_id);
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

  const selectedDateSessions = useMemo(() => {
    return sessionsByDate.get(selectedDate) ?? [];
  }, [selectedDate, sessionsByDate]);

  useEffect(() => {
    const candidates = sessionsByDate.get(selectedDate) ?? [];
    if (candidates.length === 0) {
      if (selectedSessionId !== null) {
        setSelectedSessionId(null);
      }
      return;
    }

    if (!selectedSessionId || !candidates.some((session) => session.event_id === selectedSessionId)) {
      setSelectedSessionId(candidates[0].event_id);
    }
  }, [selectedDate, selectedSessionId, sessionsByDate]);

  useEffect(() => {
    let isCancelled = false;

    async function loadEntries() {
      if (!supabaseAuthClient || !selectedSessionId) {
        setEntriesByMemberId({});
        return;
      }

      setIsEntriesLoading(true);
      setErrorMessage(null);
      const { data, error } = await supabaseAuthClient
        .from("attendance_entries")
        .select("member_id,attendance_ratio")
        .eq("event_id", selectedSessionId);

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
  }, [selectedSessionId]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.event_id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  const memberGroups = useMemo(() => groupMembersByInstrument(members), [members]);

  useEffect(() => {
    setExpandedInstruments((current) => {
      const next: Record<string, boolean> = {};
      memberGroups.forEach((group, index) => {
        next[group.instrument] = current[group.instrument] ?? index === 0;
      });
      return next;
    });
  }, [memberGroups]);

  async function handleSetAttendance(memberId: string, attendanceRatio: number) {
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

    setInfoMessage(null);
    setErrorMessage(null);
    setIsSavingByMemberId((current) => ({ ...current, [memberId]: true }));

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
          mode: "enqueue",
          eventId: selectedSession.event_id,
          eventDate: selectedSession.event_date,
          eventTitle: selectedSession.title,
          memberId,
          attendanceRatio,
          source: "manager_panel",
          requestNote: `manager-attendance:${selectedSession.event_id}:${memberId}`,
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
              "Nie udało się dodać zmiany obecności do kolejki.",
              "Failed to enqueue attendance change.",
            ),
        );
      }

      setEntriesByMemberId((current) => ({ ...current, [memberId]: attendanceRatio }));
      const queueId = typeof payload?.queue_id === "number" ? payload.queue_id : null;
      setInfoMessage(
        queueId != null
          ? tr(`Zmiana dodana do kolejki (#${queueId}).`, `Queued successfully (#${queueId}).`)
          : tr("Zmiana dodana do kolejki.", "Queued successfully."),
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : tr("Nie udało się zapisać obecności.", "Failed to save attendance."),
      );
    } finally {
      setIsSavingByMemberId((current) => ({ ...current, [memberId]: false }));
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
            "Tutaj zaznaczasz realną obecność po próbie/wydarzeniu. Deklaracje RSVP z eventów są tylko podpowiedzią i nie są źródłem prawdy.",
            "Use this screen to mark real attendance after rehearsal/event. RSVP declarations from events are only hints and are not the source of truth.",
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
                const rehearsalMissingMapping = rehearsalExpected && !hasSessions;

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
                "Number = count of sessions, R = expected Tue/Thu rehearsal, red R = no mapped session for that day.",
              )}
            </Text>

            <View style={styles.daySelectionBlock}>
              <Text style={styles.daySelectionTitle}>
                {tr("Wybrany dzień", "Selected day")}: {formatDateLabel(`${selectedDate}T12:00:00`)}
              </Text>
              {selectedDateSessions.length === 0 ? (
                <Text style={[styles.notice, styles.noticeError]}>
                  {tr(
                    "Brak zmapowanej sesji dla tej daty. Najpierw dodaj/uzupełnij mapowanie w arkuszu i uruchom sync.",
                    "No mapped session for this date. Add/fix mapping in sheet and run sync first.",
                  )}
                </Text>
              ) : (
                <View style={styles.sessionList}>
                  {selectedDateSessions.map((session) => {
                    const isSelected = session.event_id === selectedSessionId;
                    const sourceMeta = normalizeWhitespace([session.source_header, session.source_column].filter(Boolean).join(" / "));

                    return (
                      <Pressable
                        key={session.event_id}
                        onPress={() => setSelectedSessionId(session.event_id)}
                        style={[styles.sessionListItem, isSelected && styles.sessionListItemActive]}
                      >
                        <Text style={[styles.sessionListItemTitle, isSelected && styles.sessionListItemTitleActive]}>
                          {session.title}
                        </Text>
                        <Text style={styles.sessionListItemMeta}>
                          {sourceMeta || tr("bez metadanych kolumny", "no column metadata")}
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
          </Text>
        ) : (
          <Text style={styles.copy}>{tr("Wybierz sesję z kalendarza powyżej.", "Pick a session from calendar above.")}</Text>
        )}
        {isEntriesLoading ? (
          <Text style={styles.copy}>{tr("Ładowanie wpisów...", "Loading entries...")}</Text>
        ) : null}
      </SurfaceCard>

      {memberGroups.map((group) => {
        const isExpanded = Boolean(expandedInstruments[group.instrument]);
        const summary = summarizeGroupMarks(group.members, entriesByMemberId);

        return (
          <SurfaceCard key={group.instrument} variant="outline">
            <Pressable
              onPress={() => {
                setExpandedInstruments((current) => ({
                  ...current,
                  [group.instrument]: !current[group.instrument],
                }));
              }}
              style={styles.instrumentHeader}
            >
              <View style={styles.instrumentHeaderTextCol}>
                <Text style={styles.instrumentTitle}>{group.instrument}</Text>
                <Text style={styles.instrumentSummary}>
                  {tr("Ob", "P")}: {summary.present} · {tr("Nie", "A")}: {summary.absent} · {tr("Brak", "Unk")}: {summary.unknown}
                </Text>
              </View>
              <Text style={styles.instrumentToggleLabel}>{isExpanded ? tr("Ukryj", "Hide") : tr("Pokaż", "Show")}</Text>
            </Pressable>

            {isExpanded ? (
              <View style={[styles.memberRows, isDesktop && styles.memberRowsDesktop]}>
                {group.members.map((member) => {
                  const ratio = entriesByMemberId[member.member_id];
                  const mark = markFromRatio(ratio);
                  const isSaving = Boolean(isSavingByMemberId[member.member_id]);

                  return (
                    <View key={member.member_id} style={[styles.memberRow, isDesktop && styles.memberRowDesktop]}>
                      <View style={styles.memberTextCol}>
                        <Text numberOfLines={1} style={styles.memberName}>{member.full_name}</Text>
                        <Text
                          style={[
                            styles.memberMeta,
                            mark === "present"
                              ? styles.memberMetaPresent
                              : mark === "absent"
                                ? styles.memberMetaAbsent
                                : null,
                          ]}
                        >
                          {formatMarkLabel(mark)}
                          {ratio != null ? ` (${Math.round(ratio * 100)}%)` : ""}
                        </Text>
                      </View>

                      <View style={styles.memberActions}>
                        <Pressable
                          disabled={!canWrite || !selectedSession || isSaving}
                          onPress={() => {
                            void handleSetAttendance(member.member_id, 1);
                          }}
                          style={[
                            styles.actionButton,
                            mark === "present" && styles.actionButtonPresentActive,
                          ]}
                        >
                          <Text style={[styles.actionButtonLabel, mark === "present" && styles.actionButtonLabelOn]}>
                            {tr("Obecny", "Present")}
                          </Text>
                        </Pressable>
                        <Pressable
                          disabled={!canWrite || !selectedSession || isSaving}
                          onPress={() => {
                            void handleSetAttendance(member.member_id, 0);
                          }}
                          style={[
                            styles.actionButton,
                            mark === "absent" && styles.actionButtonAbsentActive,
                          ]}
                        >
                          <Text style={[styles.actionButtonLabel, mark === "absent" && styles.actionButtonLabelOn]}>
                            {tr("Nieobecny", "Absent")}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}
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
    maxWidth: 1260,
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
  instrumentToggleLabel: {
    color: tokens.colors.brand,
    fontWeight: "700",
    fontSize: tokens.typography.caption,
  },
  memberRows: {
    gap: tokens.spacing.xs,
  },
  memberRowsDesktop: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  memberRow: {
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.xs,
    backgroundColor: tokens.colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacing.sm,
  },
  memberRowDesktop: {
    width: "49%",
  },
  memberTextCol: {
    flex: 1,
    gap: 2,
  },
  memberName: {
    fontSize: tokens.typography.body,
    color: tokens.colors.ink,
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
  memberActions: {
    flexDirection: "row",
    gap: tokens.spacing.xs,
  },
  actionButton: {
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: 6,
    borderRadius: tokens.radii.round,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    backgroundColor: tokens.colors.surface,
  },
  actionButtonPresentActive: {
    borderColor: tokens.colors.successInk,
    backgroundColor: tokens.colors.successSurface,
  },
  actionButtonAbsentActive: {
    borderColor: tokens.colors.dangerInk,
    backgroundColor: tokens.colors.dangerSurface,
  },
  actionButtonLabel: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  actionButtonLabelOn: {
    color: tokens.colors.ink,
  },
});
