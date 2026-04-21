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

const ATTENDANCE_WRITE_FUNCTION_NAME = "attendance_write_sheet_first";
const ATTENDANCE_WRITE_FUNCTION_URL = resolveAttendanceWriteFunctionUrl();
const ATTENDANCE_WRITE_UI_ENABLED = parseBooleanEnv(process.env.EXPO_PUBLIC_ATTENDANCE_WRITE_ENABLED);
const REHEARSAL_KEYWORDS = [
  "proba",
  "próba",
  "rehearsal",
  "wtorek",
  "czwartek",
  "tuesday",
  "thursday",
];

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

function normalizeSearchText(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
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

function isRehearsalLikeSession(session: SessionRow): boolean {
  const haystack = normalizeSearchText(
    [session.title, session.source_header, session.source_column].filter(Boolean).join(" "),
  );
  return REHEARSAL_KEYWORDS.some((keyword) => haystack.includes(keyword));
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

export function AttendanceManagerScreen({ onBack }: AttendanceManagerScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [entriesByMemberId, setEntriesByMemberId] = useState<Record<string, number>>({});
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
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
        setSelectedSessionId(defaultSession?.event_id ?? loadedSessions[0].event_id);
      } else {
        setSelectedSessionId(null);
      }

      setIsBootLoading(false);
    }

    void loadBootData();

    return () => {
      isCancelled = true;
    };
  }, []);

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

  const mappedEventSessions = useMemo(() => sessions.slice(0, 80), [sessions]);

  const rehearsalMappings = useMemo(() => {
    const expectedDates = buildExpectedRehearsalDates(new Date());
    const byDate = new Map<string, SessionRow[]>();
    for (const session of sessions) {
      const bucket = byDate.get(session.event_date) ?? [];
      bucket.push(session);
      byDate.set(session.event_date, bucket);
    }

    return expectedDates
      .map((date) => {
        const candidates = byDate.get(date) ?? [];
        const preferred = candidates.find((session) => isRehearsalLikeSession(session)) ?? candidates[0] ?? null;
        return { date, mappedSession: preferred };
      })
      .sort((left, right) => right.date.localeCompare(left.date));
  }, [sessions]);

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
        <Text style={styles.sectionTitle}>
          {tr("Sesje z arkusza (mapowanie)", "Mapped sessions from sheet")}
        </Text>
        {isBootLoading ? (
          <Text style={styles.copy}>{tr("Ładowanie sesji...", "Loading sessions...")}</Text>
        ) : mappedEventSessions.length === 0 ? (
          <Text style={styles.copy}>
            {tr("Brak sesji w tabeli events. Najpierw uruchom sync.", "No sessions in events table. Run sync first.")}
          </Text>
        ) : (
          <View style={styles.chipGrid}>
            {mappedEventSessions.map((session) => {
              const isSelected = session.event_id === selectedSessionId;
              return (
                <Pressable
                  key={session.event_id}
                  onPress={() => setSelectedSessionId(session.event_id)}
                  style={[styles.sessionChip, isSelected && styles.sessionChipActive]}
                >
                  <Text style={[styles.sessionChipDate, isSelected && styles.sessionChipDateActive]}>
                    {formatDateLabel(`${session.event_date}T12:00:00`)}
                  </Text>
                  <Text style={[styles.sessionChipTitle, isSelected && styles.sessionChipTitleActive]}>
                    {session.title}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </SurfaceCard>

      <SurfaceCard variant="outline">
        <Text style={styles.sectionTitle}>
          {tr("Próby wtorek/czwartek (oczekiwane)", "Expected rehearsals (Tue/Thu)")}
        </Text>
        <Text style={styles.copy}>
          {tr(
            "Daty prób są generowane kalendarzowo (wt/czw) i mapowane do kolumn arkusza. Brak mapowania oznacza brak kolumny do odklikania.",
            "Rehearsal dates are generated from calendar cadence (Tue/Thu) and mapped to sheet columns. Missing mapping means there is no column to click yet.",
          )}
        </Text>
        <View style={styles.rehearsalGrid}>
          {rehearsalMappings.map((item) => {
            const isMapped = Boolean(item.mappedSession);
            const isSelected = item.mappedSession?.event_id === selectedSessionId;

            return (
              <Pressable
                key={item.date}
                disabled={!item.mappedSession}
                onPress={() => setSelectedSessionId(item.mappedSession!.event_id)}
                style={[
                  styles.rehearsalChip,
                  isMapped ? styles.rehearsalChipMapped : styles.rehearsalChipMissing,
                  isSelected && styles.rehearsalChipActive,
                ]}
              >
                <Text style={styles.rehearsalChipDate}>{formatDateLabel(`${item.date}T12:00:00`)}</Text>
                <Text style={styles.rehearsalChipMeta}>
                  {isMapped
                    ? tr("zmapowane", "mapped")
                    : tr("brak kolumny", "missing column")}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SurfaceCard>

      <SurfaceCard variant="default">
        <Text style={styles.sectionTitle}>{tr("Odklikiwanie obecności", "Mark attendance")}</Text>
        {selectedSession ? (
          <Text style={styles.copy}>
            {tr("Wybrana sesja", "Selected session")}: {formatDateLabel(`${selectedSession.event_date}T12:00:00`)}
            {" - "}
            {selectedSession.title}
          </Text>
        ) : (
          <Text style={styles.copy}>{tr("Wybierz sesję powyżej.", "Choose a session above.")}</Text>
        )}
        {isEntriesLoading ? (
          <Text style={styles.copy}>{tr("Ładowanie wpisów...", "Loading entries...")}</Text>
        ) : null}
      </SurfaceCard>

      {memberGroups.map((group) => (
        <SurfaceCard key={group.instrument} variant="outline">
          <Text style={styles.instrumentTitle}>{group.instrument}</Text>
          <View style={styles.memberRows}>
            {group.members.map((member) => {
              const ratio = entriesByMemberId[member.member_id];
              const mark = markFromRatio(ratio);
              const isSaving = Boolean(isSavingByMemberId[member.member_id]);

              return (
                <View key={member.member_id} style={styles.memberRow}>
                  <View style={styles.memberTextCol}>
                    <Text style={styles.memberName}>{member.full_name}</Text>
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
        </SurfaceCard>
      ))}
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
  chipGrid: {
    marginTop: tokens.spacing.sm,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.sm,
  },
  sessionChip: {
    minWidth: 170,
    maxWidth: 250,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.sm,
    backgroundColor: tokens.colors.surface,
    gap: 2,
  },
  sessionChipActive: {
    borderColor: tokens.colors.brand,
    backgroundColor: tokens.colors.brandTint,
  },
  sessionChipDate: {
    fontSize: tokens.typography.caption,
    fontWeight: "700",
    color: tokens.colors.muted,
  },
  sessionChipDateActive: {
    color: tokens.colors.brand,
  },
  sessionChipTitle: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.ink,
    lineHeight: 16,
  },
  sessionChipTitleActive: {
    fontWeight: "700",
  },
  rehearsalGrid: {
    marginTop: tokens.spacing.sm,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.sm,
  },
  rehearsalChip: {
    borderRadius: tokens.radii.round,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.xs,
    borderWidth: 1,
    gap: 2,
  },
  rehearsalChipMapped: {
    borderColor: tokens.colors.successInk,
    backgroundColor: tokens.colors.successSurface,
  },
  rehearsalChipMissing: {
    borderColor: tokens.colors.border,
    backgroundColor: tokens.colors.surfaceMuted,
    opacity: 0.9,
  },
  rehearsalChipActive: {
    borderColor: tokens.colors.brand,
    shadowColor: "#000000",
    shadowOpacity: 0.07,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  rehearsalChipDate: {
    fontSize: tokens.typography.caption,
    fontWeight: "700",
    color: tokens.colors.ink,
  },
  rehearsalChipMeta: {
    fontSize: 11,
    color: tokens.colors.muted,
  },
  instrumentTitle: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: tokens.colors.muted,
    fontWeight: "700",
    marginBottom: tokens.spacing.sm,
  },
  memberRows: {
    gap: tokens.spacing.sm,
  },
  memberRow: {
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.sm,
    backgroundColor: tokens.colors.surface,
    gap: tokens.spacing.sm,
  },
  memberTextCol: {
    gap: 2,
  },
  memberName: {
    fontSize: tokens.typography.body,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  memberMeta: {
    fontSize: tokens.typography.caption,
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
    paddingVertical: tokens.spacing.xs,
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
