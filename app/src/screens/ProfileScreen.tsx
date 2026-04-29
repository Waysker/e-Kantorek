import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import type { UserProfile } from "../domain/models";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { SurfaceCard } from "../ui/SurfaceCard";
import { formatDateLabel, formatRelativeLabel } from "../utils/format";

function formatRoleLabel(role: UserProfile["role"]) {
  if (role === "admin") {
    return tr("Administrator", "Admin");
  }
  if (role === "board") {
    return tr("Zarząd", "Board");
  }
  if (role === "section") {
    return tr("Sekcyjne", "Section leader");
  }
  return tr("Członek", "Member");
}

function formatDataSourceLabel(label: string) {
  if (label === "Supabase cloud") {
    return tr("Supabase (chmura)", "Supabase cloud");
  }
  if (label === "Local fallback") {
    return tr("Lokalny fallback", "Local fallback");
  }
  if (label === "Supabase cloud (pending)") {
    return tr("Supabase (oczekiwanie)", "Supabase cloud (pending)");
  }
  if (label === "Local snapshot") {
    return tr("Lokalny snapshot", "Local snapshot");
  }
  return label;
}

export function ProfileScreen({
  currentUser,
  dataSourceLabel,
  dataSourceGeneratedAt,
  signedInEmail,
  onSignOut,
}: {
  currentUser: UserProfile;
  dataSourceLabel: string;
  dataSourceGeneratedAt: string | null;
  signedInEmail?: string | null;
  onSignOut?: () => Promise<void>;
}) {
  const freshnessLabel = dataSourceGeneratedAt
    ? `${formatDateLabel(dataSourceGeneratedAt)} (${formatRelativeLabel(dataSourceGeneratedAt)})`
    : tr("Nieznane", "Unknown");

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
    >
      <SurfaceCard variant="default">
        <Text style={styles.cardEyebrow}>{tr("Profil", "Profile")}</Text>
        <Text style={styles.screenTitle}>{currentUser.fullName}</Text>
        <Text style={styles.cardSecondary}>
          {tr("Rola", "Role")}: {formatRoleLabel(currentUser.role)}
        </Text>
        <Text style={styles.cardBody}>
          {tr("Instrument główny", "Primary instrument")}:{" "}
          {currentUser.primaryInstrument ?? tr("Nieprzypisany", "Unassigned")}
        </Text>
        {signedInEmail ? (
          <Text style={styles.cardSecondary}>
            {tr("Zalogowano jako", "Signed in as")}: {signedInEmail}
          </Text>
        ) : null}
        <Text style={styles.cardSecondary}>
          {tr("Źródło danych", "Data source")}: {formatDataSourceLabel(dataSourceLabel)}
        </Text>
        <Text style={styles.cardSecondary}>
          {tr("Ostatnia synchronizacja", "Last synced")}: {freshnessLabel}
        </Text>
        {onSignOut ? (
          <Pressable style={styles.signOutButton} onPress={onSignOut}>
            <Text style={styles.signOutLabel}>{tr("Wyloguj", "Sign out")}</Text>
          </Pressable>
        ) : null}
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
  cardBody: {
    marginTop: tokens.spacing.sm,
    fontSize: tokens.typography.body,
    lineHeight: 23,
    color: tokens.colors.ink,
  },
  signOutButton: {
    marginTop: tokens.spacing.md,
    alignSelf: "flex-start",
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: tokens.colors.border,
  },
  signOutLabel: {
    color: tokens.colors.ink,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
});
