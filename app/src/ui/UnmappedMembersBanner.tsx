import { StyleSheet, Text, View } from "react-native";

import type { SquadMember } from "../domain/models";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";

type UnmappedMembersBannerProps = {
  members: SquadMember[];
};

const MAX_NAMES_SHOWN = 4;

export function UnmappedMembersBanner({ members }: UnmappedMembersBannerProps) {
  if (members.length === 0) {
    return null;
  }

  const shownNames = members.slice(0, MAX_NAMES_SHOWN).map((member) => member.fullName);
  const hiddenCount = members.length - shownNames.length;
  const namesLabel =
    hiddenCount > 0
      ? `${shownNames.join(", ")} ${tr(`i ${hiddenCount} więcej`, `and ${hiddenCount} more`)}`
      : shownNames.join(", ");

  return (
    <View style={styles.container}>
      <Text style={styles.statusLabel}>
        {tr(
          `Osoby bez przypisanego instrumentu: ${members.length}`,
          `Members without an instrument: ${members.length}`,
        )}
      </Text>
      <Text style={styles.detailsLabel}>
        {namesLabel}. {tr(
          "Dodaj mapping, żeby trafiły do właściwej sekcji.",
          "Add a mapping so they land in the right section.",
        )}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: tokens.colors.warningInk,
    backgroundColor: tokens.colors.warningSurface,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    gap: 2,
  },
  statusLabel: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: tokens.colors.warningInk,
    fontWeight: "700",
  },
  detailsLabel: {
    fontSize: tokens.typography.caption,
    lineHeight: 16,
    color: tokens.colors.warningInk,
    fontWeight: "600",
  },
});
