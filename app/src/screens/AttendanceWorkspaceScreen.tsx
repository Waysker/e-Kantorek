import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { supabaseAuthClient } from "../auth/supabaseAuthClient";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { SurfaceCard } from "../ui/SurfaceCard";

type AttendanceWorkspaceScreenProps = {
  canWriteAttendance: boolean;
  canViewAttendanceSummary: boolean;
  onOpenAttendanceManager?: () => void;
  onOpenAttendanceSummary?: () => void;
};

type CsvExportItem = {
  source_gid: string;
  month_key: string | null;
  events_count: number;
  member_rows_count: number;
  date_from: string | null;
  date_to: string | null;
  file_name: string;
  csv: string;
};

type CsvExportResponse = {
  status?: string;
  exports?: CsvExportItem[];
  message?: string;
  error?: string;
};

const ATTENDANCE_CSV_EXPORT_FUNCTION_NAME = "attendance_csv_export";
const ATTENDANCE_CSV_EXPORT_FUNCTION_URL = resolveAttendanceCsvExportFunctionUrl();

function resolveAttendanceCsvExportFunctionUrl(): string | null {
  const explicitUrl = process.env.EXPO_PUBLIC_ATTENDANCE_CSV_EXPORT_FUNCTION_URL?.trim();
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
    return `https://${projectRef}.functions.supabase.co/${ATTENDANCE_CSV_EXPORT_FUNCTION_NAME}`;
  } catch {
    return null;
  }
}

function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeMonthInput(value: string): string {
  return value.replace(/[^0-9-]/g, "").slice(0, 7);
}

function saveCsvInBrowser(fileName: string, csvText: string): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") {
    return false;
  }

  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(href);
  return true;
}

