import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";

import type { ForumIdentity } from "../domain/forumIdentity";
import type { AppNotification, UserProfile } from "../domain/models";
import { tr } from "../i18n";
import { colors, themedStyles, useTheme, type ThemePreference } from "../theme/theme";
import { tokens } from "../theme/tokens";
import { textStyles } from "../theme/text";
import { Icon } from "../ui/Icon";
import { Notice } from "../ui/Notice";
import { SegmentedControl } from "../ui/SegmentedControl";
import { formatRelativeLabel } from "../utils/format";

function formatRoleLabel(role: UserProfile["role"]) {
  if (role === "admin") {
    return tr("Administrator", "Admin");
  }
  if (role === "board") {
    return tr("Zarząd", "Board");
  }
  if (role === "section") {
    return tr("Sekcyjny", "Section leader");
  }
  return tr("Członek", "Member");
}

function formatNotificationKindLabel(kind: AppNotification["kind"]) {
  if (kind === "attendance_reminder") {
    return tr("Ponaglenie", "Reminder");
  }
  if (kind === "event_reminder") {
    return tr("Przypomnienie", "Event reminder");
  }
  if (kind === "event_update") {
    return tr("Aktualizacja", "Event update");
  }
  if (kind === "feed_post") {
    return tr("Aktualność", "Post");
  }
  return kind;
}

