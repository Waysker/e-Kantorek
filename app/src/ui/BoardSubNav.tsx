import { Pressable, ScrollView, Text, View } from "react-native";

import type { BoardSection } from "../navigation/routes";
import { tr } from "../i18n";
import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";
import { Badge } from "./Badge";

type BoardSubNavProps = {
  sections: BoardSection[];
  activeSection: BoardSection;
  badges?: Partial<Record<BoardSection, number>>;
  /** Badge text per section; defaults to "N do przypisania". */
  badgeLabels?: Partial<Record<BoardSection, string>>;
  onSelect: (section: BoardSection) => void;
};

function getSectionLabel(section: BoardSection) {
  if (section === "attendance") {
    return tr("Obecność", "Attendance");
  }
  if (section === "summary") {
    return tr("Podsumowanie i punkty", "Summary and points");
  }
  if (section === "roles") {
    return tr("Role", "Roles");
  }
  return tr("Osoby z forum", "Forum people");
}

// Second-level navigation inside the "Zarząd" tab.
export function BoardSubNav({ sections, activeSection, badges, badgeLabels, onSelect }: BoardSubNavProps) {
  if (sections.length < 2) {
    return null;
  }

  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        accessibilityRole="tablist"
      >
        {sections.map((section) => {
          const isActive = section === activeSection;
          const badge = badges?.[section] ?? 0;
          return (
            <Pressable
              key={section}
              onPress={() => onSelect(section)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              style={[styles.item, isActive && styles.itemActive]}
            >
              <Text style={[styles.label, isActive && styles.labelActive]}>
                {getSectionLabel(section)}
              </Text>
              {badge > 0 ? (
                <Badge variant="soft" value={badgeLabels?.[section] ?? tr(`${badge} do przypisania`, `${badge} to assign`)} />
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  wrapper: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  row: {
    paddingHorizontal: tokens.spacing.lg,
    gap: tokens.spacing.lg,
  },
  item: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.xs,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  itemActive: {
    borderBottomColor: colors.brand,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.muted,
  },
  labelActive: {
    color: colors.ink,
  },
}));
