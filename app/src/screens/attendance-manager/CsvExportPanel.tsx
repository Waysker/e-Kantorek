import { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { supabaseAuthClient } from "../../auth/supabaseAuthClient";
import { tr } from "../../i18n";
import { tokens } from "../../theme/tokens";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/TextField";
import { textStyles } from "../../theme/text";

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

// Attendance export to CSV (per sheet tab / month). Moved here from the old
// attendance hub screen; only people who can write attendance see it.
export function CsvExportPanel() {
  const [monthInput, setMonthInput] = useState<string>(toMonthKey(new Date()));
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [csvExportMessage, setCsvExportMessage] = useState<string | null>(null);
  const [csvExportFiles, setCsvExportFiles] = useState<CsvExportItem[]>([]);

  async function handleCsvExport() {
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
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>{tr("Eksport", "Export")}</Text>
          <Text style={styles.title}>{tr("Obecność do CSV", "Attendance to CSV")}</Text>
          <Text style={styles.hint}>
            {tr(
              "Pliki CSV dla każdej zakładki arkusza i miesiąca. Puste pole = wszystkie zakładki.",
              "CSV files per sheet tab and month. Empty field = all tabs.",
            )}
          </Text>
        </View>
      </View>
      <View style={styles.controls}>
        <TextField
          style={styles.monthField}
          value={monthInput}
          onChangeText={(value) => setMonthInput(normalizeMonthInput(value))}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="2026-04"
          accessibilityLabel={tr("Miesiąc (RRRR-MM)", "Month (YYYY-MM)")}
        />
        <Button
          variant="secondary"
          size="lg"
          label={isExportingCsv ? tr("Eksportowanie…", "Exporting…") : tr("Eksportuj CSV", "Export CSV")}
          loading={isExportingCsv}
          onPress={() => void handleCsvExport()}
        />
      </View>
      {csvExportMessage ? <Text style={styles.message}>{csvExportMessage}</Text> : null}
      {csvExportFiles.length > 0 ? (
        <View style={styles.files}>
          {csvExportFiles.map((file) => (
            <View key={`${file.source_gid}:${file.file_name}`} style={styles.fileRow}>
              <Text style={styles.fileName}>{file.file_name}</Text>
              <Text style={styles.fileMeta}>
                {tr("wydarzeń", "events")}: {file.events_count} · {tr("wierszy", "rows")}:{" "}
                {file.member_rows_count}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.colors.surface,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.lg,
    padding: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  kicker: textStyles.kicker,
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: tokens.colors.ink,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    color: tokens.colors.muted,
  },
  controls: {
    flexDirection: "row",
    gap: tokens.spacing.xs,
  },
  monthField: {
    flex: 1,
    minWidth: 0,
  },
  message: {
    fontSize: 13,
    color: tokens.colors.ink,
  },
  files: {
    gap: 6,
  },
  fileRow: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: tokens.colors.surfaceMuted,
  },
  fileName: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.colors.ink,
  },
  fileMeta: {
    fontSize: 12,
    color: tokens.colors.muted,
  },
});
