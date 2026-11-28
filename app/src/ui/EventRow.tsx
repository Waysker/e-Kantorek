import { Pressable, Text, View } from "react-native";

import type { EventListItem } from "../domain/models";
import { appLocaleTag } from "../i18n";
import { colors, themedStyles } from "../theme/theme";
import { stripTitleDatePrefix } from "../utils/format";
import { listRowStyles } from "./Card";
import { StatusPill } from "./StatusPill";

const TZ = "Europe/Warsaw";
const WEEKDAY = new Intl.DateTimeFormat(appLocaleTag, { timeZone: TZ, weekday: "short" });
const DAY = new Intl.DateTimeFormat(appLocaleTag, { timeZone: TZ, day: "numeric" });
const DATE = new Intl.DateTimeFormat(appLocaleTag, {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "numeric",
});
const TIME = new Intl.DateTimeFormat(appLocaleTag, { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

type EventRowProps = {
  event: EventListItem;
  onPress: () => void;
  /** Rows after the first draw a divider above. */
  index: number;
  /** "anchor" = weekday + big day number on the left (lists grouped by month);
   *  "inline" = date in the meta line (short lists across months). */
  dateStyle?: "anchor" | "inline";
  /** Mute past events. */
  isPast?: boolean;
};

// The one way an event appears in a list: date, title, "time · venue", status.
export function EventRow({ event, onPress, index, dateStyle = "anchor", isPast }: EventRowProps) {
  const date = new Date(event.startsAt);
  const time = TIME.format(date);
  const meta =
    dateStyle === "inline"
      ? `${DATE.format(date)} · ${time}${event.venue ? ` · ${event.venue}` : ""}`
      : `${time}${event.venue ? ` · ${event.venue}` : ""}`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      style={(state) => [
        styles.row,
        index > 0 && listRowStyles.divider,
        ((state as { hovered?: boolean }).hovered || state.pressed) && styles.rowHovered,
      ]}
    >
      {dateStyle === "anchor" ? (
        <View style={styles.dateAnchor}>
          <Text style={styles.weekday}>{WEEKDAY.format(date)}</Text>
          <Text style={[styles.day, isPast && styles.mutedText]}>{DAY.format(date)}</Text>
        </View>
      ) : null}
      <View style={styles.body}>
        <Text style={[styles.title, isPast && styles.mutedText]} numberOfLines={2}>
          {stripTitleDatePrefix(event.title)}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <StatusPill status={event.attendanceStatus} />
    </Pressable>
  );
}

const styles = themedStyles((colors) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 60,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  rowHovered: {
    backgroundColor: colors.paper,
  },
  dateAnchor: {
    width: 44,
    alignItems: "center",
  },
  weekday: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    color: colors.muted,
  },
  day: {
    fontSize: 22,
    lineHeight: 24,
    fontWeight: "800",
    color: colors.ink,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: colors.ink,
  },
  mutedText: {
    color: colors.muted,
  },
  meta: {
    fontSize: 13,
    color: colors.muted,
  },
}));
