import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import { supabaseAuthClient } from "../auth/supabaseAuthClient";
import type { PrimaryRole } from "../domain/models";
import { normalizePrimaryRole, PRIMARY_ROLE_SEQUENCE } from "../domain/roles";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { formatRelativeLabel } from "../utils/format";

type RoleManagementScreenProps = {
  currentUserId: string;
  onBack?: () => void;
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

type RoleFilter = PrimaryRole | "all";

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
    return tr("Sekcyjny", "Section leader");
  }
  return tr("Członek", "Member");
}

// Short labels for the compact role switch.
function formatRoleShortLabel(role: PrimaryRole): string {
  if (role === "admin") {
    return tr("Admin", "Admin");
  }
  return formatRoleLabel(role);
}

// "1 konto", "2 konta", "5 kont" (Polish plural rules).
function polishAccounts(count: number) {
  if (count === 1) {
    return "konto";
  }
  const lastDigit = count % 10;
  const lastTwo = count % 100;
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return "konta";
  }
  return "kont";
}

function formatRoleFilterLabel(role: RoleFilter): string {
  if (role === "all") {
    return tr("Wszyscy", "Everyone");
  }
  if (role === "admin") {
    return tr("Administratorzy", "Admins");
  }
  if (role === "board") {
    return tr("Zarząd", "Board");
  }
  if (role === "section") {
    return tr("Sekcyjni", "Section leaders");
  }
  return tr("Członkowie", "Members");
}

function surnameKey(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] ?? fullName;
}

// Sorted by surname, like the other people lists in the app.
function compareProfiles(left: ProfileRoleRow, right: ProfileRoleRow): number {
  return (
    surnameKey(left.full_name).localeCompare(surnameKey(right.full_name), "pl", { sensitivity: "base" }) ||
    left.full_name.localeCompare(right.full_name, "pl", { sensitivity: "base" })
  );
}

