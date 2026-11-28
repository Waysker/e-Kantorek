import type { ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";

import { tr } from "../i18n";
import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";
import { textStyles } from "../theme/text";
import { SegmentedControl } from "../ui/SegmentedControl";
import type { IconName } from "../ui/Icon";

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
        <SegmentedControl
          options={VIEWS.map(({ key, icon }) => ({ key, icon, label: viewLabel(key) }))}
          value={view}
          onChange={onChangeView}
        />
      </View>
      <View style={styles.body}>{view === "events" ? renderList() : renderCalendar()}</View>
    </View>
  );
}

const styles = themedStyles((colors) => ({
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
    borderBottomColor: colors.border,
  },
  title: textStyles.screenTitle,
  body: {
    flex: 1,
  },
}));
