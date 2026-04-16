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
import type { AttendanceStatus, EventDetail, SquadGroup } from "../domain/models";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { AttendanceSummaryStrip } from "../ui/AttendanceSummaryStrip";
import { InstrumentRosterGrid } from "../ui/InstrumentRosterGrid";
import { SurfaceCard } from "../ui/SurfaceCard";

type AttendanceScreenProps = {
  event: EventDetail;
  onBack: () => void;
};

type SelectableAttendanceStatus = Exclude<AttendanceStatus, "no_response">;

type EnqueueResponsePayload = {
  status?: string;
  queue_id?: number;
  event_id?: string;
  event_resolution?: string;
  error?: string;
  message?: string;
};

const UNKNOWN_INSTRUMENT_LABEL = "Instrument not mapped yet";
const ATTENDANCE_WRITE_FUNCTION_NAME = "attendance_write_sheet_first";
const ATTENDANCE_WRITE_FUNCTION_URL = resolveAttendanceWriteFunctionUrl();
const ATTENDANCE_WRITE_UI_ENABLED = parseBooleanEnv(process.env.EXPO_PUBLIC_ATTENDANCE_WRITE_ENABLED);

function parseBooleanEnv(rawValue: string | undefined): boolean {
  const normalized = (rawValue ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

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

function attendanceRatioFromStatus(status: SelectableAttendanceStatus): number {
  if (status === "going") {
    return 1;
  }
  if (status === "maybe") {
    return 0.5;
  }
  return 0;
}

function extractEventDateFromStartsAt(startsAt: string): string | null {
  const directMatch = startsAt.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch) {
    return directMatch[1];
  }

  const parsedDate = new Date(startsAt);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(parsedDate);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return null;
  }

  return `${year}-${month}-${day}`;
}

function extractEnqueueErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  const message = typeof candidate.message === "string" ? candidate.message.trim() : "";
  if (message) {
    return message;
  }

  const error = typeof candidate.error === "string" ? candidate.error.trim() : "";
  if (error) {
    return error;
  }

  return null;
}

function sortGroupsByInstrument(left: SquadGroup, right: SquadGroup) {
  if (left.instrument === UNKNOWN_INSTRUMENT_LABEL) {
    return 1;
  }
  if (right.instrument === UNKNOWN_INSTRUMENT_LABEL) {
    return -1;
  }
  return left.instrument.localeCompare(right.instrument, "pl");
}

function mapDeclinedGroupsByInstrument(event: EventDetail): SquadGroup[] {
  const grouped = new Map<string, SquadGroup>();

  for (const responseGroup of event.attendanceGroups) {
    if (responseGroup.status !== "not_going") {
      continue;
    }

    for (const participant of responseGroup.participants) {
      const instrument = participant.primaryInstrument ?? UNKNOWN_INSTRUMENT_LABEL;
      const group = grouped.get(instrument) ?? {
        instrument,
        confirmedMembers: [],
        maybeMembers: [],
      };

      group.confirmedMembers.push({
        id: participant.id,
        fullName: participant.fullName,
      });
      grouped.set(instrument, group);
    }
  }

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      confirmedMembers: [...group.confirmedMembers].sort((left, right) =>
        left.fullName.localeCompare(right.fullName, "pl"),
      ),
    }))
    .sort(sortGroupsByInstrument);
}

