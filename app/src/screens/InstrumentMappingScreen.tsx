import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { supabaseAuthClient } from "../auth/supabaseAuthClient";
import { CANONICAL_INSTRUMENT_OPTIONS, canonicalizeInstrumentLabel } from "../domain/instruments";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { EmptyState } from "../ui/EmptyState";
import { Card, listRowDivider } from "../ui/Card";
import { TextField } from "../ui/TextField";
import { textStyles } from "../theme/text";
import { Chip } from "../ui/Chip";
import { Notice } from "../ui/Notice";
import { SegmentedControl } from "../ui/SegmentedControl";
import { formatRelativeLabel } from "../utils/format";
import { ForumAccountLinksPanel } from "./ForumAccountLinksPanel";

type PanelTab = "assign" | "mapped" | "history" | "accounts";

type UnmappedMemberRow = {
  memberId: string;
  fullName: string;
  forumUid: string | null;
  pendingInstrument: string | null;
};

type MappingRow = {
  bucket: string;
  entryKey: string;
  instrument: string;
  memberName: string | null;
};

type AuditRow = {
  changedAt: string;
  changedByName: string | null;
  action: string;
  memberName: string | null;
  entryKey: string;
  oldInstrument: string | null;
  newInstrument: string;
};

type RawRow = Record<string, unknown>;

function toText(value: unknown): string {
  return String(value ?? "").trim();
}

function mappingDisplayName(row: MappingRow): string {
  if (row.memberName) {
    return row.memberName;
  }
  return row.bucket === "byUid" ? `UID ${row.entryKey}` : row.entryKey;
}

