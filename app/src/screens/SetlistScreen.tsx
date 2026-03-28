import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { EventDetail } from "../domain/models";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";

type SetlistScreenProps = {
  event: EventDetail;
  onBack: () => void;
};

export function SetlistScreen({ event, onBack }: SetlistScreenProps) {
  const shouldScroll = event.setlist.modeHint === "scroll";
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.readerBackdrop}>
      <View
        style={[
          styles.readerHeader,
          { paddingTop: Math.max(tokens.spacing.sm, insets.top + tokens.spacing.xs) },
        ]}
      >
        <Pressable onPress={onBack} style={styles.readerBackButton}>
          <Text style={styles.readerBackLabel}>{tr("Zamknij", "Close")}</Text>
        </Pressable>
        <Text style={styles.readerMeta}>{event.title}</Text>
      </View>

      <View
        style={[styles.readerOuter, { paddingBottom: tokens.spacing.lg + insets.bottom }]}
      >
        <ScrollView
          style={styles.readerPage}
          contentContainerStyle={styles.readerPageContent}
          showsVerticalScrollIndicator={shouldScroll}
          scrollEnabled={shouldScroll}
        >
          <Text style={styles.readerTitle}>Setlista</Text>
          {event.setlist.sections.map((section) => (
            <View key={section.id} style={styles.readerSection}>
              <Text style={styles.readerSectionTitle}>{section.title}</Text>
              {section.items.map((item, itemIndex) => (
                <Text key={item.id} style={styles.readerLine}>
                  {itemIndex + 1}. {item.label}
                  {item.detail ? ` (${item.detail})` : ""}
                </Text>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readerBackdrop: {
    flex: 1,
    backgroundColor: tokens.colors.readerBackdrop,
  },
  readerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.spacing.lg,
    paddingBottom: tokens.spacing.md,
  },
  readerBackButton: {
    paddingVertical: tokens.spacing.sm,
    paddingHorizontal: tokens.spacing.md,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.readerChrome,
  },
  readerBackLabel: {
    color: tokens.colors.surface,
    fontWeight: "700",
  },
  readerMeta: {
    flex: 1,
    marginLeft: tokens.spacing.md,
    fontSize: tokens.typography.caption,
    color: tokens.colors.readerMeta,
    textAlign: "right",
  },
  readerOuter: {
    flex: 1,
    paddingHorizontal: tokens.spacing.lg,
    paddingBottom: tokens.spacing.lg,
  },
  readerPage: {
    flex: 1,
    borderRadius: tokens.radii.xl,
    backgroundColor: tokens.colors.readerPage,
  },
  readerPageContent: {
    paddingHorizontal: tokens.spacing.xl,
    paddingVertical: tokens.spacing.xl,
    gap: tokens.spacing.md,
  },
  readerTitle: {
    fontSize: tokens.typography.title,
    fontWeight: "700",
    color: tokens.colors.readerInk,
  },
  readerSection: {
    gap: tokens.spacing.xs,
  },
  readerSectionTitle: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: tokens.colors.readerInk,
    fontWeight: "700",
  },
  readerLine: {
    fontSize: 17,
    lineHeight: 23,
    color: tokens.colors.readerInk,
  },
});
