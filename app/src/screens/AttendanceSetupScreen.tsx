import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { UserProfile } from "../domain/models";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { SurfaceCard } from "../ui/SurfaceCard";

type AttendanceSetupScreenProps = {
  currentUser: UserProfile;
  onBack: () => void;
};

type SetupStep = {
  id: string;
  titlePl: string;
  titleEn: string;
  detailPl: string;
  detailEn: string;
};

const setupSteps: SetupStep[] = [
  {
    id: "secrets",
    titlePl: "Ustaw zmienne Supabase",
    titleEn: "Configure Supabase env vars",
    detailPl:
      "Uzupełnij EXPO_PUBLIC_SUPABASE_URL i EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY w .env / sekretach GitHub.",
    detailEn:
      "Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env / GitHub secrets.",
  },
  {
    id: "migrations",
    titlePl: "Uruchom migracje SQL",
    titleEn: "Apply SQL migrations",
    detailPl:
      "Wgraj migracje 010-013 i skonfiguruj funkcje zgodnie z docs/sheet-sync-setup.md.",
    detailEn:
      "Apply migrations 010-013 and configure functions from docs/sheet-sync-setup.md.",
  },
  {
    id: "preflight",
    titlePl: "Zrób preflight arkusza",
    titleEn: "Run sheet preflight",
    detailPl:
      "Uruchom attendance:preflight i napraw ewentualne błędy kontraktu danych.",
    detailEn:
      "Run attendance:preflight and fix any contract validation issues.",
  },
  {
    id: "sheetSync",
    titlePl: "Sprawdź sheet->Supabase sync",
    titleEn: "Validate sheet->Supabase sync",
    detailPl:
      "Uruchom ręcznie lub przez cron funkcję sheet_to_supabase_sync i sprawdź sync_runs.",
    detailEn:
      "Run sheet_to_supabase_sync manually or via cron and verify sync_runs.",
  },
  {
    id: "syncPublish",
    titlePl: "Sprawdź pełny pipeline",
    titleEn: "Validate full pipeline",
    detailPl:
      "Wykonaj forum:sync:publish i potwierdź, że profile/attendance ładują się z Supabase.",
    detailEn:
      "Run forum:sync:publish and confirm profile/attendance data is loaded from Supabase.",
  },
];

const runbookCommands = [
  "npm run attendance:preflight -- --sheet-id <id> --gid <gid> --strict",
  "supabase functions deploy sheet_to_supabase_sync --no-verify-jwt",
  "npm run forum:sync:publish",
] as const;

