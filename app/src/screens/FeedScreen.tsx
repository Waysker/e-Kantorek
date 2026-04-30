import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import type { FeedPost, UserProfile } from "../domain/models";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { formatRelativeLabel } from "../utils/format";
import { SurfaceCard } from "../ui/SurfaceCard";

type FeedScreenProps = {
  currentUser: UserProfile;
  feedPosts: FeedPost[];
  onOpenEvents: () => void;
};

function formatRoleLabel(role: UserProfile["role"]) {
  if (role === "admin") {
    return tr("Administrator", "Admin");
  }
  if (role === "board") {
    return tr("Zarząd", "Board");
  }
  if (role === "section") {
    return tr("Sekcyjne", "Section leader");
  }
  return tr("Członek", "Member");
}

export function FeedScreen({
  currentUser,
  feedPosts,
  onOpenEvents,
}: FeedScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={[
        styles.screenContent,
        isDesktop && styles.desktopContent,
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.screenHeaderRow}>
        <View style={styles.screenHeaderBlock}>
          <Text style={styles.kicker}>ORAGH</Text>
          <Text style={styles.screenTitle}>Orkiestra Reprezentacyjna AGH</Text>
          <Text style={styles.screenSubtitle}>
            {tr(
              "Aktualności to strona główna. W tym etapie dane wydarzeń pochodzą jeszcze z forum, a posty feedu z lokalnych danych testowych.",
              "Feed stays the front door, but this first prototype is only backed by live forum-style event data and local feed fixtures.",
            )}
          </Text>
        </View>

        <Pressable style={styles.quietAction}>
          <Text style={styles.quietActionLabel}>{tr("Napisz post", "Write post")}</Text>
        </Pressable>
      </View>

      <SurfaceCard variant="muted">
        <Text style={styles.cardEyebrow}>{tr("Aktualny etap", "Current phase")}</Text>
        <Pressable onPress={onOpenEvents} style={styles.linkAction}>
          <Text style={styles.linkActionLabel}>
            {tr("Przejdź do wydarzeń", "Review event prototype")}
          </Text>
        </Pressable>
      </SurfaceCard>

      {feedPosts.map((post) => (
        <SurfaceCard
          key={post.id}
          variant={post.isPinned ? "brandTint" : "default"}
        >
          <View style={styles.feedMetaRow}>
            <Text style={styles.feedMetaAuthor}>{post.authorName}</Text>
            <Text style={styles.feedMetaDot}>-</Text>
            <Text style={styles.feedMetaTime}>
              {formatRelativeLabel(post.createdAt)}
            </Text>
            {post.isPinned ? (
              <>
                <Text style={styles.feedMetaDot}>-</Text>
                <Text style={styles.pinnedLabel}>{tr("Przypięty", "Pinned")}</Text>
              </>
            ) : null}
          </View>
          {post.title ? <Text style={styles.feedPostTitle}>{post.title}</Text> : null}
          <Text style={styles.cardBody}>{post.body}</Text>
          <Text style={styles.feedMetaFooter}>
            {post.kindLabel} - {post.commentCount} {tr("komentarzy", "comments")}
          </Text>
        </SurfaceCard>
      ))}

      <SurfaceCard variant="outline">
        <Text style={styles.cardEyebrow}>{tr("Zalogowano jako", "Signed in as")}</Text>
        <Text style={styles.cardTitle}>{currentUser.fullName}</Text>
        <Text style={styles.cardBody}>
          {tr("Instrument główny", "Primary instrument")}:{" "}
          {currentUser.primaryInstrument ?? tr("Nieprzypisany", "Unassigned")}.{" "}
          {tr("Rola", "Role")}: {formatRoleLabel(currentUser.role)}.
        </Text>
      </SurfaceCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screenScroll: {
    flex: 1,
  },
  screenContent: {
    padding: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  desktopContent: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 1200,
  },
  screenHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: tokens.spacing.md,
  },
  screenHeaderBlock: {
    flex: 1,
    gap: tokens.spacing.xs,
  },
  kicker: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  screenTitle: {
    fontSize: tokens.typography.hero,
    lineHeight: 34,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  screenSubtitle: {
    fontSize: tokens.typography.body,
    lineHeight: 22,
    color: tokens.colors.muted,
  },
  quietAction: {
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.surfaceMuted,
  },
  quietActionLabel: {
    color: tokens.colors.brand,
    fontWeight: "700",
  },
  cardEyebrow: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: tokens.colors.muted,
    marginBottom: tokens.spacing.xs,
    fontWeight: "700",
  },
  cardTitle: {
    fontSize: tokens.typography.title,
    lineHeight: 28,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  cardBody: {
    marginTop: tokens.spacing.sm,
    fontSize: tokens.typography.body,
    lineHeight: 23,
    color: tokens.colors.ink,
  },
  linkAction: {
    marginTop: tokens.spacing.md,
  },
  linkActionLabel: {
    color: tokens.colors.brand,
    fontWeight: "700",
  },
  feedMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.spacing.xs,
  },
  feedMetaAuthor: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  feedMetaTime: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
  },
  feedMetaDot: {
    color: tokens.colors.muted,
  },
  pinnedLabel: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.brand,
    fontWeight: "700",
  },
  feedPostTitle: {
    marginTop: tokens.spacing.sm,
    fontSize: tokens.typography.title,
    lineHeight: 26,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  feedMetaFooter: {
    marginTop: tokens.spacing.md,
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
  },
});