export function RoleManagementScreen({ currentUserId, onBack }: RoleManagementScreenProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= 760;
  const isDesktop = width >= tokens.breakpoints.desktop;
  const [profiles, setProfiles] = useState<ProfileRoleRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  async function loadProfiles() {
    if (!supabaseAuthClient) {
      setIsLoading(false);
      setErrorMessage(
        tr("Logowanie nie jest skonfigurowane w tej wersji aplikacji.", "Sign-in is not configured in this build."),
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
        instrument: normalizeWhitespace(row.instrument),
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
        tr("Logowanie nie jest skonfigurowane w tej wersji aplikacji.", "Sign-in is not configured in this build."),
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
    const changedProfile = profiles.find((profile) => profile.id === profileId);

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
    setInfoMessage(
      changedProfile
        ? tr(
            `${changedProfile.full_name}: rola zmieniona na „${formatRoleLabel(resolvedRole)}”.`,
            `${changedProfile.full_name}: role changed to "${formatRoleLabel(resolvedRole)}".`,
          )
        : tr("Rola została zaktualizowana.", "Role updated."),
    );
  }

  const roleCounts = useMemo(() => {
    const counts: Record<RoleFilter, number> = {
      all: profiles.length,
      admin: 0,
      board: 0,
      section: 0,
      member: 0,
    };
    for (const profile of profiles) {
      counts[profile.role] += 1;
    }
    return counts;
  }, [profiles]);

  const normalizedQuery = normalizeSearchText(query);
  const visibleProfiles = useMemo(
    () =>
      profiles.filter((profile) => {
        if (roleFilter !== "all" && profile.role !== roleFilter) {
          return false;
        }
        if (!normalizedQuery) {
          return true;
        }
        const haystack = normalizeSearchText(
          `${profile.full_name} ${profile.instrument} ${profile.role} ${formatRoleLabel(profile.role)}`,
        );
        return haystack.includes(normalizedQuery);
      }),
    [normalizedQuery, profiles, roleFilter],
  );

  const filterOptions: RoleFilter[] = ["all", ...[...PRIMARY_ROLE_SEQUENCE].reverse()];

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={[styles.content, isDesktop && styles.contentDesktop]}
      showsVerticalScrollIndicator={false}
    >
      {onBack ? (
        <Pressable onPress={onBack} style={styles.backLink} accessibilityRole="button">
          <Text style={styles.backLinkLabel}>{tr("‹ Wróć", "‹ Back")}</Text>
        </Pressable>
      ) : null}

      <View style={styles.header}>
        <Text style={styles.kicker}>{tr("Role i uprawnienia", "Roles and permissions")}</Text>
        <Text style={styles.title}>
          {tr(`${profiles.length} ${polishAccounts(profiles.length)}`, `${profiles.length} accounts`)}
        </Text>
        <Text style={styles.muted}>
          {tr(
            "Sekcyjni widzą podsumowanie obecności, zarząd wpisuje obecność i przypisuje instrumenty, administratorzy nadają role. Zmiany zapisują się od razu.",
            "Section leaders see the attendance summary, the board enters attendance and assigns instruments, admins manage roles. Changes save immediately.",
          )}
        </Text>
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={tr("Szukaj po nazwisku, instrumencie lub roli", "Search by name, instrument or role")}
        placeholderTextColor={tokens.colors.muted}
        accessibilityLabel={tr("Szukaj", "Search")}
        style={styles.searchInput}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={styles.chips}>
        {filterOptions.map((option) => {
          const isActive = roleFilter === option;
          return (
            <Pressable
              key={option}
              onPress={() => setRoleFilter(option)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              style={[styles.chip, isActive && styles.chipActive]}
            >
              <Text style={[styles.chipLabel, isActive && styles.chipLabelActive]}>
                {formatRoleFilterLabel(option)} · {roleCounts[option]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {errorMessage ? <Text style={[styles.notice, styles.noticeError]}>{errorMessage}</Text> : null}
      {infoMessage ? <Text style={[styles.notice, styles.noticeSuccess]}>{infoMessage}</Text> : null}

      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={tokens.colors.brand} />
          <Text style={styles.muted}>{tr("Wczytuję konta…", "Loading accounts…")}</Text>
        </View>
      ) : visibleProfiles.length === 0 ? (
        <Text style={styles.muted}>{tr("Nikogo nie znaleziono.", "Nobody found.")}</Text>
      ) : (
        <View style={styles.list}>
          {visibleProfiles.map((profile, index) => {
            const isSavingCurrent = savingProfileId === profile.id;
            const isSelf = profile.id === currentUserId;

            return (
              <View
                key={profile.id}
                style={[styles.row, isWide && styles.rowWide, index > 0 && styles.rowDivider]}
              >
                <View style={styles.person}>
                  <Text style={styles.name}>
                    {profile.full_name}
                    {isSelf ? <Text style={styles.selfTag}>{tr("  (Ty)", "  (you)")}</Text> : null}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {profile.instrument || tr("Bez instrumentu", "No instrument")}
                    {profile.updated_at
                      ? ` · ${tr("zmiana", "changed")} ${formatRelativeLabel(profile.updated_at)}`
                      : ""}
                  </Text>
                  {isSelf ? (
                    <Text style={styles.meta}>
                      {tr("Własnej roli administratora nie zmienisz tutaj.", "You can't change your own admin role here.")}
                    </Text>
                  ) : null}
                </View>

                <View style={[styles.segmented, isWide && styles.segmentedWide]} accessibilityRole="radiogroup">
                  {PRIMARY_ROLE_SEQUENCE.map((roleOption) => {
                    const isSelected = profile.role === roleOption;
                    const isSelfDemotion = isSelf && roleOption !== "admin";
                    const isDisabled = Boolean(savingProfileId) || isSelected || isSelfDemotion;

                    return (
                      <Pressable
                        key={`${profile.id}-${roleOption}`}
                        style={[
                          styles.segment,
                          isSelected && styles.segmentSelected,
                          isDisabled && !isSelected && styles.segmentDisabled,
                        ]}
                        disabled={isDisabled}
                        onPress={() => handleRoleChange(profile.id, roleOption)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: isSelected, disabled: isDisabled }}
                      >
                        {isSavingCurrent && isSelected ? (
                          <ActivityIndicator size="small" color={tokens.colors.surface} />
                        ) : (
                          <Text
                            style={[styles.segmentLabel, isSelected && styles.segmentLabelSelected]}
                            numberOfLines={1}
                          >
                            {formatRoleShortLabel(roleOption)}
                          </Text>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screenScroll: {
    flex: 1,
  },
  content: {
    padding: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  contentDesktop: {
    width: "100%",
    maxWidth: 1080,
    alignSelf: "center",
    paddingHorizontal: tokens.spacing.xl,
    paddingTop: tokens.spacing.lg,
  },
  backLink: {
    alignSelf: "flex-start",
    minHeight: 32,
    justifyContent: "center",
  },
  backLinkLabel: {
    color: tokens.colors.brand,
    fontWeight: "600",
  },
  header: {
    gap: 4,
    paddingBottom: tokens.spacing.xs,
  },
  kicker: {
    fontSize: tokens.typography.caption,
    fontWeight: "600",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: tokens.colors.muted,
  },
  title: {
    fontSize: 26,
    lineHeight: 31,
    fontWeight: "800",
    letterSpacing: -0.4,
    color: tokens.colors.ink,
  },
  muted: {
    fontSize: 14,
    lineHeight: 20,
    color: tokens.colors.muted,
  },
  searchInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: tokens.colors.borderStrong,
    backgroundColor: tokens.colors.surface,
    color: tokens.colors.ink,
    paddingHorizontal: 14,
    borderRadius: tokens.radii.md,
    fontSize: 15,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: tokens.radii.round,
    borderWidth: 1,
    borderColor: tokens.colors.borderStrong,
    backgroundColor: tokens.colors.surface,
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: tokens.colors.brand,
    borderColor: tokens.colors.brand,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.colors.ink,
  },
  chipLabelActive: {
    color: tokens.colors.surface,
  },
  notice: {
    fontSize: 14,
    lineHeight: 20,
    borderRadius: tokens.radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    overflow: "hidden",
  },
  noticeError: {
    backgroundColor: tokens.colors.dangerSurface,
    color: tokens.colors.dangerInk,
  },
  noticeSuccess: {
    backgroundColor: tokens.colors.successSurface,
    color: tokens.colors.successInk,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
    paddingVertical: tokens.spacing.md,
  },
  list: {
    backgroundColor: tokens.colors.surface,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.lg,
    overflow: "hidden",
  },
  row: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  rowWide: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.md,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: tokens.colors.surfaceMuted,
  },
  person: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    color: tokens.colors.ink,
  },
  selfTag: {
    fontSize: 13,
    fontWeight: "500",
    color: tokens.colors.muted,
  },
  meta: {
    fontSize: 13,
    color: tokens.colors.muted,
  },
  segmented: {
    flexDirection: "row",
    gap: 3,
    padding: 3,
    borderRadius: tokens.radii.md,
    backgroundColor: tokens.colors.surfaceMuted,
  },
  segmentedWide: {
    width: 380,
  },
  segment: {
    flex: 1,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentSelected: {
    backgroundColor: tokens.colors.brand,
  },
  segmentDisabled: {
    opacity: 0.45,
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.colors.neutralInk,
  },
  segmentLabelSelected: {
    color: tokens.colors.surface,
  },
});
