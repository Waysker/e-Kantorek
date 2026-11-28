import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { supabaseAuthClient } from "../auth/supabaseAuthClient";
import {
  compareBySurname,
  parseForumPeople,
  suggestForumPerson,
  type ForumPerson,
} from "../domain/forumIdentity";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { Button } from "./Button";
import { listRowDivider } from "./Card";
import { Notice } from "./Notice";

type ForumIdentityPromptProps = {
  profileFullName: string;
  profileInstrument: string | null;
  /** "suggest" on Start; "list" when changing the link from Ja. */
  initialMode?: "suggest" | "list";
  /** Called after a successful save, with the text for the success Notice. */
  onLinked: (message: string) => void;
  /** Shown as "Anuluj" when given (Ja). */
  onCancel?: () => void;
};

type Mode = "suggest" | "list" | "confirm";

// The amber card that asks which forum person the member is (Partytura:
// ForumIdentityPrompt). Never links on its own: the member answers.
export function ForumIdentityPrompt({
  profileFullName,
  profileInstrument,
  initialMode = "suggest",
  onLinked,
  onCancel,
}: ForumIdentityPromptProps) {
  const [people, setPeople] = useState<ForumPerson[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [showAllSections, setShowAllSections] = useState(false);
  const [picked, setPicked] = useState<ForumPerson | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabaseAuthClient) {
        setLoadError(tr("Nie udało się wczytać osób z forum.", "Could not load forum people."));
        return;
      }
      const { data, error } = await supabaseAuthClient.rpc("list_forum_identity_candidates");
      if (cancelled) {
        return;
      }
      if (error) {
        console.warn("[forum-identity] candidates", error);
        setLoadError(tr("Nie udało się wczytać osób z forum.", "Could not load forum people."));
        return;
      }
      setPeople(parseForumPeople(data));
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const suggestion = useMemo(
    () => (people ? suggestForumPerson(profileFullName, profileInstrument, people) : null),
    [people, profileFullName, profileInstrument],
  );

  useEffect(() => {
    if (people && mode === "suggest" && !suggestion) {
      setMode("list");
    }
  }, [people, mode, suggestion]);

  const sectionPeople = useMemo(() => {
    const free = (people ?? []).filter((person) => !person.taken);
    const inSection = profileInstrument
      ? free.filter((person) => person.instrument === profileInstrument)
      : [];
    const list = showAllSections || inSection.length === 0 ? free : inSection;
    return [...list].sort(compareBySurname);
  }, [people, profileInstrument, showAllSections]);

  async function save(rpc: "claim_my_forum_identity" | "declare_no_forum_account", person: ForumPerson | null) {
    if (!supabaseAuthClient) {
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    const { error } =
      rpc === "claim_my_forum_identity" && person
        ? await supabaseAuthClient.rpc(rpc, { p_forum_uid: person.forumUid })
        : await supabaseAuthClient.rpc("declare_no_forum_account");
    setIsSaving(false);
    if (error) {
      console.warn("[forum-identity] save", error);
      setSaveError(
        error.message.includes("already linked")
          ? tr(
              "Ta osoba jest już połączona z innym kontem. Napisz do zarządu.",
              "This person is already linked to another account. Contact the board.",
            )
          : tr("Nie udało się zapisać. Spróbuj ponownie.", "Could not save. Try again."),
      );
      return;
    }
    onLinked(
      person
        ? tr(
            `Połączono z: ${person.fullName}. Zarząd jeszcze to potwierdzi.`,
            `Linked to: ${person.fullName}. The board will confirm it.`,
          )
        : tr("Zapisano: bez konta na forum.", "Saved: no forum account."),
    );
  }

  if (loadError) {
    return <Notice tone="error">{loadError}</Notice>;
  }

  if (!people) {
    return (
      <View style={[styles.card, styles.loading]}>
        <ActivityIndicator color={tokens.colors.warningInk} />
      </View>
    );
  }

  if (mode === "suggest" && suggestion) {
    return (
      <View style={styles.card}>
        <Text style={styles.kicker}>{tr("Czy to Ty na forum?", "Is this you on the forum?")}</Text>
        <View>
          <Text style={styles.title}>{suggestion.fullName}</Text>
          {suggestion.instrument ? <Text style={styles.meta}>{suggestion.instrument}</Text> : null}
        </View>
        <View style={styles.actions}>
          <Button
            size="lg"
            style={styles.primaryAction}
            label={tr("Tak, to ja", "Yes, that's me")}
            loading={isSaving}
            onPress={() => save("claim_my_forum_identity", suggestion)}
          />
          <Button
            size="lg"
            variant="secondary"
            label={tr("To nie ja", "Not me")}
            disabled={isSaving}
            onPress={() => setMode("list")}
          />
        </View>
        {saveError ? <Notice tone="error">{saveError}</Notice> : null}
        <Text style={styles.hint}>
          {tr("Dzięki temu zobaczysz tu swoje deklaracje z ankiet.", "Then you'll see your poll answers here.")}
        </Text>
      </View>
    );
  }

  if (mode === "confirm" && picked) {
    return (
      <View style={styles.card}>
        <Text style={styles.kicker}>{tr("Wskaż siebie na liście", "Find yourself on the list")}</Text>
        <Text style={styles.title}>{tr(`Połączyć z: ${picked.fullName}?`, `Link to: ${picked.fullName}?`)}</Text>
        <View style={styles.actions}>
          <Button
            size="lg"
            style={styles.primaryAction}
            label={tr("Połącz", "Link")}
            loading={isSaving}
            onPress={() => save("claim_my_forum_identity", picked)}
          />
          <Button
            size="lg"
            variant="secondary"
            label={tr("Wróć", "Back")}
            disabled={isSaving}
            onPress={() => {
              setPicked(null);
              setSaveError(null);
              setMode("list");
            }}
          />
        </View>
        {saveError ? <Notice tone="error">{saveError}</Notice> : null}
      </View>
    );
  }

  const listsSection = Boolean(profileInstrument) && !showAllSections &&
    sectionPeople.some((person) => person.instrument === profileInstrument);

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>{tr("Wskaż siebie na liście", "Find yourself on the list")}</Text>
      <Text style={styles.meta}>
        {listsSection
          ? tr(`${profileInstrument} na forum`, `${profileInstrument} on the forum`)
          : tr("Wszyscy z ankiet na forum", "Everyone from forum polls")}
      </Text>
      <View style={styles.list} accessibilityRole="list">
        {sectionPeople.map((person, index) => (
          <Pressable
            key={person.forumUid}
            accessibilityRole="button"
            onPress={() => {
              setPicked(person);
              setSaveError(null);
              setMode("confirm");
            }}
            style={[styles.row, index > 0 && listRowDivider]}
          >
            <Text style={styles.rowText}>{person.fullName}</Text>
            {!listsSection && person.instrument ? (
              <Text style={styles.rowMeta}>{person.instrument}</Text>
            ) : null}
          </Pressable>
        ))}
        {listsSection ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowAllSections(true)}
            style={[styles.row, listRowDivider]}
          >
            <Text style={styles.rowMuted}>{tr("Nie ma mnie tutaj: pokaż wszystkich", "Not here: show everyone")}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={isSaving}
          onPress={() => save("declare_no_forum_account", null)}
          style={[styles.row, listRowDivider]}
        >
          <Text style={styles.rowMuted}>{tr("Nie mam konta na forum", "I have no forum account")}</Text>
        </Pressable>
      </View>
      {saveError ? <Notice tone="error">{saveError}</Notice> : null}
      {onCancel ? (
        <Button variant="secondary" label={tr("Anuluj", "Cancel")} disabled={isSaving} onPress={onCancel} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.colors.warningSurface,
    borderWidth: 1.5,
    borderColor: tokens.colors.warningBorder,
    borderRadius: tokens.radii.lg,
    padding: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  loading: {
    alignItems: "center",
    paddingVertical: tokens.spacing.lg,
  },
  kicker: {
    fontSize: tokens.typography.caption,
    fontWeight: "600",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: tokens.colors.warningInk,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: tokens.colors.ink,
  },
  meta: {
    marginTop: 2,
    fontSize: 14,
    color: tokens.colors.muted,
  },
  actions: {
    flexDirection: "row",
    gap: tokens.spacing.xs,
  },
  primaryAction: {
    flex: 1,
  },
  hint: {
    fontSize: tokens.typography.caption,
    lineHeight: 17,
    color: tokens.colors.warningInk,
  },
  list: {
    backgroundColor: tokens.colors.surface,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    overflow: "hidden",
  },
  row: {
    minHeight: 44,
    paddingHorizontal: tokens.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacing.sm,
  },
  rowText: {
    fontSize: 15,
    color: tokens.colors.ink,
    flexShrink: 1,
  },
  rowMeta: {
    fontSize: 13,
    color: tokens.colors.muted,
  },
  rowMuted: {
    fontSize: 15,
    color: tokens.colors.muted,
  },
});
