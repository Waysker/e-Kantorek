import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import type { AppNotification, UserProfile } from "../domain/models";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { textStyles } from "../theme/text";
import { Icon } from "../ui/Icon";
import { Notice } from "../ui/Notice";
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
}) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= tokens.breakpoints.desktop;
  const latestNotifications = notifications.slice(0, 30);
  const instrument = currentUser.primaryInstrument ?? tr("Bez instrumentu", "No instrument");

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

      {onOpenOrchestraAttendance ? (
        <View style={styles.card}>
          <Pressable
            onPress={onOpenOrchestraAttendance}
            accessibilityRole="button"
            style={styles.settingRow}
          >
            <Text style={styles.settingLabel}>{tr("Obecność orkiestry", "Orchestra attendance")}</Text>
            <Icon name="chevronRight" size={18} color={tokens.colors.muted} />
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
            <ActivityIndicator color={tokens.colors.brand} />
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

const styles = StyleSheet.create({
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
    backgroundColor: tokens.colors.brandDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLabel: {
    fontSize: 22,
    fontWeight: "800",
    color: tokens.colors.surface,
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
    color: tokens.colors.ink,
  },
  muted: {
    fontSize: 14,
    lineHeight: 20,
    color: tokens.colors.muted,
  },
  card: {
    backgroundColor: tokens.colors.surface,
    borderWidth: 1,
    borderColor: tokens.colors.border,
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
  link: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.colors.brand,
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
    borderTopColor: tokens.colors.surfaceMuted,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    backgroundColor: "transparent",
  },
  dotUnread: {
    backgroundColor: tokens.colors.warningBorder,
  },
  notificationText: {
    flex: 1,
    gap: 3,
  },
  notificationTitle: {
    fontSize: 15,
    lineHeight: 21,
    color: tokens.colors.ink,
  },
  notificationKind: {
    fontWeight: "700",
  },
  notificationBody: {
    fontSize: 14,
    lineHeight: 20,
    color: tokens.colors.neutralInk,
  },
  meta: {
    fontSize: 12,
    color: tokens.colors.muted,
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
    color: tokens.colors.ink,
  },
  settingValue: {
    flexShrink: 1,
    fontSize: 14,
    color: tokens.colors.muted,
  },
  signOut: {
    fontSize: 15,
    fontWeight: "600",
    color: tokens.colors.dangerInk,
  },
  footnote: {
    fontSize: 12,
    color: tokens.colors.muted,
    textAlign: "center",
  },
});
