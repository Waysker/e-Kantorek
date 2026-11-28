import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { EventDetail } from "../domain/models";
import { cleanSetlistLabel, isPlaceholderSetlist } from "../domain/setlist";
import { tr } from "../i18n";
import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";
import { formatDateLabel, stripTitleDatePrefix } from "../utils/format";

type SetlistScreenProps = {
  event: EventDetail;
  onBack: () => void;
};

// Text sizes for reading on a music stand; the musician picks one with A− / A+.
const TEXT_SIZES = [20, 24, 30, 36] as const;
const DEFAULT_SIZE_INDEX = 1;

// "Stand mode": a dark frame with a paper page, big numbered titles and
// adjustable text size, meant to be read from a phone or tablet on the stand.
export function SetlistScreen({ event, onBack }: SetlistScreenProps) {
  const insets = useSafeAreaInsets();
  const [sizeIndex, setSizeIndex] = useState(DEFAULT_SIZE_INDEX);
  const fontSize = TEXT_SIZES[sizeIndex];
  const isPlaceholder = isPlaceholderSetlist(event.setlist);
  const showSectionTitles = event.setlist.sections.length > 1;
  let runningNumber = 0;

  return (
    <View style={styles.backdrop}>
      <View
        style={[
          styles.header,
          { paddingTop: Math.max(tokens.spacing.sm, insets.top + tokens.spacing.xs) },
        ]}
      >
        <Pressable
          onPress={onBack}
          style={styles.chromeButton}
          accessibilityRole="button"
          accessibilityLabel={tr("Zamknij setlistę", "Close setlist")}
        >
          <Text style={styles.closeGlyph}>✕</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {stripTitleDatePrefix(event.title)}
          </Text>
          <Text style={styles.headerMeta} numberOfLines={1}>
            {tr("Setlista", "Setlist")} · {formatDateLabel(event.startsAt)}
          </Text>
        </View>
        <View style={styles.sizeControls}>
          <Pressable
            onPress={() => setSizeIndex((index) => Math.max(0, index - 1))}
            disabled={sizeIndex === 0}
            style={[styles.chromeButton, sizeIndex === 0 && styles.chromeButtonDisabled]}
            accessibilityRole="button"
            accessibilityLabel={tr("Mniejszy tekst", "Smaller text")}
          >
            <Text style={styles.sizeLabelSmall}>A−</Text>
          </Pressable>
          <Pressable
            onPress={() => setSizeIndex((index) => Math.min(TEXT_SIZES.length - 1, index + 1))}
            disabled={sizeIndex === TEXT_SIZES.length - 1}
            style={[
              styles.chromeButton,
              sizeIndex === TEXT_SIZES.length - 1 && styles.chromeButtonDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={tr("Większy tekst", "Larger text")}
          >
            <Text style={styles.sizeLabelLarge}>A+</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.outer, { paddingBottom: tokens.spacing.md + insets.bottom }]}>
        <ScrollView
          style={styles.page}
          contentContainerStyle={styles.pageContent}
          showsVerticalScrollIndicator
        >
          {isPlaceholder ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                {tr("Setlisty jeszcze nie ma", "No setlist yet")}
              </Text>
              <Text style={styles.emptyCopy}>
                {tr(
                  "Pojawi się tutaj, gdy organizator wrzuci ją do wątku na forum.",
                  "It appears here once the organizer posts it in the forum thread.",
                )}
              </Text>
            </View>
          ) : (
            event.setlist.sections.map((section) => (
              <View key={section.id} style={styles.section}>
                {showSectionTitles ? <Text style={styles.sectionTitle}>{section.title}</Text> : null}
                {section.items.map((item) => {
                  runningNumber += 1;
                  return (
                    <View key={item.id} style={styles.row}>
                      <Text
                        style={[
                          styles.number,
                          { fontSize: Math.round(fontSize * 0.8), lineHeight: Math.round(fontSize * 1.3) },
                        ]}
                      >
                        {runningNumber}
                      </Text>
                      <View style={styles.rowText}>
                        <Text style={[styles.itemLabel, { fontSize, lineHeight: Math.round(fontSize * 1.3) }]}>
                          {cleanSetlistLabel(item.label)}
                        </Text>
                        {item.detail ? (
                          <Text style={[styles.itemDetail, { fontSize: Math.round(fontSize * 0.65) }]}>
                            {item.detail}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: colors.readerBackdrop,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
    paddingHorizontal: tokens.spacing.md,
    paddingBottom: tokens.spacing.sm,
  },
  chromeButton: {
    minWidth: 44,
    height: 44,
    paddingHorizontal: 10,
    borderRadius: tokens.radii.md,
    backgroundColor: colors.readerChrome,
    alignItems: "center",
    justifyContent: "center",
  },
  chromeButtonDisabled: {
    opacity: 0.4,
  },
  closeGlyph: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.onStrong,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.onStrong,
  },
  headerMeta: {
    fontSize: 12,
    color: colors.readerMeta,
  },
  sizeControls: {
    flexDirection: "row",
    gap: 6,
  },
  sizeLabelSmall: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.onStrong,
  },
  sizeLabelLarge: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.onStrong,
  },
  outer: {
    flex: 1,
    paddingHorizontal: tokens.spacing.sm,
  },
  page: {
    flex: 1,
    width: "100%",
    maxWidth: 860,
    alignSelf: "center",
    borderRadius: tokens.radii.lg,
    backgroundColor: colors.readerPage,
  },
  pageContent: {
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.lg,
    gap: tokens.spacing.lg,
  },
  section: {
    gap: 2,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.brand,
    marginBottom: tokens.spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#ECE6DA",
  },
  number: {
    minWidth: 32,
    textAlign: "right",
    fontWeight: "700",
    color: colors.brand,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  itemLabel: {
    fontWeight: "700",
    color: colors.readerInk,
  },
  itemDetail: {
    color: colors.muted,
  },
  empty: {
    paddingVertical: tokens.spacing.xl,
    gap: tokens.spacing.xs,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.readerInk,
  },
  emptyCopy: {
    fontSize: 15,
    textAlign: "center",
    color: colors.muted,
  },
}));
