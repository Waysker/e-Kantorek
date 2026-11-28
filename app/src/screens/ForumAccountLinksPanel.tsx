import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { supabaseAuthClient } from "../auth/supabaseAuthClient";
import {
  compareBySurname,
  nameKey,
  parseForumPeople,
  suggestForumPerson,
  type ForumPerson,
} from "../domain/forumIdentity";
import { tr } from "../i18n";
import { textStyles } from "../theme/text";
import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";
import { Button } from "../ui/Button";
import { Card, listRowStyles } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { Notice } from "../ui/Notice";
import { TextField } from "../ui/TextField";
import { formatRelativeLabel } from "../utils/format";

type AccountLink = {
  profileId: string;
  fullName: string;
  instrument: string | null;
  forumUid: string | null;
  forumFullName: string | null;
  noForumAccount: boolean;
  status: "proposed" | "verified" | null;
};

type AuditEntry = {
  changedAt: string;
  changedByName: string | null;
  action: string;
  profileFullName: string | null;
  oldForumFullName: string | null;
  newForumFullName: string | null;
};

type RawRow = Record<string, unknown>;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function parseLinks(rows: unknown): AccountLink[] {
  return (Array.isArray(rows) ? rows : []).map((value) => {
    const row = value as RawRow;
    const status = row.status === "verified" ? "verified" : row.status === "proposed" ? "proposed" : null;
    return {
      profileId: text(row.profile_id),
      fullName: text(row.full_name),
      instrument: text(row.instrument) || null,
      forumUid: text(row.forum_uid) || null,
      forumFullName: text(row.forum_full_name) || null,
      noForumAccount: row.no_forum_account === true,
      status,
    };
  });
}

function parseAudit(rows: unknown): AuditEntry[] {
  return (Array.isArray(rows) ? rows : []).map((value) => {
    const row = value as RawRow;
    return {
      changedAt: text(row.changed_at),
      changedByName: text(row.changed_by_name) || null,
      action: text(row.action),
      profileFullName: text(row.profile_full_name) || null,
      oldForumFullName: text(row.old_forum_full_name) || null,
      newForumFullName: text(row.new_forum_full_name) || null,
    };
  });
}

function compareLinksBySurname(left: AccountLink, right: AccountLink) {
  const surname = (name: string) => name.trim().split(/\s+/).pop() ?? name;
  return (
    surname(left.fullName).localeCompare(surname(right.fullName), "pl") ||
    left.fullName.localeCompare(right.fullName, "pl")
  );
}

function describeAudit(entry: AuditEntry): string {
  switch (entry.action) {
    case "auto_exact":
      return tr(`połączono po imieniu i nazwisku z: ${entry.newForumFullName}`, `matched by name to: ${entry.newForumFullName}`);
    case "claim":
      return tr(`wskazał(a) siebie: ${entry.newForumFullName}`, `picked: ${entry.newForumFullName}`);
    case "no_forum_account":
      return tr("bez konta na forum", "no forum account");
    case "board_verify":
      return tr(`potwierdzono: ${entry.newForumFullName}`, `confirmed: ${entry.newForumFullName}`);
    case "board_link":
      return entry.newForumFullName
        ? tr(`połączono z: ${entry.newForumFullName}`, `linked to: ${entry.newForumFullName}`)
        : tr("bez konta na forum", "no forum account");
    case "board_clear":
      return tr(`rozłączono z: ${entry.oldForumFullName ?? "—"}`, `unlinked from: ${entry.oldForumFullName ?? "—"}`);
    default:
      return entry.action;
  }
}

