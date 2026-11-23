import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { BoardSection } from "../navigation/routes";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";

type BoardSubNavProps = {
  sections: BoardSection[];
  activeSection: BoardSection;
  badges?: Partial<Record<BoardSection, number>>;
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
  return tr("Instrumenty", "Instruments");
}

// Second-level navigation inside the "Zarząd" tab.
export function BoardSubNav({ sections, activeSection, badges, onSelect }: BoardSubNavProps) {
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
                <View style={styles.badge}>
                  <Text style={styles.badgeLabel}>
                    {tr(`${badge} do przypisania`, `${badge} to assign`)}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderBottomWidth: 1,
    borderBottomColor: tokens.colors.border,
    backgroundColor: tokens.colors.background,
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
    borderBottomColor: tokens.colors.brand,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    color: tokens.colors.muted,
  },
  labelActive: {
    color: tokens.colors.ink,
  },
  badge: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: tokens.radii.round,
    borderWidth: 1.5,
    borderColor: tokens.colors.warningBorder,
    backgroundColor: tokens.colors.warningSurface,
    justifyContent: "center",
  },
  badgeLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: tokens.colors.warningInk,
  },
});
