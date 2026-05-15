import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { AppNotification, UserProfile } from "../domain/models";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { SurfaceCard } from "../ui/SurfaceCard";
import { formatDateLabel, formatRelativeLabel } from "../utils/format";

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

function formatDataSourceLabel(label: string) {
  if (label === "Supabase cloud") {
    return tr("Supabase (chmura)", "Supabase cloud");
  }
  if (label === "Local fallback") {
    return tr("Lokalny fallback", "Local fallback");
  }
  if (label === "Supabase cloud (pending)") {
    return tr("Supabase (oczekiwanie)", "Supabase cloud (pending)");
  }
  if (label === "Local snapshot") {
    return tr("Lokalny snapshot", "Local snapshot");
  }
  return label;
}

function formatNotificationKindLabel(kind: AppNotification["kind"]) {
  if (kind === "attendance_reminder") {
    return tr("Ponaglenie obecnosci", "Attendance reminder");
  }
  if (kind === "event_reminder") {
    return tr("Przypomnienie wydarzenia", "Event reminder");
  }
  if (kind === "event_update") {
    return tr("Aktualizacja wydarzenia", "Event update");
  }
  if (kind === "feed_post") {
    return tr("Aktualnosc", "Feed post");
  }
  return kind;
}

export function ProfileScreen({
  currentUser,
  dataSourceLabel,
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
}) {
  const freshnessLabel = dataSourceGeneratedAt
    ? `${formatDateLabel(dataSourceGeneratedAt)} (${formatRelativeLabel(dataSourceGeneratedAt)})`
    : tr("Nieznane", "Unknown");
  const latestNotifications = notifications.slice(0, 30);

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
    >
      <SurfaceCard variant="default">
        <Text style={styles.cardEyebrow}>{tr("Profil", "Profile")}</Text>
        <Text style={styles.screenTitle}>{currentUser.fullName}</Text>
        <Text style={styles.cardSecondary}>
          {tr("Rola", "Role")}: {formatRoleLabel(currentUser.role)}
        </Text>
        <Text style={styles.cardBody}>
          {tr("Instrument główny", "Primary instrument")}:{" "}
          {currentUser.primaryInstrument ?? tr("Nieprzypisany", "Unassigned")}
        </Text>
        {signedInEmail ? (
          <Text style={styles.cardSecondary}>
            {tr("Zalogowano jako", "Signed in as")}: {signedInEmail}
          </Text>
        ) : null}
        <Text style={styles.cardSecondary}>
          {tr("Źródło danych", "Data source")}: {formatDataSourceLabel(dataSourceLabel)}
        </Text>
        <Text style={styles.cardSecondary}>
          {tr("Ostatnia synchronizacja", "Last synced")}: {freshnessLabel}
        </Text>
        {onSignOut ? (
          <Pressable style={styles.signOutButton} onPress={onSignOut}>
            <Text style={styles.signOutLabel}>{tr("Wyloguj", "Sign out")}</Text>
          </Pressable>
        ) : null}
      </SurfaceCard>

      <SurfaceCard variant="default">
        <Text style={styles.cardEyebrow}>{tr("Powiadomienia", "Notifications")}</Text>
        <Text style={styles.sectionTitle}>
          {tr("Nowe", "Unread")}: {unreadNotificationsCount}
        </Text>

        <View style={styles.notificationActionsRow}>
          <Pressable
            style={styles.actionButton}
            onPress={() => void onRefreshNotifications?.()}
            disabled={isNotificationsLoading}
          >
            <Text style={styles.actionButtonLabel}>
              {isNotificationsLoading ? tr("Odswiezanie...", "Refreshing...") : tr("Odswiez", "Refresh")}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.actionButton,
              unreadNotificationsCount === 0 && styles.actionButtonDisabled,
            ]}
            onPress={() => void onMarkAllNotificationsRead?.()}
            disabled={unreadNotificationsCount === 0 || isMarkingNotificationsRead}
          >
            <Text style={styles.actionButtonLabel}>
              {isMarkingNotificationsRead
                ? tr("Zapisywanie...", "Saving...")
                : tr("Oznacz wszystko jako przeczytane", "Mark all as read")}
            </Text>
          </Pressable>
        </View>

        {notificationsErrorMessage ? (
          <Text style={styles.errorText}>{notificationsErrorMessage}</Text>
        ) : null}

        {isNotificationsLoading && latestNotifications.length === 0 ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={tokens.colors.brand} />
            <Text style={styles.loadingLabel}>
              {tr("Wczytuje powiadomienia...", "Loading notifications...")}
            </Text>
          </View>
        ) : null}

        {!isNotificationsLoading && latestNotifications.length === 0 ? (
          <Text style={styles.emptyNotificationsLabel}>
            {tr("Brak powiadomien.", "No notifications yet.")}
          </Text>
        ) : null}

        {latestNotifications.map((notification) => {
          const isUnread = notification.readAt == null;
          const timestampLabel = formatRelativeLabel(notification.createdAt);

          return (
            <View
              key={notification.id}
              style={[
                styles.notificationRow,
                isUnread && styles.notificationRowUnread,
              ]}
            >
              <View style={styles.notificationHeaderRow}>
                <Text style={styles.notificationKindLabel}>
                  {formatNotificationKindLabel(notification.kind)}
                </Text>
                <Text style={styles.notificationMetaLabel}>{timestampLabel}</Text>
              </View>
              <Text style={styles.notificationTitle}>{notification.title}</Text>
              <Text style={styles.notificationBody}>{notification.body}</Text>
              {isUnread ? (
                <Text style={styles.notificationUnreadLabel}>
                  {tr("Nowe", "New")}
                </Text>
              ) : null}
            </View>
          );
        })}
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
  cardEyebrow: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: tokens.colors.muted,
    marginBottom: tokens.spacing.xs,
    fontWeight: "700",
  },
  screenTitle: {
    fontSize: tokens.typography.hero,
    lineHeight: 34,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  cardSecondary: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    color: tokens.colors.muted,
  },
  cardBody: {
    marginTop: tokens.spacing.sm,
    fontSize: tokens.typography.body,
    lineHeight: 23,
    color: tokens.colors.ink,
  },
  sectionTitle: {
    fontSize: tokens.typography.body,
    lineHeight: 22,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  notificationActionsRow: {
    marginTop: tokens.spacing.sm,
    flexDirection: "row",
    gap: tokens.spacing.xs,
    flexWrap: "wrap",
  },
  actionButton: {
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.xs,
    borderRadius: tokens.radii.round,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    backgroundColor: tokens.colors.surfaceMuted,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionButtonLabel: {
    color: tokens.colors.ink,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
  },
  loadingRow: {
    marginTop: tokens.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
  },
  loadingLabel: {
    color: tokens.colors.muted,
    fontSize: tokens.typography.caption,
  },
  emptyNotificationsLabel: {
    marginTop: tokens.spacing.md,
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
  },
  notificationRow: {
    marginTop: tokens.spacing.md,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.sm,
    backgroundColor: tokens.colors.surface,
    gap: 4,
  },
  notificationRowUnread: {
    borderColor: tokens.colors.brand,
    backgroundColor: tokens.colors.brandTint,
  },
  notificationHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.spacing.sm,
  },
  notificationKindLabel: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  notificationMetaLabel: {
    fontSize: 11,
    color: tokens.colors.muted,
  },
  notificationTitle: {
    fontSize: tokens.typography.body,
    lineHeight: 21,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  notificationBody: {
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    color: tokens.colors.ink,
  },
  notificationUnreadLabel: {
    marginTop: 2,
    alignSelf: "flex-start",
    fontSize: 11,
    lineHeight: 14,
    color: tokens.colors.successInk,
    fontWeight: "700",
  },
  errorText: {
    marginTop: tokens.spacing.sm,
    color: tokens.colors.dangerInk,
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    fontWeight: "700",
  },
  signOutButton: {
    marginTop: tokens.spacing.md,
    alignSelf: "flex-start",
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: tokens.colors.border,
  },
  signOutLabel: {
    color: tokens.colors.ink,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
});