// Zarząd → Osoby z forum → Konta: links of app accounts to forum people.
// Members link themselves ("proposed"); the board confirms or picks another person.
export function ForumAccountLinksPanel({ onChanged }: { onChanged?: () => void }) {
  const [links, setLinks] = useState<AccountLink[] | null>(null);
  const [people, setPeople] = useState<ForumPerson[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [pickingProfileId, setPickingProfileId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showConfirmed, setShowConfirmed] = useState(false);

  async function load() {
    if (!supabaseAuthClient) {
      return;
    }
    const [linksResult, peopleResult, auditResult] = await Promise.all([
      supabaseAuthClient.rpc("list_forum_identity_links"),
      supabaseAuthClient.rpc("list_forum_identity_candidates"),
      supabaseAuthClient.rpc("list_forum_identity_audit", { p_limit: 20 }),
    ]);
    const failed = linksResult.error ?? peopleResult.error ?? auditResult.error;
    if (failed) {
      console.warn("[forum-accounts] load", failed);
      setErrorMessage(tr("Nie udało się wczytać kont.", "Could not load accounts."));
      setLinks([]);
      return;
    }
    setLinks(parseLinks(linksResult.data));
    // The board picks for others, so "taken" by this viewer does not apply here.
    setPeople(parseForumPeople(peopleResult.data).map((person) => ({ ...person, taken: false })));
    setAudit(parseAudit(auditResult.data));
  }

  useEffect(() => {
    void load();
  }, []);

  const linkedUids = useMemo(
    () => new Set((links ?? []).map((link) => link.forumUid).filter(Boolean) as string[]),
    [links],
  );

  function suggestionFor(link: AccountLink): ForumPerson | null {
    const free = people.filter((person) => !linkedUids.has(person.forumUid));
    return suggestForumPerson(link.fullName, link.instrument, free);
  }

  async function setIdentity(link: AccountLink, person: ForumPerson | null, noForumAccount = false) {
    if (!supabaseAuthClient) {
      return;
    }
    setSavingProfileId(link.profileId);
    setErrorMessage(null);
    setInfoMessage(null);
    const { error } = await supabaseAuthClient.rpc("board_set_forum_identity", {
      p_profile_id: link.profileId,
      p_forum_uid: person?.forumUid ?? null,
      p_no_forum_account: noForumAccount,
    });
    setSavingProfileId(null);
    if (error) {
      console.warn("[forum-accounts] save", error);
      setErrorMessage(
        error.message.includes("already linked")
          ? tr("Ta osoba z forum jest już połączona z innym kontem.", "This forum person is linked to another account.")
          : tr("Nie udało się zapisać. Spróbuj ponownie.", "Could not save. Try again."),
      );
      return;
    }
    setPickingProfileId(null);
    setQuery("");
    setInfoMessage(
      person
        ? tr(`Zapisano: ${link.fullName} → ${person.fullName}.`, `Saved: ${link.fullName} → ${person.fullName}.`)
        : tr(`Zapisano: ${link.fullName} bez konta na forum.`, `Saved: ${link.fullName} has no forum account.`),
    );
    await load();
    onChanged?.();
  }

  if (links === null) {
    return (
      <View style={styles.loadingRow}>
        <ActivityIndicator color={colors.brand} />
        <Text style={styles.meta}>{tr("Wczytuję konta…", "Loading accounts…")}</Text>
      </View>
    );
  }

  const toConfirm = links.filter((link) => link.status === "proposed").sort(compareLinksBySurname);
  const unlinked = links.filter((link) => link.status === null).sort(compareLinksBySurname);
  const confirmed = links.filter((link) => link.status === "verified").sort(compareLinksBySurname);

  function renderPicker(link: AccountLink) {
    const key = nameKey(query);
    const options = people
      .filter((person) => !linkedUids.has(person.forumUid) || person.forumUid === link.forumUid)
      .filter((person) => !key || nameKey(person.fullName).includes(key))
      .sort(compareBySurname)
      .slice(0, 12);
    return (
      <View style={styles.picker}>
        <TextField
          label={tr("Szukaj osoby z forum", "Search forum people")}
          value={query}
          onChangeText={setQuery}
          placeholder={tr("Nazwisko", "Surname")}
        />
        <View style={styles.pickerList}>
          {options.map((person, index) => (
            <Pressable
              key={person.forumUid}
              accessibilityRole="button"
              disabled={savingProfileId !== null}
              onPress={() => setIdentity(link, person)}
              style={[styles.pickerRow, index > 0 && listRowStyles.divider]}
            >
              <Text style={styles.name}>{person.fullName}</Text>
              {person.instrument ? <Text style={styles.meta}>{person.instrument}</Text> : null}
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            disabled={savingProfileId !== null}
            onPress={() => setIdentity(link, null, true)}
            style={[styles.pickerRow, listRowStyles.divider]}
          >
            <Text style={styles.meta}>{tr("Bez konta na forum", "No forum account")}</Text>
          </Pressable>
        </View>
        <Button
          variant="secondary"
          label={tr("Anuluj", "Cancel")}
          onPress={() => {
            setPickingProfileId(null);
            setQuery("");
          }}
        />
      </View>
    );
  }

  function renderRow(link: AccountLink, index: number, kind: "confirm" | "unlinked" | "confirmed") {
    const isSaving = savingProfileId === link.profileId;
    const suggestion = kind === "unlinked" ? suggestionFor(link) : null;
    const forumPerson =
      kind === "confirm" && link.forumUid
        ? people.find((person) => person.forumUid === link.forumUid) ?? null
        : null;
    return (
      <View key={link.profileId} style={[styles.row, index > 0 && listRowStyles.divider]}>
        <Text style={styles.name}>{link.fullName}</Text>
        <Text style={styles.meta}>
          {link.instrument ?? ""}
          {kind === "unlinked"
            ? suggestion
              ? tr(` · podpowiedź: ${suggestion.fullName}`, ` · suggestion: ${suggestion.fullName}`)
              : tr(" · brak podpowiedzi", " · no suggestion")
            : link.noForumAccount
              ? tr(" · bez konta na forum", " · no forum account")
              : ` → ${link.forumFullName ?? ""}`}
        </Text>
        {pickingProfileId === link.profileId ? (
          renderPicker(link)
        ) : (
          <View style={styles.actions}>
            {kind === "confirm" ? (
              <Button
                label={tr("Potwierdź", "Confirm")}
                loading={isSaving}
                onPress={() =>
                  link.noForumAccount
                    ? setIdentity(link, null, true)
                    : setIdentity(
                        link,
                        forumPerson ?? { forumUid: link.forumUid ?? "", fullName: link.forumFullName ?? "", instrument: null, taken: false },
                      )
                }
              />
            ) : null}
            {suggestion ? (
              <Button
                label={tr(`Połącz z: ${suggestion.fullName}`, `Link to: ${suggestion.fullName}`)}
                loading={isSaving}
                onPress={() => setIdentity(link, suggestion)}
              />
            ) : null}
            <Button
              variant="secondary"
              label={
                kind === "unlinked" && !suggestion
                  ? tr("Wybierz osobę", "Pick a person")
                  : tr("Wybierz inną osobę", "Pick another person")
              }
              disabled={isSaving}
              onPress={() => {
                setPickingProfileId(link.profileId);
                setQuery(link.fullName.split(/\s+/).pop() ?? "");
              }}
            />
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      {errorMessage ? <Notice tone="error">{errorMessage}</Notice> : null}
      {infoMessage ? <Notice tone="success">{infoMessage}</Notice> : null}

      <Text style={styles.kicker}>
        {tr(`Do potwierdzenia · ${toConfirm.length}`, `To confirm · ${toConfirm.length}`)}
      </Text>
      {toConfirm.length > 0 ? (
        <Card variant="list">{toConfirm.map((link, index) => renderRow(link, index, "confirm"))}</Card>
      ) : (
        <EmptyState>{tr("Nic nie czeka na potwierdzenie.", "Nothing waits for confirmation.")}</EmptyState>
      )}

      <Text style={styles.kicker}>
        {tr(`Bez połączenia · ${unlinked.length}`, `Not linked · ${unlinked.length}`)}
      </Text>
      {unlinked.length > 0 ? (
        <Card variant="list">{unlinked.map((link, index) => renderRow(link, index, "unlinked"))}</Card>
      ) : (
        <EmptyState>{tr("Wszystkie konta są połączone.", "Every account is linked.")}</EmptyState>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={() => setShowConfirmed((value) => !value)}
        style={styles.toggle}
      >
        <Text style={styles.toggleLabel}>
          {showConfirmed
            ? tr(`Ukryj potwierdzone (${confirmed.length})`, `Hide confirmed (${confirmed.length})`)
            : tr(`Pokaż potwierdzone (${confirmed.length})`, `Show confirmed (${confirmed.length})`)}
        </Text>
      </Pressable>
      {showConfirmed && confirmed.length > 0 ? (
        <Card variant="list">{confirmed.map((link, index) => renderRow(link, index, "confirmed"))}</Card>
      ) : null}

      {audit.length > 0 ? (
        <>
          <Text style={styles.kicker}>{tr("Ostatnie zmiany", "Recent changes")}</Text>
          <Card variant="list">
            {audit.map((entry, index) => (
              <View key={`${entry.changedAt}-${index}`} style={[styles.row, index > 0 && listRowStyles.divider]}>
                <Text style={styles.name}>{entry.profileFullName ?? "—"}</Text>
                <Text style={styles.meta}>{describeAudit(entry)}</Text>
                <Text style={styles.meta}>
                  {entry.changedByName ?? tr("nieznany użytkownik", "unknown user")}
                  {entry.changedAt ? ` · ${formatRelativeLabel(entry.changedAt)}` : ""}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </View>
  );
}

const styles = themedStyles((colors) => ({
  wrapper: {
    gap: tokens.spacing.sm,
  },
  kicker: {
    ...textStyles.kicker,
    marginTop: tokens.spacing.xs,
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
    gap: 6,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
  },
  meta: {
    fontSize: 13,
    color: colors.muted,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.xs,
    marginTop: 4,
  },
  picker: {
    gap: tokens.spacing.sm,
    marginTop: 4,
  },
  pickerList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: tokens.radii.md,
    overflow: "hidden",
  },
  pickerRow: {
    minHeight: 44,
    paddingHorizontal: tokens.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacing.sm,
  },
  toggle: {
    minHeight: 44,
    justifyContent: "center",
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.brand,
  },
}));
