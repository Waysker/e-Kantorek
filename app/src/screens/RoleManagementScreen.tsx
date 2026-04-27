import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { supabaseAuthClient } from "../auth/supabaseAuthClient";
import type { PrimaryRole } from "../domain/models";
import { normalizePrimaryRole, PRIMARY_ROLE_SEQUENCE } from "../domain/roles";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { SurfaceCard } from "../ui/SurfaceCard";
import { formatRelativeLabel } from "../utils/format";

type RoleManagementScreenProps = {
  currentUserId: string;
  onBack: () => void;
};

type ProfileRoleRow = {
  id: string;
  full_name: string;
  instrument: string;
  role: PrimaryRole;
  updated_at: string;
};

type RawProfileRoleRow = {
  id?: string;
  full_name?: string;
  instrument?: string;
  role?: string;
  updated_at?: string;
};

type RawRoleUpdateRow = {
  id?: string;
  role?: string;
  updated_at?: string;
};

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

function formatRoleLabel(role: PrimaryRole): string {
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

function compareProfiles(left: ProfileRoleRow, right: ProfileRoleRow): number {
  return left.full_name.localeCompare(right.full_name, "pl", { sensitivity: "base" });
}

export function RoleManagementScreen({ currentUserId, onBack }: RoleManagementScreenProps) {
  const [profiles, setProfiles] = useState<ProfileRoleRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  async function loadProfiles() {
    if (!supabaseAuthClient) {
      setIsLoading(false);
      setErrorMessage(
        tr("Supabase Auth nie jest skonfigurowany.", "Supabase auth is not configured."),
      );
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabaseAuthClient.rpc("list_profiles_for_role_admin");
    if (error) {
      setIsLoading(false);
      setErrorMessage(error.message);
      return;
    }

    const normalizedRows = (data ?? [])
      .map((row: unknown) => row as RawProfileRoleRow)
      .filter((row: RawProfileRoleRow) => normalizeWhitespace(row.id).length > 0)
      .map((row: RawProfileRoleRow) => ({
        id: normalizeWhitespace(row.id),
        full_name: normalizeWhitespace(row.full_name) || tr("Nieznany użytkownik", "Unknown user"),
        instrument: normalizeWhitespace(row.instrument) || tr("Brak", "Missing"),
        role: normalizePrimaryRole(row.role),
        updated_at: normalizeWhitespace(row.updated_at),
      }))
      .sort(compareProfiles);

    setProfiles(normalizedRows);
    setIsLoading(false);
  }

  useEffect(() => {
    loadProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRoleChange(profileId: string, nextRole: PrimaryRole) {
    if (!supabaseAuthClient) {
      setErrorMessage(
        tr("Supabase Auth nie jest skonfigurowany.", "Supabase auth is not configured."),
      );
      return;
    }

    setSavingProfileId(profileId);
    setErrorMessage(null);
    setInfoMessage(null);

    const { data, error } = await supabaseAuthClient.rpc("admin_set_profile_role", {
      p_target_profile_id: profileId,
      p_next_role: nextRole,
    });

    if (error) {
      setSavingProfileId(null);
      setErrorMessage(error.message);
      return;
    }

    const updatedRow = Array.isArray(data) && data.length > 0
      ? (data[0] as RawRoleUpdateRow)
      : null;
    const resolvedRole = normalizePrimaryRole(updatedRow?.role ?? nextRole);
    const resolvedUpdatedAt = normalizeWhitespace(updatedRow?.updated_at);

    setProfiles((current) =>
      current
        .map((profile) => {
          if (profile.id !== profileId) {
            return profile;
          }
          return {
            ...profile,
            role: resolvedRole,
            updated_at: resolvedUpdatedAt || profile.updated_at,
          };
        })
        .sort(compareProfiles)
    );

    setSavingProfileId(null);
    setInfoMessage(tr("Rola została zaktualizowana.", "Role updated."));
  }

  const normalizedQuery = normalizeSearchText(query);
  const visibleProfiles = useMemo(
    () =>
      profiles.filter((profile) => {
        if (!normalizedQuery) {
          return true;
        }

        const roleLabel = formatRoleLabel(profile.role);
        const haystack = normalizeSearchText(
          `${profile.full_name} ${profile.instrument} ${profile.role} ${roleLabel}`,
        );
        return haystack.includes(normalizedQuery);
      }),
    [normalizedQuery, profiles],
  );

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
    >
      <Pressable onPress={onBack} style={styles.backLink}>
        <Text style={styles.backLinkLabel}>
          {tr("← Wróć do profilu", "← Back to profile")}
        </Text>
      </Pressable>

      <SurfaceCard variant="default">
        <Text style={styles.cardEyebrow}>{tr("Admin", "Admin")}</Text>
        <Text style={styles.screenTitle}>{tr("Zarządzanie rolami", "Role management")}</Text>
        <Text style={styles.cardBody}>
          {tr(
            "Panel do nadawania ról member/section/board/admin. Zmiany zapisują się od razu.",
            "Panel for assigning member/section/board/admin roles. Changes are saved immediately.",
          )}
        </Text>
        <Text style={styles.cardSecondary}>
          {tr("Liczba użytkowników", "Users count")}: {profiles.length}
        </Text>
      </SurfaceCard>

      <SurfaceCard variant="muted">
        <Text style={styles.cardEyebrow}>{tr("Filtr", "Filter")}</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={tr("Szukaj po nazwisku, instrumencie lub roli", "Search by name, instrument or role")}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </SurfaceCard>

      {errorMessage ? (
        <SurfaceCard variant="outline">
          <Text style={styles.errorText}>{errorMessage}</Text>
        </SurfaceCard>
      ) : null}

      {infoMessage ? (
        <SurfaceCard variant="brandTint">
          <Text style={styles.infoText}>{infoMessage}</Text>
        </SurfaceCard>
      ) : null}

      {isLoading ? (
        <SurfaceCard variant="default">
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={tokens.colors.brand} />
            <Text style={styles.loadingText}>{tr("Wczytuję profile...", "Loading profiles...")}</Text>
          </View>
        </SurfaceCard>
      ) : (
        visibleProfiles.map((profile) => {
          const isSavingCurrent = savingProfileId === profile.id;
          const isSelf = profile.id === currentUserId;

          return (
            <SurfaceCard key={profile.id} variant="default">
              <Text style={styles.profileName}>{profile.full_name}</Text>
              <Text style={styles.profileMeta}>
                {tr("Instrument", "Instrument")}: {profile.instrument}
              </Text>
              <Text style={styles.profileMeta}>
                {tr("Aktualna rola", "Current role")}: {formatRoleLabel(profile.role)}
              </Text>
              {profile.updated_at ? (
                <Text style={styles.profileMeta}>
                  {tr("Ostatnia zmiana", "Last role change")}: {formatRelativeLabel(profile.updated_at)}
                </Text>
              ) : null}
              <View style={styles.roleActionsRow}>
                {PRIMARY_ROLE_SEQUENCE.map((roleOption) => {
                  const isSelected = profile.role === roleOption;
                  const isSelfDemotion = isSelf && roleOption !== "admin";
                  const isDisabled =
                    Boolean(savingProfileId) || isSelected || isSelfDemotion;

                  return (
                    <Pressable
                      key={`${profile.id}-${roleOption}`}
                      style={[
                        styles.roleButton,
                        isSelected && styles.roleButtonSelected,
                        isDisabled && styles.roleButtonDisabled,
                      ]}
                      disabled={isDisabled}
                      onPress={() => handleRoleChange(profile.id, roleOption)}
                    >
                      <Text
                        style={[
                          styles.roleButtonLabel,
                          isSelected && styles.roleButtonLabelSelected,
                        ]}
                      >
                        {formatRoleLabel(roleOption)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {isSelf ? (
                <Text style={styles.selfGuardNote}>
                  {tr(
                    "Nie możesz obniżyć własnej roli admin z tego panelu.",
                    "You cannot demote your own admin role from this panel.",
                  )}
                </Text>
              ) : null}
              {isSavingCurrent ? (
                <Text style={styles.savingLabel}>{tr("Zapisywanie...", "Saving...")}</Text>
              ) : null}
            </SurfaceCard>
          );
        })
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
  searchInput: {
    borderWidth: 1,
    borderColor: tokens.colors.border,
    backgroundColor: tokens.colors.surface,
    color: tokens.colors.ink,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radii.md,
    fontSize: tokens.typography.body,
  },
  loadingWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
  },
  loadingText: {
    color: tokens.colors.muted,
    fontSize: tokens.typography.body,
  },
  profileName: {
    fontSize: tokens.typography.body,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  profileMeta: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
    lineHeight: 18,
  },
  roleActionsRow: {
    marginTop: tokens.spacing.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.xs,
  },
  roleButton: {
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.round,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: 6,
    backgroundColor: tokens.colors.surfaceMuted,
  },
  roleButtonSelected: {
    backgroundColor: tokens.colors.brand,
    borderColor: tokens.colors.brand,
  },
  roleButtonDisabled: {
    opacity: 0.55,
  },
  roleButtonLabel: {
    color: tokens.colors.ink,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  roleButtonLabelSelected: {
    color: tokens.colors.surface,
  },
  selfGuardNote: {
    marginTop: tokens.spacing.sm,
    color: tokens.colors.muted,
    fontSize: tokens.typography.caption,
    lineHeight: 18,
  },
  savingLabel: {
    marginTop: tokens.spacing.sm,
    color: tokens.colors.brand,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
  },
  errorText: {
    color: tokens.colors.dangerInk,
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    fontWeight: "700",
  },
  infoText: {
    color: tokens.colors.successInk,
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    fontWeight: "700",
  },
});
