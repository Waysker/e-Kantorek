// Picks the e-Kantorek account behind a name from Facebook (Partytura →
// Kantorek (feed) → Linking to an e-Kantorek account). Suggests as you type;
// one exact match (ignoring case and diacritics) is picked at once, anything
// else waits for the board's choice. Never links on a partial match.
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { tr } from "../i18n";
import { textStyles } from "../theme/text";
import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import type { FeedMember } from "./feedApi";

export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function exactMember(members: FeedMember[], name: string): FeedMember | null {
  const key = normalizeName(name);
  if (!key) {
    return null;
  }
  const found = members.filter((member) => normalizeName(member.fullName) === key);
  return found.length === 1 ? found[0] : null;
}

// Every typed word must start one of the member's name words ("ani rac" → Ania Raczkowska).
export function suggestMembers(members: FeedMember[], name: string, limit = 5): FeedMember[] {
  const words = normalizeName(name).split(" ").filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  return members
    .filter((member) => {
      const parts = normalizeName(member.fullName).split(" ");
      return words.every((word) => parts.some((part) => part.startsWith(word)));
    })
    .slice(0, limit);
}

export type AccountChoice = {
  profileId: string | null;
  /** The board chose (or chose "Bez konta"): stop auto-picking. */
  manual: boolean;
};

export const noAccount: AccountChoice = { profileId: null, manual: false };

export function AccountPicker({
  members,
  name,
  value,
  onChange,
}: {
  members: FeedMember[];
  /** The author's name as typed from Facebook. */
  name: string;
  value: AccountChoice;
  onChange: (next: AccountChoice) => void;
}) {
  const exact = useMemo(() => exactMember(members, name), [members, name]);
  const suggestions = useMemo(() => suggestMembers(members, name), [members, name]);
  const chosen = members.find((member) => member.id === value.profileId) ?? null;

  useEffect(() => {
    if (!value.manual && (exact?.id ?? null) !== value.profileId) {
      onChange({ profileId: exact?.id ?? null, manual: false });
    }
  }, [exact, value.manual, value.profileId, onChange]);

  if (members.length === 0) {
    return null;
  }
  if (chosen) {
    return (
      <View style={styles.row}>
        <Text style={styles.label}>
          {tr("Konto: ", "Account: ")}
          <Text style={styles.name}>{chosen.fullName}</Text>
        </Text>
        <Pressable onPress={() => onChange({ profileId: null, manual: true })} accessibilityRole="button" style={styles.action}>
          <Text style={styles.actionLabel}>{tr("Zmień", "Change")}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{tr("Konto w e-Kantorku: bez konta", "e-Kantorek account: none")}</Text>
      {suggestions.length > 0 ? (
        <View style={styles.chips}>
          {suggestions.map((member) => (
            <Pressable
              key={member.id}
              onPress={() => onChange({ profileId: member.id, manual: true })}
              accessibilityRole="button"
              accessibilityLabel={tr(`Połącz z kontem ${member.fullName}`, `Link to ${member.fullName}`)}
              style={styles.chip}
            >
              <Text style={styles.chipLabel}>{member.fullName}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Board: link an imported post to an account later. */
export function AccountPickerModal({
  visible,
  members,
  initialName,
  onPick,
  onClose,
}: {
  visible: boolean;
  members: FeedMember[];
  initialName: string;
  onPick: (profileId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialName);
  useEffect(() => {
    if (visible) {
      setQuery(initialName);
    }
  }, [visible, initialName]);
  const found = query.trim() ? suggestMembers(members, query, 20) : members.slice(0, 20);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{tr("Połącz z kontem", "Link to an account")}</Text>
          <TextField value={query} onChangeText={setQuery} placeholder={tr("Imię lub nazwisko", "Name")} accessibilityLabel={tr("Szukaj konta", "Search accounts")} />
          <ScrollView style={styles.list}>
            {found.map((member) => (
              <Pressable key={member.id} onPress={() => onPick(member.id)} accessibilityRole="button" style={styles.listRow}>
                <Text style={styles.listName}>{member.fullName}</Text>
              </Pressable>
            ))}
            {found.length === 0 ? <Text style={styles.label}>{tr("Brak pasujących kont.", "No matching accounts.")}</Text> : null}
          </ScrollView>
          <Button label={tr("Anuluj", "Cancel")} variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = themedStyles((colors) => ({
  wrap: {
    gap: tokens.spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacing.sm,
  },
  label: {
    fontSize: 14,
    color: colors.muted,
  },
  name: {
    fontWeight: "600",
    color: colors.ink,
  },
  action: {
    minHeight: 44,
    justifyContent: "center",
  },
  actionLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.brand,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.xs,
  },
  chip: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: tokens.spacing.sm,
    borderRadius: tokens.radii.round,
    borderWidth: 1,
    borderColor: colors.controlBorder,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.ink,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: tokens.spacing.md,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "80%",
    backgroundColor: colors.surface,
    borderRadius: tokens.radii.lg,
    padding: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  sheetTitle: textStyles.sectionTitle,
  list: {
    flexGrow: 0,
  },
  listRow: {
    minHeight: 44,
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceMuted,
  },
  listName: {
    fontSize: 15,
    color: colors.ink,
  },
}));
