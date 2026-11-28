import { useCallback, useEffect, useState } from "react";
import { Linking, Text, View } from "react-native";

import { supabaseAuthClient } from "../../auth/supabaseAuthClient";
import { tr } from "../../i18n";
import { textStyles } from "../../theme/text";
import { colors, themedStyles } from "../../theme/theme";
import { tokens } from "../../theme/tokens";
import { Button } from "../../ui/Button";
import { listRowStyles } from "../../ui/Card";
import { formatDateLabel, formatRelativeLabel } from "../../utils/format";

// Lets the board check app-entered attendance against the sheets by hand
// (docs/reference/attendance-model.md, step 7): open the original and the copy
// side by side, and see whether each recent save reached the copy.

type RecentSave = {
  saved_at: string;
  event_id: string;
  event_title: string | null;
  event_date: string | null;
  changed_count: number;
  saved_by: string | null;
  /** null: saved before the export result was recorded. */
  export_triggered: boolean | null;
  export_ok: boolean | null;
  export_missing_rows: number | null;
};

type Overview = {
  original_sheet_id: string | null;
  copy_sheet_id: string | null;
  recent_saves: RecentSave[];
};

type SheetCheckPanelProps = {
  /** Changes after every save so the list refreshes. */
  refreshKey?: number;
};

function sheetUrl(sheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/edit`;
}

// "1 osoba", "3 osoby", "5 osób" (Polish plural rules).
function polishPeople(count: number): string {
  if (count === 1) {
    return "1 osoba";
  }
  const lastDigit = count % 10;
  const lastTwo = count % 100;
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return `${count} osoby`;
  }
  return `${count} osób`;
}

function exportStatus(save: RecentSave): { glyph: string; label: string; color: string } {
  if (save.export_triggered == null) {
    return {
      glyph: "–",
      label: tr("Brak informacji o kopii", "Copy status unknown"),
      color: colors.neutralInk,
    };
  }
  if (!save.export_triggered) {
    return {
      glyph: "–",
      label: tr("Bez kopii arkusza", "No copy sheet"),
      color: colors.neutralInk,
    };
  }
  if (save.export_ok !== true) {
    return {
      glyph: "✕",
      label: tr("Nie trafiło do kopii", "Not in the copy"),
      color: colors.dangerInk,
    };
  }
  const missing = save.export_missing_rows ?? 0;
  if (missing > 0) {
    return {
      glyph: "✕",
      label: tr(`${polishPeople(missing)} poza kopią`, `${missing} not in the copy`),
      color: colors.dangerInk,
    };
  }
  return {
    glyph: "✓",
    label: tr("W kopii arkusza", "In the copy"),
    color: colors.successInk,
  };
}

export function SheetCheckPanel({ refreshKey }: SheetCheckPanelProps) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [hasError, setHasError] = useState(false);

  const load = useCallback(async () => {
    if (!supabaseAuthClient) {
      return;
    }
    const { data, error } = await supabaseAuthClient.rpc("attendance_board_overview", { p_limit: 8 });
    if (error || !data) {
      setHasError(true);
      return;
    }
    setHasError(false);
    setOverview(data as Overview);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const saves = overview?.recent_saves ?? [];

  return (
    <View style={styles.card}>
      <View style={styles.headerText}>
        <Text style={styles.kicker}>{tr("Sprawdzanie", "Checking")}</Text>
        <Text style={styles.title}>{tr("Porównanie z arkuszami", "Compare with the sheets")}</Text>
      </View>

      {overview?.original_sheet_id || overview?.copy_sheet_id ? (
        <View style={styles.links}>
          {overview?.original_sheet_id ? (
            <Button
              variant="secondary"
              label={tr("Oryginał", "Original")}
              trailingIcon="external"
              accessibilityRole="link"
              onPress={() => void Linking.openURL(sheetUrl(overview.original_sheet_id as string))}
            />
          ) : null}
          {overview?.copy_sheet_id ? (
            <Button
              variant="secondary"
              label={tr("Kopia z aplikacji", "App copy")}
              trailingIcon="external"
              accessibilityRole="link"
              onPress={() => void Linking.openURL(sheetUrl(overview.copy_sheet_id as string))}
            />
          ) : null}
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>{tr("Ostatnie zapisy", "Recent saves")}</Text>
      {hasError ? (
        <Text style={styles.hint}>{tr("Nie udało się wczytać ostatnich zapisów.", "Could not load recent saves.")}</Text>
      ) : saves.length === 0 ? (
        <Text style={styles.hint}>{tr("Jeszcze nic nie zapisano w aplikacji.", "Nothing saved in the app yet.")}</Text>
      ) : (
        <View>
          {saves.map((save, index) => {
            const status = exportStatus(save);
            const eventLabel = [
              save.event_title ?? tr("Wydarzenie", "Event"),
              save.event_date ? formatDateLabel(`${save.event_date}T12:00:00`) : null,
            ].filter(Boolean).join(" · ");
            const meta = [
              polishPeople(save.changed_count),
              save.saved_by,
              formatRelativeLabel(save.saved_at),
            ].filter(Boolean).join(" · ");
            return (
              <View key={`${save.saved_at}:${save.event_id}`} style={[styles.row, index > 0 && listRowStyles.divider]}>
                <Text style={styles.rowTitle}>{eventLabel}</Text>
                <Text style={styles.meta}>{meta}</Text>
                <Text style={[styles.status, { color: status.color }]}>
                  {status.glyph} {status.label}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = themedStyles((colors) => ({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: tokens.radii.lg,
    padding: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  headerText: {
    gap: 2,
  },
  kicker: textStyles.kicker,
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.ink,
  },
  links: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.xs,
  },
  sectionLabel: {
    ...textStyles.kicker,
    marginTop: tokens.spacing.xs,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
  },
  row: {
    paddingVertical: 8,
    gap: 2,
  },
  rowTitle: textStyles.rowTitle,
  meta: textStyles.meta,
  status: {
    fontSize: 13,
    fontWeight: "600",
  },
}));