export function AttendanceWorkspaceScreen({
  canWriteAttendance,
  canViewAttendanceSummary,
  onOpenAttendanceManager,
  onOpenAttendanceSummary,
}: AttendanceWorkspaceScreenProps) {
  const [monthInput, setMonthInput] = useState<string>(toMonthKey(new Date()));
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [csvExportMessage, setCsvExportMessage] = useState<string | null>(null);
  const [csvExportFiles, setCsvExportFiles] = useState<CsvExportItem[]>([]);

  async function handleCsvExport() {
    if (!canWriteAttendance) {
      return;
    }

    if (!supabaseAuthClient || !ATTENDANCE_CSV_EXPORT_FUNCTION_URL) {
      setCsvExportMessage(
        tr(
          "Eksport CSV nie jest skonfigurowany. Sprawdź EXPO_PUBLIC_SUPABASE_URL i deployment funkcji attendance_csv_export.",
          "CSV export is not configured. Check EXPO_PUBLIC_SUPABASE_URL and attendance_csv_export deployment.",
        ),
      );
      return;
    }

    setIsExportingCsv(true);
    setCsvExportMessage(null);
    setCsvExportFiles([]);

    try {
      const { data: sessionData, error: sessionError } = await supabaseAuthClient.auth.getSession();
      if (sessionError) {
        throw new Error(sessionError.message);
      }

      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error(
          tr(
            "Brak aktywnej sesji. Zaloguj się ponownie.",
            "Missing active session. Please sign in again.",
          ),
        );
      }

      const normalizedMonth = monthInput.trim();
      const payload: Record<string, unknown> = {};
      if (normalizedMonth.length > 0) {
        payload.month = normalizedMonth;
      }

      const response = await fetch(ATTENDANCE_CSV_EXPORT_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      let parsed: CsvExportResponse | null = null;
      try {
        parsed = (await response.json()) as CsvExportResponse;
      } catch {
        parsed = null;
      }

      if (!response.ok || !parsed || parsed.status !== "ok") {
        const apiMessage =
          parsed?.message ||
          parsed?.error ||
          tr("Nieznany błąd eksportu CSV.", "Unknown CSV export error.");
        throw new Error(apiMessage);
      }

      const exports = Array.isArray(parsed.exports) ? parsed.exports : [];
      setCsvExportFiles(exports);

      if (exports.length === 0) {
        setCsvExportMessage(
          parsed.message ||
            tr("Brak danych do eksportu dla wybranego zakresu.", "No data to export for selected range."),
        );
        return;
      }

      let downloaded = 0;
      for (const item of exports) {
        if (saveCsvInBrowser(item.file_name, item.csv)) {
          downloaded += 1;
        }
      }

      if (Platform.OS === "web") {
        setCsvExportMessage(
          tr(
            `Eksport gotowy. Pobrano ${downloaded}/${exports.length} plików CSV.`,
            `Export completed. Downloaded ${downloaded}/${exports.length} CSV files.`,
          ),
        );
      } else {
        setCsvExportMessage(
          tr(
            `Eksport gotowy (${exports.length} plików). Pobieranie działa w web.`,
            `Export completed (${exports.length} files). File download is available on web.`,
          ),
        );
      }
    } catch (error) {
      setCsvExportMessage(
        error instanceof Error
          ? error.message
          : tr("Nie udało się wykonać eksportu CSV.", "Could not run CSV export."),
      );
    } finally {
      setIsExportingCsv(false);
    }
  }

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
    >
      <SurfaceCard variant="default">
        <Text style={styles.cardEyebrow}>{tr("Obecność", "Attendance")}</Text>
        <Text style={styles.screenTitle}>
          {tr("Panel obecności i punktacji", "Attendance and points panel")}
        </Text>
      </SurfaceCard>

      {canWriteAttendance && onOpenAttendanceManager ? (
        <SurfaceCard variant="default">
          <Text style={styles.cardEyebrow}>{tr("Zarząd", "Board")}</Text>
          <Text style={styles.cardTitle}>
            {tr("Wpisywanie obecności", "Attendance write")}
          </Text>
          <Pressable style={styles.actionButton} onPress={onOpenAttendanceManager}>
            <Text style={styles.actionButtonLabel}>{tr("Otwórz", "Open")}</Text>
          </Pressable>
        </SurfaceCard>
      ) : null}

      {canViewAttendanceSummary && onOpenAttendanceSummary ? (
        <SurfaceCard variant="default">
          <Text style={styles.cardEyebrow}>{tr("Sekcyjni i zarząd", "Section and board")}</Text>
          <Text style={styles.cardTitle}>
            {tr("Podsumowanie obecności", "Attendance summary")}
          </Text>
          <Pressable style={styles.actionButton} onPress={onOpenAttendanceSummary}>
            <Text style={styles.actionButtonLabel}>{tr("Otwórz", "Open")}</Text>
          </Pressable>
        </SurfaceCard>
      ) : null}

      {canWriteAttendance ? (
        <SurfaceCard variant="default">
          <Text style={styles.cardEyebrow}>{tr("Eksport", "Export")}</Text>
          <Text style={styles.cardTitle}>{tr("Eksport obecności do CSV", "Attendance CSV export")}</Text>
          <Text style={styles.cardBody}>
            {tr(
              "Generuje pliki CSV per zakładka/miesiąc w formacie zgodnym z ref.",
              "Generates per-tab/month CSV files in ref-compatible format.",
            )}
          </Text>

          <View style={styles.exportControls}>
            <Text style={styles.inputLabel}>{tr("Miesiąc (YYYY-MM, opcjonalnie)", "Month (YYYY-MM, optional)")}</Text>
            <TextInput
              value={monthInput}
              onChangeText={(value) => {
                setMonthInput(normalizeMonthInput(value));
              }}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="2026-04"
              placeholderTextColor={tokens.colors.muted}
              style={styles.input}
            />
            <Text style={styles.inputHint}>
              {tr(
                "Puste pole = wszystkie dostępne zakładki.",
                "Empty value = all available tabs.",
              )}
            </Text>
          </View>

          <Pressable
            style={[styles.actionButton, isExportingCsv && styles.actionButtonDisabled]}
            disabled={isExportingCsv}
            onPress={() => {
              void handleCsvExport();
            }}
          >
            {isExportingCsv ? <ActivityIndicator color={tokens.colors.surface} size="small" /> : null}
            <Text style={styles.actionButtonLabel}>
              {isExportingCsv ? tr("Eksportowanie...", "Exporting...") : tr("Eksportuj CSV", "Export CSV")}
            </Text>
          </Pressable>

          {csvExportMessage ? (
            <Text style={styles.exportMessage}>{csvExportMessage}</Text>
          ) : null}

          {csvExportFiles.length > 0 ? (
            <View style={styles.exportFilesList}>
              {csvExportFiles.map((file) => (
                <View key={`${file.source_gid}:${file.file_name}`} style={styles.exportFileRow}>
                  <Text style={styles.exportFileName}>{file.file_name}</Text>
                  <Text style={styles.exportFileMeta}>
                    {tr("GID", "GID")}: {file.source_gid} | {tr("wydarzeń", "events")}: {file.events_count} |{" "}
                    {tr("wierszy", "rows")}: {file.member_rows_count}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </SurfaceCard>
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
  cardBody: {
    marginTop: tokens.spacing.sm,
    fontSize: tokens.typography.body,
    lineHeight: 23,
    color: tokens.colors.ink,
  },
  actionButton: {
    marginTop: tokens.spacing.md,
    alignSelf: "flex-start",
    minWidth: 170,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.spacing.xs,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.brand,
  },
  actionButtonDisabled: {
    opacity: 0.75,
  },
  actionButtonLabel: {
    color: tokens.colors.surface,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  exportControls: {
    marginTop: tokens.spacing.md,
    gap: tokens.spacing.xs,
  },
  inputLabel: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  input: {
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    backgroundColor: tokens.colors.surface,
    color: tokens.colors.ink,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.sm,
    fontSize: tokens.typography.body,
  },
  inputHint: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
  },
  exportMessage: {
    marginTop: tokens.spacing.sm,
    fontSize: tokens.typography.caption,
    color: tokens.colors.ink,
  },
  exportFilesList: {
    marginTop: tokens.spacing.sm,
    gap: tokens.spacing.xs,
  },
  exportFileRow: {
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.sm,
    backgroundColor: tokens.colors.surface,
  },
  exportFileName: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  exportFileMeta: {
    marginTop: 4,
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
  },
});
