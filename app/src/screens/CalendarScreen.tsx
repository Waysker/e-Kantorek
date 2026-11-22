import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import type { AttendanceStatus, EventListItem } from "../domain/models";
import { appLocaleTag, tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { stripTitleDatePrefix } from "../utils/format";

// Pattern: "agenda first". The agenda ("what is coming for me") is the main view;
// a compact month grid is navigation/overview. Every attendance status is shown
// with colour AND a glyph, and "no response" is styled as an action item.

type CalendarScreenProps = {
  events: EventListItem[];
  onOpenEvent: (eventId: string) => void;
};

const WARSAW_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const WARSAW_TIME = new Intl.DateTimeFormat(appLocaleTag, {
  timeZone: "Europe/Warsaw",
  hour: "2-digit",
  minute: "2-digit",
});
const SHORT_DAY_MONTH = new Intl.DateTimeFormat(appLocaleTag, {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const WEEKDAY_SHORT = new Intl.DateTimeFormat(appLocaleTag, {
  weekday: "short",
  timeZone: "UTC",
});
// Monday-first labels; 2024-01-01 is a Monday.
const WEEKDAYS = Array.from({ length: 7 }, (_, index) =>
  WEEKDAY_SHORT.format(new Date(Date.UTC(2024, 0, 1 + index))),
);
const DAY_MS = 24 * 60 * 60 * 1000;

function dateKey(value: string | Date) {
  return WARSAW_DATE.format(value instanceof Date ? value : new Date(value));
}

function makeKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function keyToUtc(key: string) {
  return Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
}

function weekStartMs(key: string) {
  const utc = keyToUtc(key);
  const weekday = (new Date(utc).getUTCDay() + 6) % 7;
  return utc - weekday * DAY_MS;
}

type Cell = { key: string; day: number } | null;

function buildCells(year: number, month: number): Cell[] {
  const offset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const total = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Cell[] = Array.from({ length: offset }, () => null);
  for (let day = 1; day <= total; day += 1) {
    cells.push({ key: makeKey(year, month, day), day });
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

type StatusMeta = {
  glyph: string;
  label: string;
  bg: string;
  fg: string;
  accent: string;
  needsAction: boolean;
};

function statusMeta(status: AttendanceStatus): StatusMeta {
  switch (status) {
    case "going":
      return {
        glyph: "✓",
        label: tr("Będę", "Going"),
        bg: tokens.colors.successSurface,
        fg: tokens.colors.successInk,
        accent: tokens.colors.successInk,
        needsAction: false,
      };
    case "not_going":
      return {
        glyph: "✕",
        label: tr("Nie będę", "Not going"),
        bg: tokens.colors.dangerSurface,
        fg: tokens.colors.dangerInk,
        accent: tokens.colors.dangerInk,
        needsAction: false,
      };
    case "maybe":
      return {
        glyph: "?",
        label: tr("Może", "Maybe"),
        bg: tokens.colors.warningSurface,
        fg: tokens.colors.warningInk,
        accent: tokens.colors.warningInk,
        needsAction: false,
      };
    default:
      return {
        glyph: "!",
        label: tr("Brak odpowiedzi", "No response"),
        bg: tokens.colors.surface,
        fg: tokens.colors.ink,
        accent: tokens.colors.ink,
        needsAction: true,
      };
  }
}

// When one day has several events, the cell shows the one that needs attention most.
const STATUS_PRIORITY: AttendanceStatus[] = ["no_response", "maybe", "going", "not_going"];

function dominantStatus(dayEvents: EventListItem[]): AttendanceStatus {
  for (const status of STATUS_PRIORITY) {
    if (dayEvents.some((event) => event.attendanceStatus === status)) {
      return status;
    }
  }
  return "no_response";
}

function StatusPill({ status }: { status: AttendanceStatus }) {
  const meta = statusMeta(status);
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: meta.bg },
        meta.needsAction && styles.pillDashed,
      ]}
    >
      <Text style={[styles.pillLabel, { color: meta.fg }]}>
        {meta.glyph} {meta.label}
      </Text>
    </View>
  );
}

type AgendaItem =
  | { kind: "header"; id: string; label: string; accent?: boolean }
  | { kind: "event"; id: string; event: EventListItem; dayKey: string; muted: boolean };

export function CalendarScreen({ events, onOpenEvent }: CalendarScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;
  const todayKey = dateKey(new Date());

  const [cursor, setCursor] = useState(() => ({
    year: Number(todayKey.slice(0, 4)),
    month: Number(todayKey.slice(5, 7)) - 1,
  }));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [showMonthOnMobile, setShowMonthOnMobile] = useState(false);
  const [weekStart, setWeekStart] = useState(() => weekStartMs(todayKey));
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventListItem[]>();
    for (const event of events) {
      const key = dateKey(event.startsAt);
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    }
    return map;
  }, [events]);

  const monthPrefix = makeKey(cursor.year, cursor.month, 1).slice(0, 7);
  const cells = useMemo(() => buildCells(cursor.year, cursor.month), [cursor]);
  const weeks = useMemo(() => {
    const rows: Cell[][] = [];
    for (let index = 0; index < cells.length; index += 7) {
      rows.push(cells.slice(index, index + 7));
    }
    return rows;
  }, [cells]);

  const upcoming = useMemo(
    () =>
      events
        .filter((event) => dateKey(event.startsAt) >= todayKey)
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [events, todayKey],
  );
  const pastInMonth = useMemo(
    () =>
      events
        .filter((event) => {
          const key = dateKey(event.startsAt);
          return key < todayKey && key.startsWith(monthPrefix);
        })
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [events, todayKey, monthPrefix],
  );
  const needsResponse = upcoming.filter((event) => event.attendanceStatus === "no_response");

  const agendaItems = useMemo(() => {
    const items: AgendaItem[] = [];
    const thisWeek = weekStartMs(todayKey);
    let lastGroup = "";
    for (const event of upcoming) {
      const key = dateKey(event.startsAt);
      const start = weekStartMs(key);
      const weekIndex = Math.round((start - thisWeek) / (7 * DAY_MS));
      const groupId = `w${weekIndex}`;
      if (groupId !== lastGroup) {
        lastGroup = groupId;
        const range = `${SHORT_DAY_MONTH.format(new Date(start))} – ${SHORT_DAY_MONTH.format(
          new Date(start + 6 * DAY_MS),
        )}`;
        const label =
          weekIndex === 0
            ? `${tr("Ten tydzień", "This week")} · ${range}`
            : weekIndex === 1
              ? `${tr("Następny tydzień", "Next week")} · ${range}`
              : range;
        items.push({ kind: "header", id: `h-${groupId}`, label, accent: weekIndex === 0 });
      }
      items.push({ kind: "event", id: event.id, event, dayKey: key, muted: false });
    }
    return items;
  }, [upcoming, todayKey]);

  const monthLabel = new Intl.DateTimeFormat(appLocaleTag, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(cursor.year, cursor.month, 1)));

  function scrollToEvent(eventId: string) {
    const y = offsets.current[eventId];
    if (y !== undefined) {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
    }
  }

  function selectDay(key: string) {
    setSelectedKey(key);
    if (!isDesktop) {
      // Phone: the week list shows every day, so jump to that week instead of scrolling.
      setWeekStart(weekStartMs(key));
      setShowMonthOnMobile(false);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      return;
    }
    const dayEvents = eventsByDay.get(key) ?? [];
    if (dayEvents.length === 0) {
      return;
    }
    if (key < todayKey) {
      setShowPast(true);
    }
    // Layout offsets of a freshly expanded section arrive a frame later.
    setTimeout(() => scrollToEvent(dayEvents[0].id), 60);
  }

  function shiftMonth(delta: number) {
    const next = new Date(Date.UTC(cursor.year, cursor.month + delta, 1));
    setCursor({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
    setSelectedKey(null);
    offsets.current = {};
  }

  function goToToday() {
    setCursor({ year: Number(todayKey.slice(0, 4)), month: Number(todayKey.slice(5, 7)) - 1 });
    setSelectedKey(null);
    setWeekStart(weekStartMs(todayKey));
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  function shiftWeek(delta: number) {
    setWeekStart((current) => current + delta * 7 * DAY_MS);
    setSelectedKey(null);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  useEffect(() => {
    offsets.current = {};
  }, [showPast]);

  const monthNav = (
    <View style={styles.monthHeader}>
      <Text style={styles.monthLabel}>{monthLabel}</Text>
      <View style={styles.monthNav}>
        <Pressable
          onPress={() => shiftMonth(-1)}
          style={styles.navButton}
          accessibilityRole="button"
          accessibilityLabel={tr("Poprzedni miesiąc", "Previous month")}
        >
          <Text style={styles.navGlyph}>{"‹"}</Text>
        </Pressable>
        <Pressable
          onPress={() => shiftMonth(1)}
          style={styles.navButton}
          accessibilityRole="button"
          accessibilityLabel={tr("Następny miesiąc", "Next month")}
        >
          <Text style={styles.navGlyph}>{"›"}</Text>
        </Pressable>
      </View>
    </View>
  );

  const miniMonth = (
    <View style={styles.miniMonth}>
      {monthNav}
      <View style={styles.weekRow}>
        {WEEKDAYS.map((label) => (
          <Text key={label} style={styles.weekday}>
            {label}
          </Text>
        ))}
      </View>
      {weeks.map((week, weekIndex) => (
        <View key={weekIndex} style={styles.weekRow}>
          {week.map((cell, cellIndex) => {
            if (!cell) {
              return <View key={cellIndex} style={styles.cellSlot} />;
            }
            const dayEvents = eventsByDay.get(cell.key) ?? [];
            const meta = dayEvents.length > 0 ? statusMeta(dominantStatus(dayEvents)) : null;
            const isToday = cell.key === todayKey;
            const isSelected = cell.key === selectedKey;
            return (
              <View key={cell.key} style={styles.cellSlot}>
                <Pressable
                  onPress={() => selectDay(cell.key)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    meta
                      ? `${cell.day}, ${dayEvents.length} ${tr("wydarzeń", "events")}, ${meta.label}`
                      : String(cell.day)
                  }
                  style={[
                    styles.cell,
                    meta && { backgroundColor: meta.bg },
                    meta?.needsAction && styles.cellDashed,
                    isSelected && styles.cellSelected,
                  ]}
                >
                  <View style={[styles.dayBubble, isToday && styles.dayBubbleToday]}>
                    <Text
                      style={[
                        styles.dayNumber,
                        meta && { color: meta.fg, fontWeight: "700" },
                        isToday && styles.dayNumberToday,
                      ]}
                    >
                      {cell.day}
                    </Text>
                  </View>
                  {meta ? <Text style={[styles.cellGlyph, { color: meta.fg }]}>{meta.glyph}</Text> : null}
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
      <View style={styles.legend}>
        {(["going", "not_going", "maybe", "no_response"] as AttendanceStatus[]).map((status) => {
          const meta = statusMeta(status);
          return (
            <View key={status} style={styles.legendRow}>
              <View
                style={[
                  styles.legendSwatch,
                  { backgroundColor: meta.bg },
                  meta.needsAction && styles.cellDashed,
                ]}
              >
                <Text style={[styles.cellGlyph, { color: meta.fg }]}>{meta.glyph}</Text>
              </View>
              <Text style={styles.legendLabel}>
                {meta.label}
                {meta.needsAction ? ` — ${tr("wymaga reakcji", "needs action")}` : ""}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );

  function renderEventRow(event: EventListItem, dayKey: string, muted: boolean) {
    const meta = statusMeta(event.attendanceStatus);
    const day = new Date(keyToUtc(dayKey));
    return (
      <Pressable
        key={event.id}
        onPress={() => onOpenEvent(event.id)}
        onLayout={(layout) => {
          offsets.current[event.id] = layout.nativeEvent.layout.y;
        }}
        style={[
          styles.row,
          { borderLeftColor: meta.accent },
          muted && styles.rowMuted,
          selectedKey === dayKey && styles.rowSelected,
        ]}
      >
        <View style={styles.rowDate}>
          <Text style={styles.rowWeekday}>{WEEKDAY_SHORT.format(day)}</Text>
          <Text style={styles.rowDay}>{day.getUTCDate()}</Text>
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>{stripTitleDatePrefix(event.title)}</Text>
          <Text style={styles.rowMeta}>
            {WARSAW_TIME.format(new Date(event.startsAt))}
            {event.venue ? ` · ${event.venue}` : ""}
          </Text>
        </View>
        <StatusPill status={event.attendanceStatus} />
      </Pressable>
    );
  }

  const actionBanner =
    needsResponse.length > 0 ? (
      <View style={styles.actionBanner}>
        <View style={styles.actionCount}>
          <Text style={styles.actionCountLabel}>{needsResponse.length}</Text>
        </View>
        <View style={styles.actionBody}>
          <Text style={styles.actionTitle}>
            {needsResponse.length === 1
              ? tr("Wydarzenie czeka na Twoją odpowiedź", "An event is waiting for your response")
              : tr("Wydarzenia czekają na Twoją odpowiedź", "Events are waiting for your response")}
          </Text>
          <Text style={styles.actionMeta}>
            {stripTitleDatePrefix(needsResponse[0].title)} ·{" "}
            {SHORT_DAY_MONTH.format(new Date(keyToUtc(dateKey(needsResponse[0].startsAt))))}
            {needsResponse.length > 1 ? ` +${needsResponse.length - 1}` : ""}
          </Text>
        </View>
        <Pressable
          onPress={() => onOpenEvent(needsResponse[0].id)}
          style={styles.actionButton}
          accessibilityRole="button"
        >
          <Text style={styles.actionButtonLabel}>{tr("Odpowiedz", "Respond")}</Text>
        </Pressable>
      </View>
    ) : null;

  const agenda = (
    <ScrollView
      ref={scrollRef}
      style={styles.agendaScroll}
      contentContainerStyle={[styles.agendaContent, isDesktop && styles.agendaContentDesktop]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.titleBlock}>
        <Text style={styles.kicker}>{tr("Kalendarz", "Calendar")}</Text>
        <View style={styles.titleRow}>
          <Text style={styles.screenTitle}>{tr("Co mnie czeka", "What's coming up")}</Text>
        </View>
      </View>

      {actionBanner}

      {upcoming.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyCopy}>
            {tr("Brak nadchodzących wydarzeń.", "No upcoming events.")}
          </Text>
        </View>
      ) : (
        agendaItems.map((item) =>
          item.kind === "header" ? (
            <Text key={item.id} style={[styles.sectionHeader, item.accent && styles.sectionHeaderAccent]}>
              {item.label}
            </Text>
          ) : (
            renderEventRow(item.event, item.dayKey, item.muted)
          ),
        )
      )}

      {pastInMonth.length > 0 ? (
        <View style={styles.pastBlock}>
          <Pressable
            onPress={() => setShowPast((value) => !value)}
            style={styles.pastToggle}
            accessibilityRole="button"
          >
            <Text style={styles.sectionHeader}>
              {tr("Minione w tym miesiącu", "Past this month")} ({pastInMonth.length})
            </Text>
            <Text style={styles.sectionHeader}>{showPast ? "▴" : "▾"}</Text>
          </Pressable>
          {showPast
            ? pastInMonth.map((event) => renderEventRow(event, dateKey(event.startsAt), true))
            : null}
        </View>
      ) : null}
    </ScrollView>
  );

  if (isDesktop) {
    return (
      <View style={styles.desktopRoot}>
        <View style={styles.sidebar}>
          {miniMonth}
          <Pressable onPress={goToToday} style={styles.todayButton} accessibilityRole="button">
            <Text style={styles.todayLabel}>{tr("Dzisiaj", "Today")}</Text>
          </Pressable>
        </View>
        {agenda}
      </View>
    );
  }

  // Phone: week strip on top, the days of that week listed below.
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const d = new Date(weekStart + index * DAY_MS);
    return makeKey(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  });
  const weekLabel = `${SHORT_DAY_MONTH.format(new Date(weekStart))} – ${SHORT_DAY_MONTH.format(
    new Date(weekStart + 6 * DAY_MS),
  )}`;
  const weekHasEvents = weekDays.some((key) => (eventsByDay.get(key)?.length ?? 0) > 0);
  const nextUpcoming = upcoming[0];

  return (
    <View style={styles.mobileRoot}>
      <View style={styles.weekHeader}>
        <View style={styles.monthHeader}>
          <Text style={styles.weekTitle}>{weekLabel}</Text>
          <View style={styles.monthNav}>
            <Pressable onPress={goToToday} style={styles.textButton} accessibilityRole="button">
              <Text style={styles.textButtonLabel}>{tr("Dzisiaj", "Today")}</Text>
            </Pressable>
            <Pressable
              onPress={() => shiftWeek(-1)}
              style={styles.navButton}
              accessibilityRole="button"
              accessibilityLabel={tr("Poprzedni tydzień", "Previous week")}
            >
              <Text style={styles.navGlyph}>{"‹"}</Text>
            </Pressable>
            <Pressable
              onPress={() => shiftWeek(1)}
              style={styles.navButton}
              accessibilityRole="button"
              accessibilityLabel={tr("Następny tydzień", "Next week")}
            >
              <Text style={styles.navGlyph}>{"›"}</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.weekRow}>
          {weekDays.map((key, index) => {
            const dayEvents = eventsByDay.get(key) ?? [];
            const meta = dayEvents.length > 0 ? statusMeta(dominantStatus(dayEvents)) : null;
            const isToday = key === todayKey;
            return (
              <View key={key} style={styles.cellSlot}>
                <Text style={styles.weekday}>{WEEKDAYS[index]}</Text>
                <View
                  style={[
                    styles.cell,
                    styles.weekCell,
                    meta && { backgroundColor: meta.bg },
                    meta?.needsAction && styles.cellDashed,
                  ]}
                >
                  <View style={[styles.dayBubble, isToday && styles.dayBubbleToday]}>
                    <Text
                      style={[
                        styles.dayNumber,
                        meta && { color: meta.fg, fontWeight: "700" },
                        isToday && styles.dayNumberToday,
                      ]}
                    >
                      {Number(key.slice(8, 10))}
                    </Text>
                  </View>
                  {meta ? <Text style={[styles.cellGlyph, { color: meta.fg }]}>{meta.glyph}</Text> : null}
                </View>
              </View>
            );
          })}
        </View>
        <Pressable
          onPress={() => setShowMonthOnMobile((value) => !value)}
          style={styles.monthToggle}
          accessibilityRole="button"
        >
          <Text style={styles.textButtonLabel}>
            {tr("Miesiąc", "Month")} {showMonthOnMobile ? "▴" : "▾"}
          </Text>
        </Pressable>
        {showMonthOnMobile ? miniMonth : null}
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.agendaScroll}
        contentContainerStyle={styles.agendaContent}
        showsVerticalScrollIndicator={false}
      >
        {actionBanner}
        {weekDays.map((key) => {
          const dayEvents = eventsByDay.get(key) ?? [];
          const isToday = key === todayKey;
          const isPast = key < todayKey;
          if (dayEvents.length === 0 && !isToday) {
            return null;
          }
          const date = new Date(keyToUtc(key));
          return (
            <View key={key} style={styles.daySection}>
              <Text
                style={[
                  styles.sectionHeader,
                  isToday && styles.sectionHeaderAccent,
                  isPast && styles.sectionHeaderPast,
                ]}
              >
                {`${WEEKDAY_SHORT.format(date)} ${date.getUTCDate()}`}
                {isToday ? ` · ${tr("dzisiaj", "today")}` : isPast ? ` · ${tr("minione", "past")}` : ""}
              </Text>
              {dayEvents.length === 0 ? (
                <Text style={styles.emptyCopy}>
                  {tr("Brak wydarzeń.", "No events.")}
                  {nextUpcoming
                    ? ` ${tr("Następne", "Next")}: ${SHORT_DAY_MONTH.format(
                        new Date(keyToUtc(dateKey(nextUpcoming.startsAt))),
                      )}, ${WARSAW_TIME.format(new Date(nextUpcoming.startsAt))}`
                    : ""}
                </Text>
              ) : (
                dayEvents.map((event) => renderEventRow(event, key, isPast))
              )}
            </View>
          );
        })}
        {!weekHasEvents && !weekDays.includes(todayKey) ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyCopy}>
              {tr("Brak wydarzeń w tym tygodniu.", "No events this week.")}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  desktopRoot: { flex: 1, flexDirection: "row" },
  mobileRoot: { flex: 1 },
  sidebar: {
    width: 340,
    padding: tokens.spacing.lg,
    gap: tokens.spacing.md,
    backgroundColor: tokens.colors.surface,
    borderRightWidth: 1,
    borderRightColor: tokens.colors.border,
  },
  miniMonth: {
    gap: 2,
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radii.md,
  },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: tokens.spacing.xs,
  },
  monthLabel: {
    fontSize: 20,
    fontWeight: "700",
    color: tokens.colors.ink,
    textTransform: "capitalize",
  },
  monthNav: { flexDirection: "row" },
  navButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  navGlyph: { fontSize: 26, lineHeight: 28, color: tokens.colors.ink },
  weekRow: { flexDirection: "row" },
  weekday: {
    flex: 1,
    textAlign: "center",
    fontSize: tokens.typography.caption,
    fontWeight: "700",
    color: tokens.colors.muted,
    textTransform: "uppercase",
    paddingVertical: tokens.spacing.xs,
  },
  cellSlot: { flex: 1, padding: 1 },
  cell: {
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  cellDashed: { borderStyle: "dashed", borderColor: tokens.colors.ink },
  cellSelected: { borderStyle: "solid", borderColor: tokens.colors.brand },
  dayBubble: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  dayBubbleToday: { backgroundColor: tokens.colors.brand },
  dayNumber: { fontSize: 14, lineHeight: 16, color: tokens.colors.ink },
  dayNumberToday: { color: tokens.colors.surface, fontWeight: "700" },
  cellGlyph: { fontSize: 12, lineHeight: 13, fontWeight: "700" },
  legend: { gap: tokens.spacing.xs, marginTop: tokens.spacing.sm },
  legendRow: { flexDirection: "row", alignItems: "center", gap: tokens.spacing.sm },
  legendSwatch: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  legendLabel: { fontSize: 13, color: tokens.colors.muted },
  todayButton: {
    height: 44,
    borderRadius: tokens.radii.round,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  todayLabel: { fontSize: 14, fontWeight: "700", color: tokens.colors.ink },
  agendaScroll: { flex: 1 },
  agendaContent: { padding: tokens.spacing.md, gap: tokens.spacing.sm, paddingBottom: tokens.spacing.xl },
  agendaContentDesktop: { paddingHorizontal: 56, paddingVertical: tokens.spacing.xl, gap: 10 },
  titleBlock: { gap: 4, marginBottom: tokens.spacing.sm },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titleActions: { flexDirection: "row" },
  textButton: { minHeight: 44, paddingHorizontal: tokens.spacing.sm, justifyContent: "center" },
  textButtonLabel: { fontSize: 14, fontWeight: "700", color: tokens.colors.brand },
  kicker: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: tokens.colors.brand,
    fontWeight: "700",
  },
  screenTitle: { fontSize: tokens.typography.hero, lineHeight: 36, color: tokens.colors.ink, fontWeight: "700" },
  actionBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.md,
    padding: tokens.spacing.md,
    borderRadius: tokens.radii.md,
    backgroundColor: tokens.colors.ink,
    marginBottom: tokens.spacing.sm,
  },
  actionCount: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: tokens.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  actionCountLabel: { fontSize: 18, fontWeight: "700", color: tokens.colors.ink },
  actionBody: { flex: 1 },
  actionTitle: { fontSize: tokens.typography.body, fontWeight: "700", color: tokens.colors.surface },
  actionMeta: { fontSize: 13, color: tokens.colors.surfaceMuted, marginTop: 2 },
  actionButton: {
    minHeight: 44,
    paddingHorizontal: tokens.spacing.md,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  actionButtonLabel: { fontSize: 14, fontWeight: "700", color: tokens.colors.ink },
  sectionHeader: {
    fontSize: tokens.typography.caption,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: tokens.colors.muted,
    marginTop: tokens.spacing.sm,
  },
  sectionHeaderAccent: { color: tokens.colors.brand },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.md,
    padding: tokens.spacing.md,
    borderRadius: tokens.radii.md,
    borderLeftWidth: 5,
    backgroundColor: tokens.colors.surface,
  },
  rowMuted: { opacity: 0.65 },
  rowSelected: { backgroundColor: tokens.colors.brandTint },
  rowDate: { width: 48, alignItems: "flex-start" },
  rowWeekday: {
    fontSize: tokens.typography.caption,
    fontWeight: "700",
    color: tokens.colors.muted,
    textTransform: "uppercase",
  },
  rowDay: { fontSize: 26, lineHeight: 28, fontWeight: "700", color: tokens.colors.ink },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 18, fontWeight: "700", color: tokens.colors.ink },
  rowMeta: { fontSize: 14, color: tokens.colors.muted, marginTop: 2 },
  pill: {
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: 6,
    borderRadius: tokens.radii.round,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  pillDashed: { borderStyle: "dashed", borderColor: tokens.colors.muted },
  pillLabel: { fontSize: 13, fontWeight: "700" },
  emptyBox: {
    padding: tokens.spacing.md,
    borderRadius: tokens.radii.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: tokens.colors.border,
  },
  emptyCopy: { fontSize: 14, color: tokens.colors.muted },
  weekHeader: {
    paddingHorizontal: tokens.spacing.md,
    paddingTop: tokens.spacing.sm,
    backgroundColor: tokens.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: tokens.colors.border,
  },
  weekTitle: { fontSize: 20, fontWeight: "700", color: tokens.colors.ink },
  weekCell: { height: 56 },
  monthToggle: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  daySection: { gap: tokens.spacing.xs },
  sectionHeaderPast: { opacity: 0.65 },
  pastBlock: { gap: tokens.spacing.sm, marginTop: tokens.spacing.sm },
  pastToggle: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44 },
});
