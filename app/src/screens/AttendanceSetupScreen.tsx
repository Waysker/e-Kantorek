import { useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { supabaseAuthClient } from "../auth/supabaseAuthClient";
import {
  buildOverridesFromAttendancePayload,
  parseAttendanceWorkbook,
  type AttendanceWorkbookPayload,
} from "../attendance/attendanceWorkbookParser";
import type { UserProfile } from "../domain/models";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { SurfaceCard } from "../ui/SurfaceCard";

const MAX_PREVIEW_EVENTS = 8;

type AttendanceSetupScreenProps = {
  currentUser: UserProfile;
  onBack: () => void;
};

function isPrivilegedRole(role: UserProfile["role"]) {
  return role === "admin" || role === "zarzad";
}

function resolveAttendanceKey() {
  return process.env.EXPO_PUBLIC_ATTENDANCE_KEY?.trim() ?? "forum";
}

function resolveOverridesKey() {
  return process.env.EXPO_PUBLIC_INSTRUMENT_OVERRIDES_KEY?.trim() ?? resolveAttendanceKey();
}

export function AttendanceSetupScreen({
  currentUser,
  onBack,
}: AttendanceSetupScreenProps) {
  const [parsedPayload, setParsedPayload] = useState<AttendanceWorkbookPayload | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const canManageAttendance = isPrivilegedRole(currentUser.role);

  async function handlePickWorkbook() {
    if (Platform.OS !== "web") {
      setErrorMessage(
        tr(
          "Wersja mobilna PoC nie obsługuje jeszcze importu plików. Użyj weba.",
          "Mobile PoC does not support workbook import yet. Use web for now.",
        ),
      );
      return;
    }

    const documentRef = (globalThis as { document?: any }).document;
    if (!documentRef?.createElement) {
      setErrorMessage(
        tr(
          "Nie udało się otworzyć wyboru pliku w tej przeglądarce.",
          "Could not open the file picker in this browser.",
        ),
      );
      return;
    }

    const input = documentRef.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls,.csv";

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        return;
      }

      setIsParsing(true);
      setErrorMessage(null);
      setInfoMessage(null);

      try {
        const buffer = await file.arrayBuffer();
        const parsed = parseAttendanceWorkbook(buffer, file.name);
        setParsedPayload(parsed);
        setSelectedFileName(file.name);
      } catch (error) {
        setParsedPayload(null);
        setSelectedFileName(null);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : tr(
                "Nie udało się sparsować pliku obecności.",
                "Attendance workbook parsing failed.",
              ),
        );
      } finally {
        setIsParsing(false);
      }
    };

    input.click();
  }

  async function handlePublish() {
    if (!parsedPayload) {
      setErrorMessage(
        tr(
          "Najpierw wybierz i sparsuj plik obecności.",
          "Choose and parse a workbook file first.",
        ),
      );
      return;
    }

    if (!supabaseAuthClient) {
      setErrorMessage(
        tr("Supabase Auth nie jest skonfigurowany.", "Supabase auth is not configured."),
      );
      return;
    }

    setIsPublishing(true);
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      const attendanceKey = resolveAttendanceKey();
      const overridesKey = resolveOverridesKey();
      const overridesPayload = buildOverridesFromAttendancePayload(parsedPayload);

      const { error: attendanceError } = await supabaseAuthClient
        .from("attendance_sheet_cache")
        .upsert(
          {
            attendance_key: attendanceKey,
            payload: parsedPayload,
            generated_at: parsedPayload.metadata.generatedAt,
          },
          { onConflict: "attendance_key" },
        );

      if (attendanceError) {
        throw new Error(`attendance_sheet_cache: ${attendanceError.message}`);
      }

      const { error: overridesError } = await supabaseAuthClient
        .from("forum_instrument_overrides")
        .upsert(
          {
            overrides_key: overridesKey,
            payload: overridesPayload,
          },
          { onConflict: "overrides_key" },
        );

      if (overridesError) {
        throw new Error(`forum_instrument_overrides: ${overridesError.message}`);
      }

      setInfoMessage(
        tr(
          `Opublikowano obecności i mapowanie instrumentów (${parsedPayload.summary.memberCount} osób, ${parsedPayload.summary.eventCount} wydarzeń).`,
          `Published attendance + instrument mapping (${parsedPayload.summary.memberCount} members, ${parsedPayload.summary.eventCount} events).`,
        ),
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : tr(
              "Publikacja do Supabase nie powiodła się.",
              "Publishing to Supabase failed.",
            ),
      );
    } finally {
      setIsPublishing(false);
    }
  }

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
    >
      <Pressable onPress={onBack} style={styles.backLink}>
        <Text style={styles.backLinkLabel}>
          {tr("Wróć do profilu", "Back to profile")}
        </Text>
      </Pressable>

      <SurfaceCard variant="brandTint">
        <Text style={styles.cardEyebrow}>
          {tr("PoC konfiguracji obecności", "Attendance setup PoC")}
        </Text>
        <Text style={styles.screenTitle}>
          {tr("Google Sheet -> Supabase", "Google Sheet -> Supabase")}
        </Text>
        <Text style={styles.cardBody}>
          {tr(
            "Dla etapu rozwojowego źródłem prawdy jest kopia arkusza obecności. Ten ekran publikuje parserowany workbook do Supabase oraz aktualizuje mapowanie instrumentów.",
            "For this development phase, the attendance workbook copy is the source of truth. This screen publishes parsed workbook data to Supabase and updates instrument mapping.",
          )}
        </Text>
      </SurfaceCard>

      {!canManageAttendance ? (
        <SurfaceCard variant="outline">
          <Text style={styles.cardTitle}>
            {tr("Brak uprawnień", "Insufficient permissions")}
          </Text>
          <Text style={styles.cardBody}>
            {tr(
              "Dostęp mają tylko role zarzad/admin.",
              "Only board/admin roles can access this setup.",
            )}
          </Text>
        </SurfaceCard>
      ) : (
        <SurfaceCard variant="default">
          <Text style={styles.cardTitle}>
            {tr("Import pliku obecności", "Attendance workbook import")}
          </Text>
          <Text style={styles.cardSecondary}>
            {tr(
              "Obsługiwany format: .xlsx/.xls (preferowany), opcjonalnie .csv.",
              "Supported format: .xlsx/.xls (preferred), optional .csv.",
            )}
          </Text>

          <View style={styles.buttonRow}>
            <Pressable
              style={styles.primaryButton}
              onPress={handlePickWorkbook}
              disabled={isParsing || isPublishing}
            >
              <Text style={styles.primaryButtonLabel}>
                {isParsing
                  ? tr("Parsowanie...", "Parsing...")
                  : tr("Wybierz plik", "Choose workbook")}
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.secondaryButton,
                (!parsedPayload || isPublishing) && styles.secondaryButtonDisabled,
              ]}
              onPress={handlePublish}
              disabled={!parsedPayload || isPublishing}
            >
              <Text style={styles.secondaryButtonLabel}>
                {isPublishing
                  ? tr("Publikacja...", "Publishing...")
                  : tr("Opublikuj do Supabase", "Publish to Supabase")}
              </Text>
            </Pressable>
          </View>

          {selectedFileName ? (
            <Text style={styles.cardSecondary}>
              {tr("Wybrany plik", "Selected file")}: {selectedFileName}
            </Text>
          ) : null}

          {parsedPayload ? (
            <View style={styles.summaryBlock}>
              <Text style={styles.cardEyebrow}>{tr("Podsumowanie", "Summary")}</Text>
              <Text style={styles.summaryLine}>
                {tr("Arkusze", "Sheets")}: {parsedPayload.summary.sheetCount}
              </Text>
              <Text style={styles.summaryLine}>
                {tr("Osoby", "Members")}: {parsedPayload.summary.memberCount}
              </Text>
              <Text style={styles.summaryLine}>
                {tr("Wydarzenia", "Events")}: {parsedPayload.summary.eventCount}
              </Text>
              <Text style={styles.summaryLine}>
                {tr("Wpisy punktowe", "Score entries")}: {parsedPayload.summary.scoreCount}
              </Text>
              <Text style={styles.summaryLine}>
                {tr("Suma punktów", "Total points")}: {parsedPayload.summary.totalPoints.toFixed(2)}
              </Text>

              <View style={styles.previewEventList}>
                <Text style={styles.cardEyebrow}>
                  {tr("Przykładowe wydarzenia", "Sample events")}
                </Text>
                {parsedPayload.events.slice(0, MAX_PREVIEW_EVENTS).map((event) => (
                  <Text key={event.id} style={styles.previewEventLine}>
                    {event.dateIso ? `${event.dateIso} - ` : ""}{event.label}
                  </Text>
                ))}
              </View>
            </View>
          ) : null}

          {infoMessage ? <Text style={styles.infoMessage}>{infoMessage}</Text> : null}
          {errorMessage ? <Text style={styles.errorMessage}>{errorMessage}</Text> : null}
        </SurfaceCard>
      )}
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
  screenTitle: {
    fontSize: tokens.typography.hero,
    lineHeight: 34,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  cardTitle: {
    fontSize: tokens.typography.title,
    lineHeight: 28,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  cardSecondary: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    color: tokens.colors.muted,
  },
  cardBody: {
    marginTop: tokens.spacing.sm,
    fontSize: tokens.typography.body,
    lineHeight: 22,
    color: tokens.colors.ink,
  },
  buttonRow: {
    marginTop: tokens.spacing.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.sm,
  },
  primaryButton: {
    backgroundColor: tokens.colors.brand,
    borderRadius: tokens.radii.round,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
  },
  primaryButtonLabel: {
    color: tokens.colors.surface,
    fontWeight: "700",
  },
  secondaryButton: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radii.round,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    borderWidth: 1,
    borderColor: tokens.colors.border,
  },
  secondaryButtonDisabled: {
    opacity: 0.6,
  },
  secondaryButtonLabel: {
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  summaryBlock: {
    marginTop: tokens.spacing.md,
    gap: 4,
  },
  summaryLine: {
    fontSize: tokens.typography.body,
    lineHeight: 21,
    color: tokens.colors.ink,
  },
  previewEventList: {
    marginTop: tokens.spacing.md,
    gap: 4,
  },
  previewEventLine: {
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    color: tokens.colors.muted,
  },
  infoMessage: {
    marginTop: tokens.spacing.md,
    color: tokens.colors.successInk,
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    fontWeight: "700",
  },
  errorMessage: {
    marginTop: tokens.spacing.md,
    color: tokens.colors.dangerInk,
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    fontWeight: "700",
  },
});