export function AttendanceSetupScreen({
  currentUser,
  onBack,
}: AttendanceSetupScreenProps) {
  const [completedMap, setCompletedMap] = useState<Record<string, boolean>>({});

  const completedCount = useMemo(
    () => setupSteps.filter((step) => completedMap[step.id]).length,
    [completedMap],
  );

  function toggleStep(stepId: string) {
    setCompletedMap((current) => ({
      ...current,
      [stepId]: !current[stepId],
    }));
  }

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
    >
      <Pressable onPress={onBack} style={styles.backLink}>
        <Text style={styles.backLinkLabel}>{tr("Wróć do profilu", "Back to profile")}</Text>
      </Pressable>

      <SurfaceCard variant="default">
        <Text style={styles.cardEyebrow}>{tr("Narzędzia lidera", "Leader tools")}</Text>
        <Text style={styles.screenTitle}>{tr("Konfiguracja obecności", "Attendance setup")}</Text>
        <Text style={styles.cardBody}>
          {tr(
            "To ekran operacyjny PoC: prowadzi przez walidację arkusza i synchronizację sheet->Supabase.",
            "This is a PoC operations screen: it guides sheet validation and sheet->Supabase sync.",
          )}
        </Text>
        <Text style={styles.cardSecondary}>
          {tr("Operator", "Operator")}: {currentUser.fullName}
        </Text>
        <Text style={styles.cardSecondary}>
          {tr("Rola", "Role")}: {currentUser.role}
        </Text>
      </SurfaceCard>

      <SurfaceCard variant="brandTint">
        <Text style={styles.cardEyebrow}>{tr("Postęp", "Progress")}</Text>
        <Text style={styles.progressLabel}>
          {completedCount}/{setupSteps.length} {tr("kroków ukończonych", "steps completed")}
        </Text>
      </SurfaceCard>

      <SurfaceCard variant="default">
        <Text style={styles.cardEyebrow}>{tr("Checklist", "Checklist")}</Text>
        <View style={styles.stepsList}>
          {setupSteps.map((step) => {
            const isDone = Boolean(completedMap[step.id]);
            return (
              <Pressable
                key={step.id}
                style={[styles.stepRow, isDone && styles.stepRowDone]}
                onPress={() => toggleStep(step.id)}
              >
                <View style={[styles.stepBullet, isDone && styles.stepBulletDone]}>
                  <Text style={styles.stepBulletLabel}>{isDone ? "✓" : ""}</Text>
                </View>
                <View style={styles.stepTextWrap}>
                  <Text style={styles.stepTitle}>{tr(step.titlePl, step.titleEn)}</Text>
                  <Text style={styles.stepDetail}>{tr(step.detailPl, step.detailEn)}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </SurfaceCard>

      <SurfaceCard variant="muted">
        <Text style={styles.cardEyebrow}>{tr("Runbook", "Runbook")}</Text>
        <Text style={styles.cardBody}>
          {tr(
            "Ta wersja PoC nie uruchamia skryptów bezpośrednio z UI. Użyj poniższych komend lokalnie w katalogu app.",
            "This PoC does not execute scripts directly from UI. Run these commands locally from the app directory.",
          )}
        </Text>
        <View style={styles.commandList}>
          {runbookCommands.map((command) => (
            <Text key={command} style={styles.commandText}>
              {command}
            </Text>
          ))}
        </View>
      </SurfaceCard>

      <SurfaceCard variant="outline">
        <Text style={styles.cardEyebrow}>{tr("Zakres PoC", "PoC scope")}</Text>
        <Text style={styles.cardBody}>
          {tr(
            "Docelowo ten ekran może dostać upload XLSX i publikację jednym kliknięciem, ale obecnie pełni rolę kontrolnej checklisty operacyjnej.",
            "Eventually this screen can include one-click XLSX upload and publish, but currently it acts as an operational control checklist.",
          )}
        </Text>
      </SurfaceCard>
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
  cardSecondary: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    color: tokens.colors.muted,
  },
  progressLabel: {
    fontSize: tokens.typography.body,
    color: tokens.colors.successInk,
    fontWeight: "700",
  },
  stepsList: {
    gap: tokens.spacing.sm,
  },
  stepRow: {
    flexDirection: "row",
    gap: tokens.spacing.sm,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    padding: tokens.spacing.md,
    backgroundColor: tokens.colors.surface,
  },
  stepRowDone: {
    backgroundColor: tokens.colors.successSurface,
    borderColor: tokens.colors.successInk,
  },
  stepBullet: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    backgroundColor: tokens.colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  stepBulletDone: {
    borderColor: tokens.colors.successInk,
    backgroundColor: tokens.colors.successInk,
  },
  stepBulletLabel: {
    color: tokens.colors.surface,
    fontWeight: "700",
  },
  stepTextWrap: {
    flex: 1,
  },
  stepTitle: {
    fontSize: tokens.typography.body,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  stepDetail: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    color: tokens.colors.muted,
  },
  commandList: {
    marginTop: tokens.spacing.sm,
    gap: tokens.spacing.xs,
  },
  commandText: {
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radii.md,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    backgroundColor: tokens.colors.surface,
    fontFamily: "monospace",
    color: tokens.colors.ink,
  },
});
