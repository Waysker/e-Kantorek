import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { Icon, type IconName } from "../ui/Icon";

export type EventsView = "events" | "calendar";

type EventsHubScreenProps = {
  view: EventsView;
  onChangeView: (view: EventsView) => void;
  renderList: () => ReactNode;
  renderCalendar: () => ReactNode;
};

const VIEWS: Array<{ key: EventsView; icon: IconName }> = [
  { key: "events", icon: "list" },
  { key: "calendar", icon: "calendar" },
];

function viewLabel(view: EventsView) {
  return view === "events" ? tr("Lista", "List") : tr("Kalendarz", "Calendar");
}

// One "Wydarzenia" tab. On desktop the calendar already holds the full agenda
// next to the month, so it is the only view. On phones the calendar shows one
// week at a time, so a list / calendar switch is offered instead.
export function EventsHubScreen({
  view,
  onChangeView,
  renderList,
  renderCalendar,
}: EventsHubScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;

  if (isDesktop) {
    return (
      <View style={styles.root}>
        <View style={[styles.header, styles.headerDesktop]}>
          <Text style={styles.title}>{tr("Wydarzenia", "Events")}</Text>
        </View>
        <View style={styles.body}>{renderCalendar()}</View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{tr("Wydarzenia", "Events")}</Text>
        <View style={styles.segmented} accessibilityRole="tablist">
          {VIEWS.map(({ key, icon }) => {
            const isActive = key === view;
            const color = isActive ? tokens.colors.ink : tokens.colors.muted;
            return (
              <Pressable
                key={key}
                onPress={() => onChangeView(key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                style={[styles.segment, isActive && styles.segmentActive]}
              >
                <Icon name={icon} size={16} color={color} />
                <Text style={[styles.segmentLabel, { color }]}>{viewLabel(key)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.body}>{view === "events" ? renderList() : renderCalendar()}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    paddingHorizontal: tokens.spacing.md,
    paddingTop: tokens.spacing.lg,
    paddingBottom: tokens.spacing.sm,
    gap: tokens.spacing.sm,
  },
  headerDesktop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.spacing.xl,
    paddingTop: tokens.spacing.lg,
    paddingBottom: tokens.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: tokens.colors.border,
  },
  title: {
    fontSize: tokens.typography.hero,
    lineHeight: 36,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: tokens.colors.ink,
  },
  segmented: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: tokens.radii.md,
    backgroundColor: tokens.colors.surfaceMuted,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  segmentActive: {
    backgroundColor: tokens.colors.surface,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  segmentLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  body: {
    flex: 1,
  },
});