function initialsOf(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

export function ProfileScreen({
  currentUser,
  dataSourceGeneratedAt,
  notifications,
  unreadNotificationsCount,
  notificationsErrorMessage,
  isNotificationsLoading,
  isMarkingNotificationsRead,
  onRefreshNotifications,
  onMarkAllNotificationsRead,
  signedInEmail,
  onSignOut,
  onOpenOrchestraAttendance,
  forumIdentity,
  forumIdentityEditor,
  onChangeForumIdentity,
}: {
  currentUser: UserProfile;
  dataSourceLabel: string;
  dataSourceGeneratedAt: string | null;
  notifications: AppNotification[];
  unreadNotificationsCount: number;
  notificationsErrorMessage?: string | null;
  isNotificationsLoading?: boolean;
  isMarkingNotificationsRead?: boolean;
  onRefreshNotifications?: () => Promise<void> | void;
  onMarkAllNotificationsRead?: () => Promise<void> | void;
  signedInEmail?: string | null;
  onSignOut?: () => Promise<void>;
  /** Opens the attendance summary of the whole orchestra (read-only for members). */
  onOpenOrchestraAttendance?: () => void;
  /** The account's link to a forum person ("Konto na forum"). */
  forumIdentity?: ForumIdentity;
  /** The ForumIdentityPrompt while the member changes the link. */
  forumIdentityEditor?: ReactNode;
  onChangeForumIdentity?: () => void;
}) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;
  const latestNotifications = notifications.slice(0, 30);
  const instrument = currentUser.primaryInstrument ?? tr("Bez instrumentu", "No instrument");
  const { preference, setPreference } = useTheme();

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={[styles.content, isDesktop && styles.contentDesktop]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.identity}>
        <View style={styles.avatar} aria-hidden>
          <Text style={styles.avatarLabel}>{initialsOf(currentUser.fullName)}</Text>
        </View>
        <View style={styles.identityText}>
          <Text style={styles.name}>{currentUser.fullName}</Text>
          <Text style={styles.muted}>
            {instrument} · {formatRoleLabel(currentUser.role)}
          </Text>
        </View>
      </View>

      {forumIdentityEditor ? (
        forumIdentityEditor
      ) : forumIdentity && (forumIdentity.kind === "linked" || forumIdentity.kind === "no_forum_account") ? (
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.forumIdentityText}>
              <Text style={styles.kicker}>{tr("Konto na forum", "Forum account")}</Text>
              <Text style={styles.settingLabel}>
                {forumIdentity.kind === "linked"
                  ? forumIdentity.forumFullName
                  : tr("Bez konta na forum", "No forum account")}
              </Text>
              {forumIdentity.kind === "linked" && forumIdentity.status === "proposed" ? (
                <Text style={styles.muted}>{tr("Zarząd jeszcze to potwierdzi.", "The board will confirm it.")}</Text>
              ) : null}
            </View>
            {onChangeForumIdentity ? (
              <Pressable onPress={onChangeForumIdentity} accessibilityRole="button" hitSlop={8} style={styles.forumIdentityChange}>
                <Text style={styles.forumIdentityChangeLabel}>{tr("Zmień", "Change")}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {onOpenOrchestraAttendance ? (
        <View style={styles.card}>
          <Pressable
            onPress={onOpenOrchestraAttendance}
            accessibilityRole="button"
            style={styles.settingRow}
          >
            <Text style={styles.settingLabel}>{tr("Obecność orkiestry", "Orchestra attendance")}</Text>
            <Icon name="chevronRight" size={18} color={colors.muted} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.kicker}>
            {tr("Powiadomienia", "Notifications")}
            {unreadNotificationsCount > 0
              ? tr(` · ${unreadNotificationsCount} nowe`, ` · ${unreadNotificationsCount} new`)
              : ""}
          </Text>
          <View style={styles.cardActions}>
            {unreadNotificationsCount > 0 ? (
              <Pressable
                onPress={() => void onMarkAllNotificationsRead?.()}
                disabled={isMarkingNotificationsRead}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text style={styles.link}>
                  {isMarkingNotificationsRead
                    ? tr("Zapisywanie…", "Saving…")
                    : tr("Oznacz jako przeczytane", "Mark as read")}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => void onRefreshNotifications?.()}
              disabled={isNotificationsLoading}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={styles.link}>
                {isNotificationsLoading ? tr("Odświeżanie…", "Refreshing…") : tr("Odśwież", "Refresh")}
              </Text>
            </Pressable>
          </View>
        </View>

        {notificationsErrorMessage ? (
          <View style={styles.noticeWrap}>
            <Notice tone="error">{notificationsErrorMessage}</Notice>
          </View>
        ) : null}

        {isNotificationsLoading && latestNotifications.length === 0 ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.brand} />
            <Text style={styles.muted}>{tr("Wczytuję powiadomienia…", "Loading notifications…")}</Text>
          </View>
        ) : null}

        {!isNotificationsLoading && latestNotifications.length === 0 ? (
          <Text style={styles.muted}>{tr("Brak powiadomień.", "No notifications yet.")}</Text>
        ) : null}

        {latestNotifications.map((notification, index) => {
          const isUnread = notification.readAt == null;
          return (
            <View
              key={notification.id}
              style={[styles.notification, index > 0 && styles.rowDivider]}
              accessibilityLabel={isUnread ? tr("Nowe powiadomienie", "New notification") : undefined}
            >
              <View style={[styles.dot, isUnread && styles.dotUnread]} />
              <View style={styles.notificationText}>
                <Text style={styles.notificationTitle}>
                  {/* Skip the kind when the title already starts with it ("Ponaglenie obecności"). */}
                  {notification.title
                    .toLowerCase()
                    .startsWith(formatNotificationKindLabel(notification.kind).toLowerCase()) ? null : (
                    <Text style={styles.notificationKind}>
                      {formatNotificationKindLabel(notification.kind)}:{" "}
                    </Text>
                  )}
                  {notification.title}
                </Text>
                {notification.body ? (
                  <Text style={styles.notificationBody} numberOfLines={3}>
                    {notification.body}
                  </Text>
                ) : null}
                <Text style={styles.meta}>{formatRelativeLabel(notification.createdAt)}</Text>
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.card}>
        <Text style={styles.kicker}>
          {tr("Wygląd", "Appearance")}
        </Text>
        <SegmentedControl<ThemePreference>
          accessibilityLabel={tr("Wygląd", "Appearance")}
          options={[
            { key: "system", label: tr("Systemowy", "System") },
            { key: "light", label: tr("Jasny", "Light") },
            { key: "dark", label: tr("Ciemny", "Dark") },
          ]}
          value={preference}
          onChange={setPreference}
        />
      </View>

      <View style={styles.card}>
        {signedInEmail ? (
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{tr("Konto", "Account")}</Text>
            <Text style={styles.settingValue} numberOfLines={1}>
              {signedInEmail}
            </Text>
          </View>
        ) : null}
        {onSignOut ? (
          <Pressable
            onPress={onSignOut}
            accessibilityRole="button"
            style={[styles.settingRow, signedInEmail ? styles.rowDivider : null]}
          >
            <Text style={styles.signOut}>{tr("Wyloguj", "Sign out")}</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.footnote}>
        {dataSourceGeneratedAt
          ? tr(
              `Dane z forum zsynchronizowane ${formatRelativeLabel(dataSourceGeneratedAt)}`,
              `Forum data synced ${formatRelativeLabel(dataSourceGeneratedAt)}`,
            )
          : tr("Nie wiemy, kiedy ostatnio zsynchronizowano dane z forum.", "Last forum sync time unknown.")}
      </Text>
    </ScrollView>
  );
}

const styles = themedStyles((colors) => ({
  screenScroll: {
    flex: 1,
  },
  content: {
    padding: tokens.spacing.md,
    paddingTop: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  contentDesktop: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    paddingHorizontal: tokens.spacing.xl,
    paddingTop: tokens.spacing.xl,
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.brandDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLabel: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.onStrong,
  },
  identityText: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: "800",
    letterSpacing: -0.3,
    color: colors.ink,
  },
  muted: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: tokens.radii.lg,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: tokens.spacing.sm,
    paddingVertical: 8,
  },
  cardActions: {
    flexDirection: "row",
    gap: tokens.spacing.md,
  },
  kicker: textStyles.kicker,
  forumIdentityText: {
    flex: 1,
    gap: 2,
  },
  forumIdentityChange: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    alignItems: "flex-end",
  },
  forumIdentityChangeLabel: {
    fontSize: tokens.typography.body,
    fontWeight: "600",
    color: colors.brand,
  },
  link: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.brand,
  },
  noticeWrap: {
    marginBottom: 8,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
    paddingVertical: 10,
  },
  notification: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 12,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.surfaceMuted,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    backgroundColor: "transparent",
  },
  dotUnread: {
    backgroundColor: colors.warningBorder,
  },
  notificationText: {
    flex: 1,
    gap: 3,
  },
  notificationTitle: {
    fontSize: 15,
    lineHeight: 21,
    color: colors.ink,
  },
  notificationKind: {
    fontWeight: "700",
  },
  notificationBody: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.neutralInk,
  },
  meta: {
    fontSize: 12,
    color: colors.muted,
  },
  settingRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacing.sm,
  },
  settingLabel: {
    fontSize: 15,
    color: colors.ink,
  },
  settingValue: {
    flexShrink: 1,
    fontSize: 14,
    color: colors.muted,
  },
  signOut: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.dangerInk,
  },
  footnote: {
    fontSize: 12,
    color: colors.muted,
    textAlign: "center",
  },
}));
