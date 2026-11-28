import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { supabaseAuthClient } from "../auth/supabaseAuthClient";
import type { PrimaryRole } from "../domain/models";
import { normalizePrimaryRole, PRIMARY_ROLE_SEQUENCE } from "../domain/roles";
import { tr } from "../i18n";
import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";
import { Card, listRowStyles } from "../ui/Card";
import { TextField } from "../ui/TextField";
import { textStyles } from "../theme/text";
import { Chip } from "../ui/Chip";
import { Notice } from "../ui/Notice";
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
  created_at?: string;
  updated_at?: string;
  /** Missing on databases before migration 033: treated as confirmed. */
  email_confirmed?: boolean;
};

type UnconfirmedProfileRow = {
  id: string;
  full_name: string;
  instrument: string;
  created_at: string;
};

const CREATED_DATE = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "numeric", timeZone: "Europe/Warsaw" });

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
  const [unconfirmedProfiles, setUnconfirmedProfiles] = useState<UnconfirmedProfileRow[]>([]);
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

    const rawRows = (data ?? [])
      .map((row: unknown) => row as RawProfileRoleRow)
      .filter((row: RawProfileRoleRow) => normalizeWhitespace(row.id).length > 0);
    // An account without a confirmed e-mail cannot sign in: keep it apart.
    setUnconfirmedProfiles(
      rawRows
        .filter((row: RawProfileRoleRow) => row.email_confirmed === false)
        .map((row: RawProfileRoleRow) => ({
          id: normalizeWhitespace(row.id),
          full_name: normalizeWhitespace(row.full_name) || tr("Nieznany użytkownik", "Unknown user"),
          instrument: normalizeWhitespace(row.instrument),
          created_at: normalizeWhitespace(row.created_at),
        })),
    );
    const normalizedRows = rawRows
      .filter((row: RawProfileRoleRow) => row.email_confirmed !== false)
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

      <TextField
        value={query}
        onChangeText={setQuery}
        placeholder={tr("Szukaj po nazwisku, instrumencie lub roli", "Search by name, instrument or role")}
        accessibilityLabel={tr("Szukaj", "Search")}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={styles.chips}>
        {filterOptions.map((option) => (
          <Chip
            key={option}
            label={`${formatRoleFilterLabel(option)} · ${roleCounts[option]}`}
            selected={roleFilter === option}
            onPress={() => setRoleFilter(option)}
          />
        ))}
      </View>

      {errorMessage ? <Notice tone="error">{errorMessage}</Notice> : null}
      {infoMessage ? <Notice tone="success">{infoMessage}</Notice> : null}

      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.muted}>{tr("Wczytuję konta…", "Loading accounts…")}</Text>
        </View>
      ) : visibleProfiles.length === 0 ? (
        <Text style={styles.muted}>{tr("Nikogo nie znaleziono.", "Nobody found.")}</Text>
      ) : (
        <Card variant="list">
          {visibleProfiles.map((profile, index) => {
            const isSavingCurrent = savingProfileId === profile.id;
            const isSelf = profile.id === currentUserId;

            return (
              <View
                key={profile.id}
                style={[styles.row, isWide && styles.rowWide, index > 0 && listRowStyles.divider]}
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
                          <ActivityIndicator size="small" color={colors.onBrand} />
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
        </Card>
      )}

      {!isLoading && unconfirmedProfiles.length > 0 ? (
        <View style={styles.unconfirmedCard}>
          <Text style={styles.kicker}>
            {tr(
              `Niepotwierdzone konta (${unconfirmedProfiles.length})`,
              `Unconfirmed accounts (${unconfirmedProfiles.length})`,
            )}
          </Text>
          <Text style={styles.muted}>
            {tr(
              "Te osoby nie kliknęły linku z maila, więc nie mogą się zalogować.",
              "These people haven't clicked the e-mail link, so they can't sign in.",
            )}
          </Text>
          {unconfirmedProfiles.map((profile) => (
            <Text key={profile.id} style={styles.meta}>
              <Text style={styles.unconfirmedName}>{profile.full_name}</Text>
              {profile.instrument ? ` · ${profile.instrument}` : ""}
              {profile.created_at
                ? tr(
                    ` · założone ${CREATED_DATE.format(new Date(profile.created_at))}`,
                    ` · created ${CREATED_DATE.format(new Date(profile.created_at))}`,
                  )
                : ""}
            </Text>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = themedStyles((colors) => ({
  unconfirmedCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: tokens.radii.lg,
    padding: tokens.spacing.md,
    gap: 6,
  },
  unconfirmedName: {
    color: colors.ink,
    fontWeight: "600",
  },
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
    color: colors.brand,
    fontWeight: "600",
  },
  header: {
    gap: 4,
    paddingBottom: tokens.spacing.xs,
  },
  kicker: textStyles.kicker,
  title: textStyles.pageTitle,
  muted: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
    paddingVertical: tokens.spacing.md,
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
  person: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
  },
  selfTag: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.muted,
  },
  meta: {
    fontSize: 13,
    color: colors.muted,
  },
  segmented: {
    flexDirection: "row",
    gap: 3,
    padding: 3,
    borderRadius: tokens.radii.md,
    backgroundColor: colors.surfaceMuted,
  },
  segmentedWide: {
    width: 380,
  },
  segment: {
    flex: 1,
    minHeight: 36,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentSelected: {
    backgroundColor: colors.brand,
  },
  segmentDisabled: {
    opacity: 0.45,
  },
  segmentLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.neutralInk,
  },
  segmentLabelSelected: {
    color: colors.onBrand,
  },
}));