// Sorted by surname (last word of the display name), like the other people lists.
function compareMappingsBySurname(left: MappingRow, right: MappingRow): number {
  const surname = (row: MappingRow) => {
    const parts = mappingDisplayName(row).trim().split(/\s+/);
    return parts[parts.length - 1] ?? "";
  };
  return (
    surname(left).localeCompare(surname(right), "pl") ||
    mappingDisplayName(left).localeCompare(mappingDisplayName(right), "pl")
  );
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

// Zarząd → Osoby z forum: instruments of forum people and links of app accounts to them.
export function InstrumentMappingScreen({ onAccountsChanged }: { onAccountsChanged?: () => void } = {}) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;
  const [activeTab, setActiveTab] = useState<PanelTab>("assign");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [members, setMembers] = useState<UnmappedMemberRow[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(true);

  const [mappings, setMappings] = useState<MappingRow[] | null>(null);
  const [isLoadingMappings, setIsLoadingMappings] = useState(false);
  const [expandedMappingKey, setExpandedMappingKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  function requireClient() {
    if (!supabaseAuthClient) {
      setErrorMessage(
        tr("Logowanie nie jest skonfigurowane w tej wersji aplikacji.", "Sign-in is not configured in this build."),
      );
      return null;
    }
    return supabaseAuthClient;
  }

  async function loadMembers() {
    const client = requireClient();
    if (!client) {
      setIsLoadingMembers(false);
      return;
    }

    setIsLoadingMembers(true);
    const { data, error } = await client.rpc("list_unmapped_forum_members");
    setIsLoadingMembers(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setMembers(
      (data ?? [])
        .map((row: unknown) => row as RawRow)
        .filter((row: RawRow) => toText(row.member_id).length > 0)
        .map((row: RawRow) => ({
          memberId: toText(row.member_id),
          fullName: toText(row.full_name) || tr("Nieznana osoba", "Unknown member"),
          forumUid: toText(row.forum_uid) || null,
          pendingInstrument: toText(row.pending_instrument) || null,
        })),
    );
  }

  async function loadMappings() {
    const client = requireClient();
    if (!client) {
      return;
    }

    setIsLoadingMappings(true);
    const { data, error } = await client.rpc("list_forum_instrument_mappings");
    setIsLoadingMappings(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setMappings(
      (data ?? []).map((row: unknown) => {
        const raw = row as RawRow;
        return {
          bucket: toText(raw.bucket),
          entryKey: toText(raw.entry_key),
          instrument: toText(raw.instrument),
          memberName: toText(raw.member_name) || null,
        };
      }),
    );
  }

  async function loadAudit() {
    const client = requireClient();
    if (!client) {
      return;
    }

    setIsLoadingAudit(true);
    const { data, error } = await client.rpc("list_forum_instrument_audit", { p_limit: 50 });
    setIsLoadingAudit(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setAudit(
      (data ?? []).map((row: unknown) => {
        const raw = row as RawRow;
        return {
          changedAt: toText(raw.changed_at),
          changedByName: toText(raw.changed_by_name) || null,
          action: toText(raw.action),
          memberName: toText(raw.member_name) || null,
          entryKey: toText(raw.entry_key),
          oldInstrument: toText(raw.old_instrument) || null,
          newInstrument: toText(raw.new_instrument),
        };
      }),
    );
  }

  useEffect(() => {
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openTab(tab: PanelTab) {
    setActiveTab(tab);
    setErrorMessage(null);
    setInfoMessage(null);
    if (tab === "mapped" && mappings === null) {
      loadMappings();
    }
    if (tab === "history") {
      loadAudit();
    }
  }

  async function handleAssign(member: UnmappedMemberRow, instrument: string) {
    const client = requireClient();
    if (!client) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setInfoMessage(null);
    const { error } = await client.rpc("set_forum_member_instrument", {
      p_member_id: member.memberId,
      p_instrument: instrument,
    });
    setIsSaving(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setMembers((current) =>
      current.map((row) =>
        row.memberId === member.memberId ? { ...row, pendingInstrument: instrument } : row,
      ),
    );
    // The mapped list and history are stale now.
    setMappings(null);
    setAudit(null);
    setInfoMessage(
      tr(
        `Zapisano: ${member.fullName} → ${instrument}.`,
        `Saved: ${member.fullName} → ${instrument}.`,
      ),
    );
  }

  async function handleChange(row: MappingRow, instrument: string) {
    const client = requireClient();
    if (!client) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setInfoMessage(null);
    const { error } = await client.rpc("change_forum_instrument_mapping", {
      p_bucket: row.bucket,
      p_key: row.entryKey,
      p_instrument: instrument,
    });
    setIsSaving(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setMappings((current) =>
      (current ?? []).map((item) =>
        item.bucket === row.bucket && item.entryKey === row.entryKey
          ? { ...item, instrument }
          : item,
      ),
    );
    setAudit(null);
    setExpandedMappingKey(null);
    setInfoMessage(
      tr(
        `Zmieniono: ${mappingDisplayName(row)} → ${instrument}. Zmiana pojawi się w składach po najbliższej synchronizacji forum (do ok. 20 min).`,
        `Changed: ${mappingDisplayName(row)} → ${instrument}. It will show in squads after the next forum sync (within ~20 min).`,
      ),
    );
  }

  const waitingCount = members.filter((member) => !member.pendingInstrument).length;
  const normalizedQuery = normalizeSearchText(query.trim());
  const visibleMappings = useMemo(
    () =>
      [...(mappings ?? [])].sort(compareMappingsBySurname).filter((row) => {
        if (!normalizedQuery) {
          return true;
        }
        return normalizeSearchText(
          `${mappingDisplayName(row)} ${row.entryKey} ${row.instrument}`,
        ).includes(normalizedQuery);
      }),
    [mappings, normalizedQuery],
  );

  function renderInstrumentOptions(
    keyPrefix: string,
    selectedInstrument: string | null,
    onSelect: (instrument: string) => void,
  ) {
    const selectedCanonical = selectedInstrument
      ? canonicalizeInstrumentLabel(selectedInstrument)
      : null;

    return (
      <View style={styles.optionsRow} accessibilityRole="radiogroup">
        {CANONICAL_INSTRUMENT_OPTIONS.map((option) => {
          const isSelected = selectedCanonical === option;
          return (
            <Chip
              key={`${keyPrefix}-${option}`}
              role="radio"
              label={option}
              selected={isSelected}
              disabled={isSaving}
              onPress={() => onSelect(option)}
            />
          );
        })}
      </View>
    );
  }

  function renderLoading(label: string) {
    return (
      <View style={styles.loadingRow}>
        <ActivityIndicator color={tokens.colors.brand} />
        <Text style={styles.muted}>{label}</Text>
      </View>
    );
  }

  function renderAssignTab() {
    if (isLoadingMembers) {
      return renderLoading(tr("Wczytuję listę…", "Loading list…"));
    }
    if (members.length === 0) {
      return (
        <EmptyState
          tone="done"
          title={tr("✓ Wszyscy mają przypisany instrument.", "✓ Everyone has an instrument.")}
        >
          {tr(
            "Nowe osoby z forum pojawią się tutaj po synchronizacji.",
            "New forum members will show up here after the next sync.",
          )}
        </EmptyState>
      );
    }

    return members.map((member) => (
      <View
        key={member.memberId}
        style={[styles.card, member.pendingInstrument ? styles.cardDone : styles.cardAction]}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderText}>
            <Text style={styles.name}>{member.fullName}</Text>
            {member.forumUid ? (
              <Text style={styles.meta}>{tr("UID na forum", "Forum UID")}: {member.forumUid}</Text>
            ) : null}
          </View>
          {member.pendingInstrument ? (
            <View style={[styles.pill, styles.pillDone]}>
              <Text style={[styles.pillLabel, styles.pillLabelDone]}>✓ {member.pendingInstrument}</Text>
            </View>
          ) : (
            <View style={[styles.pill, styles.pillAction]}>
              <Text style={[styles.pillLabel, styles.pillLabelAction]}>
                {tr("! Bez instrumentu", "! No instrument")}
              </Text>
            </View>
          )}
        </View>
        {member.pendingInstrument ? (
          <Text style={styles.meta}>
            {tr(
              "Zapisano. W składach pojawi się po synchronizacji forum (do ~20 min). Możesz jeszcze zmienić wybór.",
              "Saved. It shows in line-ups after the next forum sync (up to ~20 min). You can still change it.",
            )}
          </Text>
        ) : null}
        {renderInstrumentOptions(member.memberId, member.pendingInstrument, (instrument) =>
          handleAssign(member, instrument),
        )}
      </View>
    ));
  }

  function renderMappedTab() {
    if (isLoadingMappings || mappings === null) {
      return renderLoading(tr("Wczytuję przypisania…", "Loading assignments…"));
    }

    return (
      <>
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder={tr("Szukaj po nazwisku, UID lub instrumencie", "Search by name, UID or instrument")}
          accessibilityLabel={tr("Szukaj", "Search")}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.meta}>
          {visibleMappings.length === mappings.length
            ? tr(`${mappings.length} przypisań`, `${mappings.length} assignments`)
            : tr(
                `${visibleMappings.length} z ${mappings.length} przypisań`,
                `${visibleMappings.length} of ${mappings.length} assignments`,
              )}
        </Text>

        <Card variant="list">
          {visibleMappings.map((row, index) => {
            const rowKey = `${row.bucket}:${row.entryKey}`;
            const isExpanded = expandedMappingKey === rowKey;

            return (
              <View key={rowKey} style={[styles.listRow, index > 0 && listRowDivider]}>
                <Pressable
                  onPress={() => setExpandedMappingKey(isExpanded ? null : rowKey)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isExpanded }}
                  accessibilityHint={tr("Zmień instrument", "Change instrument")}
                  style={styles.listRowMain}
                >
                  <View style={styles.cardHeaderText}>
                    <Text style={styles.name}>{mappingDisplayName(row)}</Text>
                    <Text style={styles.meta}>
                      {row.bucket === "byUid"
                        ? `UID ${row.entryKey}`
                        : row.bucket === "byFullName"
                          ? tr("po imieniu i nazwisku", "by full name")
                          : tr("po nazwie użytkownika", "by username")}
                    </Text>
                  </View>
                  <View style={styles.pill}>
                    <Text style={styles.pillLabel}>{row.instrument}</Text>
                  </View>
                  <Text style={styles.changeLink}>
                    {isExpanded ? tr("Zwiń", "Close") : tr("Zmień", "Change")}
                  </Text>
                </Pressable>
                {isExpanded
                  ? renderInstrumentOptions(rowKey, row.instrument, (instrument) =>
                      handleChange(row, instrument),
                    )
                  : null}
              </View>
            );
          })}
        </Card>
      </>
    );
  }

  function renderHistoryTab() {
    if (isLoadingAudit || audit === null) {
      return renderLoading(tr("Wczytuję historię…", "Loading history…"));
    }
    if (audit.length === 0) {
      return (
        <EmptyState>
          {tr("Brak zmian zapisanych w panelu.", "No changes recorded through the panel yet.")}
        </EmptyState>
      );
    }

    return (
      <Card variant="list">
        {audit.map((entry, index) => (
          <View
            key={`${entry.changedAt}-${entry.entryKey}-${index}`}
            style={[styles.listRow, index > 0 && listRowDivider]}
          >
            <Text style={styles.name}>{entry.memberName ?? `UID ${entry.entryKey}`}</Text>
            <Text style={styles.change}>
              {entry.oldInstrument ? (
                <Text style={styles.changeOld}>{entry.oldInstrument}</Text>
              ) : (
                <Text style={styles.meta}>{tr("bez instrumentu", "no instrument")}</Text>
              )}
              <Text style={styles.meta}>{"  →  "}</Text>
              <Text style={styles.changeNew}>{entry.newInstrument}</Text>
            </Text>
            <Text style={styles.meta}>
              {entry.changedByName ?? tr("nieznany użytkownik", "unknown user")}
              {entry.changedAt ? ` · ${formatRelativeLabel(entry.changedAt)}` : ""}
            </Text>
          </View>
        ))}
      </Card>
    );
  }

  const tabs: { key: PanelTab; label: string }[] = [
    {
      key: "assign",
      label: waitingCount > 0 ? tr(`Do przypisania · ${waitingCount}`, `To assign · ${waitingCount}`) : tr("Do przypisania", "To assign"),
    },
    { key: "mapped", label: tr("Przypisani", "Assigned") },
    { key: "history", label: tr("Historia", "History") },
    { key: "accounts", label: tr("Konta", "Accounts") },
  ];

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={[styles.content, isDesktop && styles.contentDesktop]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.kicker}>{tr("Osoby z forum", "Forum people")}</Text>
        <Text style={styles.title}>
          {isLoadingMembers
            ? tr("Osoby z forum", "Forum people")
            : waitingCount > 0
              ? tr(
                  `${waitingCount} ${polishPeopleWithout(waitingCount)} instrumentu`,
                  `${waitingCount} without an instrument`,
                )
              : tr("Osoby z forum", "Forum people")}
        </Text>
      </View>

      <SegmentedControl options={tabs} value={activeTab} onChange={openTab} />

      {errorMessage ? <Notice tone="error">{errorMessage}</Notice> : null}
      {infoMessage ? <Notice tone="success">{infoMessage}</Notice> : null}

      {activeTab === "assign" ? renderAssignTab() : null}
      {activeTab === "mapped" ? renderMappedTab() : null}
      {activeTab === "history" ? renderHistoryTab() : null}
      {activeTab === "accounts" ? <ForumAccountLinksPanel onChanged={onAccountsChanged} /> : null}
    </ScrollView>
  );
}

// "1 osoba bez", "3 osoby bez", "5 osób bez" (Polish plural rules).
function polishPeopleWithout(count: number) {
  if (count === 1) {
    return "osoba bez";
  }
  const lastDigit = count % 10;
  const lastTwo = count % 100;
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return "osoby bez";
  }
  return "osób bez";
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
    maxWidth: 960,
    alignSelf: "center",
    paddingHorizontal: tokens.spacing.xl,
    paddingTop: tokens.spacing.lg,
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
    color: tokens.colors.muted,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
    paddingVertical: tokens.spacing.md,
  },
  card: {
    backgroundColor: tokens.colors.surface,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.lg,
    padding: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  cardAction: {
    borderColor: tokens.colors.warningBorder,
    borderWidth: 1.5,
  },
  cardDone: {
    borderColor: tokens.colors.successSurface,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tokens.spacing.sm,
  },
  cardHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    color: tokens.colors.ink,
  },
  meta: {
    fontSize: 13,
    color: tokens.colors.muted,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  pillLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.colors.neutralInk,
  },
  pillAction: {
    backgroundColor: tokens.colors.warningSurface,
    borderColor: tokens.colors.warningBorder,
  },
  pillLabelAction: {
    color: tokens.colors.warningInk,
  },
  pillDone: {
    backgroundColor: tokens.colors.successSurface,
  },
  pillLabelDone: {
    color: tokens.colors.successInk,
  },
  optionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  listRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  listRowMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
  },
  changeLink: {
    minWidth: 44,
    textAlign: "right",
    fontSize: 14,
    fontWeight: "600",
    color: tokens.colors.brand,
  },
  change: {
    fontSize: 14,
  },
  changeOld: {
    fontSize: 14,
    color: tokens.colors.muted,
    textDecorationLine: "line-through",
  },
  changeNew: {
    fontSize: 14,
    fontWeight: "700",
    color: tokens.colors.successInk,
  },
});