export function AttendanceScreen({ event, onBack }: AttendanceScreenProps) {
  const [isDeclinedVisible, setIsDeclinedVisible] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<AttendanceStatus>(event.attendanceSummary.userStatus);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitInfo, setSubmitInfo] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;
  const declinedGroups = useMemo(() => mapDeclinedGroupsByInstrument(event), [event]);
  const canWriteFromApp = Boolean(
    ATTENDANCE_WRITE_UI_ENABLED &&
      supabaseAuthClient &&
      ATTENDANCE_WRITE_FUNCTION_URL,
  );

  const options: Array<{ key: SelectableAttendanceStatus; label: string }> = [
    { key: "going", label: tr("Będę", "Going") },
    { key: "maybe", label: tr("Może", "Maybe") },
    { key: "not_going", label: tr("Nie będę", "Not going") },
  ];

  useEffect(() => {
    setSelectedStatus(event.attendanceSummary.userStatus);
    setSubmitInfo(null);
    setSubmitError(null);
    setIsSubmitting(false);
  }, [event.id, event.attendanceSummary.userStatus]);

  async function handleAttendanceSelect(nextStatus: SelectableAttendanceStatus) {
    if (isSubmitting) {
      return;
    }

    if (!canWriteFromApp || !supabaseAuthClient || !ATTENDANCE_WRITE_FUNCTION_URL) {
      setSubmitInfo(null);
      setSubmitError(
        tr(
          "Zapis obecności nie jest jeszcze skonfigurowany w tej wersji aplikacji.",
          "Attendance write path is not configured in this app build yet.",
        ),
      );
      return;
    }

    const eventDate = extractEventDateFromStartsAt(event.startsAt);
    if (!eventDate) {
      setSubmitInfo(null);
      setSubmitError(
        tr(
          "Nie udało się odczytać daty wydarzenia potrzebnej do zapisania obecności.",
          "Could not parse event date required for attendance update.",
        ),
      );
      return;
    }

    setIsSubmitting(true);
    setSubmitInfo(null);
    setSubmitError(null);

    try {
      const { data: sessionData, error: sessionError } = await supabaseAuthClient.auth.getSession();
      if (sessionError) {
        throw new Error(sessionError.message);
      }

      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error(
          tr(
            "Brak aktywnej sesji. Zaloguj się ponownie i spróbuj jeszcze raz.",
            "No active session. Please sign in again and retry.",
          ),
        );
      }

      const enqueueResponse = await fetch(ATTENDANCE_WRITE_FUNCTION_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "enqueue",
          eventId: event.id,
          eventDate,
          eventTitle: event.title,
          attendanceRatio: attendanceRatioFromStatus(nextStatus),
          attendanceStatus: nextStatus,
          requestNote: `attendance-screen:${event.id}`,
        }),
      });

      let payload: EnqueueResponsePayload | null = null;
      try {
        payload = await enqueueResponse.json() as EnqueueResponsePayload;
      } catch {
        payload = null;
      }

      if (!enqueueResponse.ok) {
        const message = extractEnqueueErrorMessage(payload) ??
          tr("Nie udało się dodać zmiany obecności do kolejki.", "Failed to enqueue attendance change.");
        throw new Error(message);
      }

      setSelectedStatus(nextStatus);
      const queueId = typeof payload?.queue_id === "number" ? payload.queue_id : null;
      setSubmitInfo(
        queueId != null
          ? tr(`Zapis dodany do kolejki (#${queueId}).`, `Queued successfully (#${queueId}).`)
          : tr("Zapis dodany do kolejki.", "Queued successfully."),
      );
    } catch (error) {
      setSubmitError(
        error instanceof Error && error.message
          ? error.message
          : tr("Nie udało się zapisać obecności.", "Could not save attendance."),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const responseSelector = (
    <View style={styles.responseSelectorWrap}>
      <View style={styles.responseSelector}>
        {options.map((option) => {
          const isActive = selectedStatus === option.key;
          const isDisabled = isSubmitting || !canWriteFromApp;

          return (
            <Pressable
              key={option.key}
              onPress={() => {
                void handleAttendanceSelect(option.key);
              }}
              disabled={isDisabled}
              style={[
                styles.responsePill,
                isActive && styles.responsePillActive,
                !isDesktop && styles.responsePillMobile,
                isDisabled && canWriteFromApp && styles.responsePillDisabled,
              ]}
            >
              <Text
                style={[
                  styles.responsePillLabel,
                  isActive && styles.responsePillLabelActive,
                ]}
              >
                {option.label}
              </Text>
              <Text style={styles.responsePillMeta}>
                {!canWriteFromApp
                  ? (isActive ? tr("Zaimportowane", "Imported") : tr("Tylko odczyt", "Read-only"))
                  : (isSubmitting && isActive
                    ? tr("Zapisywanie...", "Saving...")
                    : (isActive ? tr("Wybrane", "Selected") : tr("Kliknij aby ustawić", "Tap to set")))}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {!canWriteFromApp ? (
        <Text style={[styles.responseNotice, styles.responseNoticeInfo]}>
          {ATTENDANCE_WRITE_UI_ENABLED
            ? tr(
                "Ta kompilacja działa w trybie podglądu. Włącz EXPO_PUBLIC_SUPABASE_URL i funkcję attendance_write_sheet_first, aby zapisywać obecność z panelu.",
                "This build is in preview mode. Configure EXPO_PUBLIC_SUPABASE_URL and attendance_write_sheet_first to enable updates from the panel.",
              )
            : tr(
                "Deklaracje obecności są obecnie synchronizowane z forum (źródło prawdy). Zmiany z panelu są wyłączone.",
                "Attendance declarations are currently synced from the forum (source of truth). Panel writes are disabled.",
              )}
        </Text>
      ) : null}

      {submitInfo ? <Text style={[styles.responseNotice, styles.responseNoticeSuccess]}>{submitInfo}</Text> : null}
      {submitError ? <Text style={[styles.responseNotice, styles.responseNoticeError]}>{submitError}</Text> : null}
    </View>
  );

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
        <Text style={styles.backLinkLabel}>{tr("Wróć do wydarzenia", "Back to Event")}</Text>
      </Pressable>

      {isDesktop ? (
        <View style={styles.headerSplitDesktop}>
          <SurfaceCard variant="default" style={styles.headerPrimary}>
            <Text style={styles.cardEyebrow}>
              {tr("Obecność i skład", "Attendance and roster")}
            </Text>
            <Text style={styles.screenTitle}>{event.title}</Text>
            <Text style={styles.cardSecondary}>
              {canWriteFromApp
                ? tr(
                    "Zmiana odpowiedzi trafia do kolejki zapisu i jest synchronizowana z arkuszem obecności.",
                    "Response updates are queued and synchronized with the attendance sheet.",
                  )
                : tr(
                    "Wersja tylko do odczytu z forum. Najważniejszy element to grupowanie sekcji poniżej.",
                    "Read-only forum prototype. The important part in this phase is the grouped section roster below.",
                  )}
            </Text>
            <AttendanceSummaryStrip summary={event.attendanceSummary} />
          </SurfaceCard>

          <SurfaceCard variant="outline" style={styles.headerSecondary}>
            <Text style={styles.cardEyebrow}>{tr("Twoja odpowiedź", "Your response")}</Text>
            {responseSelector}
          </SurfaceCard>
        </View>
      ) : (
        <SurfaceCard variant="default">
          <Text style={styles.cardEyebrow}>
            {tr("Obecność i skład", "Attendance and roster")}
          </Text>
          <Text style={styles.screenTitle}>{event.title}</Text>
          <Text style={styles.cardSecondary}>
            {canWriteFromApp
              ? tr(
                  "Zmiana odpowiedzi jest kolejowana i zapisywana do arkusza obecności.",
                  "Response updates are queued and written to the attendance sheet.",
                )
              : tr(
                  "Dane na żywo z ankiety forum, tylko do odczytu.",
                  "Live read-only import from the forum poll.",
                )}
          </Text>

          <View style={styles.mobileSummaryRow}>
            <AttendanceSummaryStrip summary={event.attendanceSummary} compact />
          </View>

          <View style={styles.mobileResponseBlock}>
            <Text style={styles.mobileResponseTitle}>
              {tr("Twoja odpowiedź", "Your response")}
            </Text>
            {responseSelector}
          </View>
        </SurfaceCard>
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {isDesktop
            ? tr("Grupy według instrumentu", "Grouped by instrument")
            : tr("Według instrumentu", "By instrument")}
        </Text>
        <Text style={styles.sectionCopy}>
          {isDesktop
            ? tr(
                "Obecność i skład są teraz pokazane w jednym, grupowanym układzie.",
                "Attendance and squad composition now live in one grouped layout.",
              )
            : tr(
                "Jeden grupowany widok zamiast oddzielnych stron obecności i składu.",
                "One grouped roster instead of separate attendance and squad pages.",
              )}
        </Text>
      </View>

      <InstrumentRosterGrid groups={event.squad.groups} />

      {event.attendanceSummary.notGoing > 0 ? (
        <View style={styles.declinedSection}>
          <Pressable
            onPress={() => setIsDeclinedVisible((current) => !current)}
            style={[
              styles.declinedToggle,
              isDeclinedVisible && styles.declinedToggleActive,
            ]}
          >
            <Text style={styles.declinedToggleTitle}>
              {isDeclinedVisible
                ? tr("Ukryj osoby, które odmówiły", "Hide declined members")
                : tr("Pokaż osoby, które odmówiły", "Show declined members")}
            </Text>
            <Text style={styles.declinedToggleMeta}>
              {tr("Odmówili", "Declined")}: {event.attendanceSummary.notGoing}
            </Text>
          </Pressable>

          {isDeclinedVisible ? (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>
                  {tr("Odmowy według instrumentu", "Declined by instrument")}
                </Text>
                <Text style={styles.sectionCopy}>
                  {tr(
                    "Ten widok jest domyślnie ukryty, żeby skupić się na potwierdzonym składzie.",
                    "This view is hidden by default to keep focus on the confirmed roster.",
                  )}
                </Text>
              </View>

              <InstrumentRosterGrid
                groups={declinedGroups}
                confirmedLabel={tr("odmówiło", "declined")}
                emptyStateLabel={tr(
                  "Brak osób, które odmówiły udziału.",
                  "No declined members for this event.",
                )}
              />
            </>
          ) : null}
        </View>
      ) : null}
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
    maxWidth: 1200,
  },
  backLink: {
    marginBottom: tokens.spacing.xs,
  },
  backLinkLabel: {
    color: tokens.colors.brand,
    fontWeight: "700",
  },
  headerSplitDesktop: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: tokens.spacing.md,
  },
  headerPrimary: {
    flex: 1.5,
  },
  headerSecondary: {
    flex: 1,
  },
  cardEyebrow: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: tokens.colors.muted,
    marginBottom: tokens.spacing.xs,
    fontWeight: "700",
  },
  screenTitle: {
    fontSize: tokens.typography.hero,
    lineHeight: 34,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  cardSecondary: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    color: tokens.colors.muted,
  },
  mobileSummaryRow: {
    marginTop: tokens.spacing.sm,
  },
  mobileResponseBlock: {
    marginTop: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  mobileResponseTitle: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  responseSelectorWrap: {
    gap: tokens.spacing.sm,
    marginTop: tokens.spacing.xs,
  },
  responseSelector: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.sm,
  },
  responsePill: {
    minWidth: 118,
    borderRadius: tokens.radii.lg,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    backgroundColor: tokens.colors.surface,
    gap: 2,
  },
  responsePillMobile: {
    flex: 1,
  },
  responsePillDisabled: {
    opacity: 0.72,
  },
  responsePillActive: {
    borderColor: tokens.colors.brand,
    backgroundColor: tokens.colors.brandTint,
  },
  responsePillLabel: {
    fontSize: tokens.typography.body,
    fontWeight: "700",
    color: tokens.colors.ink,
  },
  responsePillLabelActive: {
    color: tokens.colors.brand,
  },
  responsePillMeta: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
  },
  responseNotice: {
    borderRadius: tokens.radii.md,
    borderWidth: 1,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.sm,
    fontSize: tokens.typography.caption,
    lineHeight: 18,
  },
  responseNoticeInfo: {
    borderColor: tokens.colors.border,
    backgroundColor: tokens.colors.surface,
    color: tokens.colors.muted,
  },
  responseNoticeSuccess: {
    borderColor: tokens.colors.successInk,
    backgroundColor: tokens.colors.successSurface,
    color: tokens.colors.successInk,
  },
  responseNoticeError: {
    borderColor: tokens.colors.dangerInk,
    backgroundColor: tokens.colors.dangerSurface,
    color: tokens.colors.dangerInk,
  },
  sectionHeader: {
    gap: tokens.spacing.xs,
  },
  sectionTitle: {
    fontSize: tokens.typography.title,
    lineHeight: 28,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  sectionCopy: {
    fontSize: tokens.typography.body,
    lineHeight: 22,
    color: tokens.colors.muted,
  },
  declinedSection: {
    gap: tokens.spacing.sm,
  },
  declinedToggle: {
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    backgroundColor: tokens.colors.surface,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    gap: 2,
  },
  declinedToggleActive: {
    borderColor: tokens.colors.brand,
    backgroundColor: tokens.colors.brandTint,
  },
  declinedToggleTitle: {
    fontSize: tokens.typography.body,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  declinedToggleMeta: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
  },
});
