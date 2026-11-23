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
import { CANONICAL_INSTRUMENT_OPTIONS, canonicalizeInstrumentLabel } from "../domain/instruments";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { SurfaceCard } from "../ui/SurfaceCard";
import { formatRelativeLabel } from "../utils/format";

type PanelTab = "assign" | "mapped" | "history";

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

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function InstrumentMappingScreen() {
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
        tr("Supabase Auth nie jest skonfigurowany.", "Supabase auth is not configured."),
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
        `Zapisano: ${member.fullName} → ${instrument}. Zmiana pojawi się w składach po najbliższej synchronizacji forum (do ok. 20 min).`,
        `Saved: ${member.fullName} → ${instrument}. It will show in squads after the next forum sync (within ~20 min).`,
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
      (mappings ?? []).filter((row) => {
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
      <View style={styles.optionsRow}>
        {CANONICAL_INSTRUMENT_OPTIONS.map((option) => {
          const isSelected = selectedCanonical === option;
          const isDisabled = isSaving || isSelected;

          return (
            <Pressable
              key={`${keyPrefix}-${option}`}
              style={[
                styles.optionButton,
                isSelected && styles.optionButtonSelected,
                isDisabled && styles.optionButtonDisabled,
              ]}
              disabled={isDisabled}
              onPress={() => onSelect(option)}
            >
              <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  function renderLoading(label: string) {
    return (
      <SurfaceCard variant="default">
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={tokens.colors.brand} />
          <Text style={styles.loadingText}>{label}</Text>
        </View>
      </SurfaceCard>
    );
  }

  function renderAssignTab() {
    if (isLoadingMembers) {
      return renderLoading(tr("Wczytuję listę...", "Loading list..."));
    }
    if (members.length === 0) {
      return (
        <SurfaceCard variant="default">
          <Text style={styles.cardBody}>
            {tr("Wszyscy mają przypisany instrument.", "Everyone has an instrument assigned.")}
          </Text>
        </SurfaceCard>
      );
    }

    return members.map((member) => (
      <SurfaceCard key={member.memberId} variant="default">
        <Text style={styles.memberName}>{member.fullName}</Text>
        {member.forumUid ? (
          <Text style={styles.memberMeta}>UID forum: {member.forumUid}</Text>
        ) : null}
        {member.pendingInstrument ? (
          <Text style={styles.pendingText}>
            {tr("Zapisano, czeka na synchronizację", "Saved, waiting for sync")}:{" "}
            {member.pendingInstrument}
          </Text>
        ) : null}
        {renderInstrumentOptions(member.memberId, member.pendingInstrument, (instrument) =>
          handleAssign(member, instrument),
        )}
      </SurfaceCard>
    ));
  }

  function renderMappedTab() {
    if (isLoadingMappings || mappings === null) {
      return renderLoading(tr("Wczytuję mapping...", "Loading mapping..."));
    }

    return (
      <>
        <SurfaceCard variant="muted">
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={tr("Szukaj po nazwisku, UID lub instrumencie", "Search by name, UID or instrument")}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.cardSecondary}>
            {tr("Wpisów", "Entries")}: {visibleMappings.length} / {mappings.length}
          </Text>
        </SurfaceCard>

        {visibleMappings.map((row) => {
          const rowKey = `${row.bucket}:${row.entryKey}`;
          const isExpanded = expandedMappingKey === rowKey;

          return (
            <SurfaceCard key={rowKey} variant="default">
              <Pressable onPress={() => setExpandedMappingKey(isExpanded ? null : rowKey)}>
                <Text style={styles.memberName}>{mappingDisplayName(row)}</Text>
                <Text style={styles.memberMeta}>
                  {row.instrument} · {row.bucket === "byUid" ? `UID ${row.entryKey}` : row.bucket}
                </Text>
                <Text style={styles.expandHint}>
                  {isExpanded ? tr("Zwiń", "Collapse") : tr("Zmień instrument", "Change instrument")}
                </Text>
              </Pressable>
              {isExpanded
                ? renderInstrumentOptions(rowKey, row.instrument, (instrument) =>
                    handleChange(row, instrument),
                  )
                : null}
            </SurfaceCard>
          );
        })}
      </>
    );
  }

  function renderHistoryTab() {
    if (isLoadingAudit || audit === null) {
      return renderLoading(tr("Wczytuję historię...", "Loading history..."));
    }
    if (audit.length === 0) {
      return (
        <SurfaceCard variant="default">
          <Text style={styles.cardBody}>
            {tr("Brak zmian zapisanych w panelu.", "No changes recorded through the panel yet.")}
          </Text>
        </SurfaceCard>
      );
    }

    return audit.map((entry, index) => (
      <SurfaceCard key={`${entry.changedAt}-${entry.entryKey}-${index}`} variant="default">
        <Text style={styles.memberName}>
          {entry.memberName ?? `UID ${entry.entryKey}`}
        </Text>
        <Text style={styles.memberMeta}>
          {entry.oldInstrument ?? "—"} → {entry.newInstrument}
        </Text>
        <Text style={styles.memberMeta}>
          {entry.changedByName ?? tr("nieznany użytkownik", "unknown user")}
          {entry.changedAt ? ` · ${formatRelativeLabel(entry.changedAt)}` : ""}
        </Text>
      </SurfaceCard>
    ));
  }

  const tabs: { key: PanelTab; label: string }[] = [
    { key: "assign", label: tr("Do przypisania", "To assign") },
    { key: "mapped", label: tr("Zmapowani", "Mapped") },
    { key: "history", label: tr("Historia", "History") },
  ];

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
    >
      <SurfaceCard variant="default">
        <Text style={styles.cardEyebrow}>{tr("Zarząd", "Board")}</Text>
        <Text style={styles.screenTitle}>{tr("Instrumenty z forum", "Forum instruments")}</Text>
        <Text style={styles.cardBody}>
          {tr(
            "Przypisuj instrumenty osobom z forum i poprawiaj istniejące wpisy. Każda zmiana trafia do historii.",
            "Assign instruments to forum members and fix existing entries. Every change is recorded in the history.",
          )}
        </Text>
        <Text style={styles.cardSecondary}>
          {tr("Do przypisania", "To assign")}: {waitingCount}
        </Text>
      </SurfaceCard>

      <View style={styles.tabRow}>
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              onPress={() => openTab(tab.key)}
              style={[styles.tabButton, isActive && styles.tabButtonActive]}
            >
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>

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

      {activeTab === "assign" ? renderAssignTab() : null}
      {activeTab === "mapped" ? renderMappedTab() : null}
      {activeTab === "history" ? renderHistoryTab() : null}
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
  tabRow: {
    flexDirection: "row",
    gap: tokens.spacing.xs,
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: tokens.spacing.sm,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.surfaceMuted,
  },
  tabButtonActive: {
    backgroundColor: tokens.colors.brand,
    borderColor: tokens.colors.brand,
  },
  tabLabel: {
    color: tokens.colors.ink,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
  },
  tabLabelActive: {
    color: tokens.colors.surface,
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
  memberName: {
    fontSize: tokens.typography.body,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  memberMeta: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
    lineHeight: 18,
  },
  expandHint: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.caption,
    color: tokens.colors.brand,
    fontWeight: "700",
  },
  pendingText: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.caption,
    color: tokens.colors.successInk,
    fontWeight: "700",
    lineHeight: 18,
  },
  optionsRow: {
    marginTop: tokens.spacing.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.xs,
  },
  optionButton: {
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.round,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: 6,
    backgroundColor: tokens.colors.surfaceMuted,
  },
  optionButtonSelected: {
    backgroundColor: tokens.colors.brand,
    borderColor: tokens.colors.brand,
  },
  optionButtonDisabled: {
    opacity: 0.55,
  },
  optionLabel: {
    color: tokens.colors.ink,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  optionLabelSelected: {
    color: tokens.colors.surface,
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
