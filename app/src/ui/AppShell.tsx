import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import type { PrimaryTab } from "../navigation/routes";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { DataFreshnessBanner } from "./DataFreshnessBanner";
import { Icon, type IconName } from "./Icon";

type AppShellProps = {
  tabs: PrimaryTab[];
  activeTab: PrimaryTab;
  tabBadges?: Partial<Record<PrimaryTab, number>>;
  hideNavigation?: boolean;
  dataSourceLabel: string;
  dataSourceGeneratedAt: string | null;
  expectedSyncIntervalHours?: number;
  alertBanner?: ReactNode;
  onNavigate: (tab: PrimaryTab) => void;
  children: ReactNode;
};

function getTabLabel(tab: PrimaryTab): string {
  if (tab === "events") {
    return tr("Wydarzenia", "Events");
  }
  if (tab === "calendar") {
    return tr("Kalendarz", "Calendar");
  }
  if (tab === "board") {
    return tr("Zarząd", "Board");
  }
  return tr("Ja", "Me");
}

function getTabIcon(tab: PrimaryTab): IconName {
  if (tab === "events") {
    return "list";
  }
  if (tab === "calendar") {
    return "calendar";
  }
  if (tab === "board") {
    return "board";
  }
  return "user";
}

function formatBadge(count: number) {
  return count > 99 ? "99+" : String(count);
}

export function AppShell({
  tabs,
  activeTab,
  tabBadges,
  hideNavigation,
  dataSourceLabel,
  dataSourceGeneratedAt,
  expectedSyncIntervalHours,
  alertBanner,
  onNavigate,
  children,
}: AppShellProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isDesktop = width >= tokens.breakpoints.desktop;

  const freshnessBanner = (
    <DataFreshnessBanner
      dataSourceLabel={dataSourceLabel}
      dataSourceGeneratedAt={dataSourceGeneratedAt}
      expectedSyncIntervalHours={expectedSyncIntervalHours}
    />
  );

  if (hideNavigation) {
    return (
      <View style={styles.immersiveRoot}>
        {freshnessBanner}
        {alertBanner}
        <View style={styles.immersiveContent}>{children}</View>
      </View>
    );
  }

  if (isDesktop) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.desktopLayout}>
          <View style={styles.sidebar}>
            <View style={styles.brandBlock}>
              <Text style={styles.brandName}>e-Kantorek</Text>
              <Text style={styles.brandSubtitle}>Orkiestra Reprezentacyjna AGH</Text>
            </View>
            <View style={styles.sidebarNav} accessibilityRole="tablist">
              {tabs.map((tab) => {
                const isActive = tab === activeTab;
                const badgeCount = tabBadges?.[tab] ?? 0;
                const color = isActive ? tokens.colors.successInk : tokens.colors.neutralInk;

                return (
                  <Pressable
                    key={tab}
                    onPress={() => onNavigate(tab)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isActive }}
                    style={(state) => [
                      styles.sidebarLink,
                      // `hovered` exists on react-native-web only.
                      (state as { hovered?: boolean }).hovered &&
                        !isActive &&
                        styles.sidebarLinkHovered,
                      isActive && styles.sidebarLinkActive,
                    ]}
                  >
                    <Icon name={getTabIcon(tab)} size={20} color={color} />
                    <Text style={[styles.sidebarLinkLabel, { color }]}>{getTabLabel(tab)}</Text>
                    {badgeCount > 0 ? (
                      <View style={[styles.navBadge, styles.navBadgeSidebar]}>
                        <Text style={styles.navBadgeLabel}>{formatBadge(badgeCount)}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.desktopMain}>
            {freshnessBanner}
            {alertBanner}
            <View style={styles.desktopContent}>{children}</View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.mobileLayout}>
        {freshnessBanner}
        {alertBanner}
        <View style={styles.mobileContent}>{children}</View>
      </View>
      <View
        style={[styles.bottomNav, { paddingBottom: tokens.spacing.xs + insets.bottom }]}
        accessibilityRole="tablist"
      >
        {tabs.map((tab) => {
          const isActive = tab === activeTab;
          const badgeCount = tabBadges?.[tab] ?? 0;
          const color = isActive ? tokens.colors.brand : tokens.colors.muted;

          return (
            <Pressable
              key={tab}
              onPress={() => onNavigate(tab)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={
                badgeCount > 0 ? `${getTabLabel(tab)}, ${badgeCount}` : getTabLabel(tab)
              }
              style={styles.bottomNavItem}
            >
              <View>
                <Icon name={getTabIcon(tab)} size={22} color={color} />
                {badgeCount > 0 ? (
                  <View style={[styles.navBadge, styles.navBadgeBottom]}>
                    <Text style={styles.navBadgeLabel}>{formatBadge(badgeCount)}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.bottomNavLabel, { color }]}>{getTabLabel(tab)}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.colors.background,
  },
  immersiveRoot: {
    flex: 1,
    backgroundColor: tokens.colors.readerBackdrop,
  },
  immersiveContent: {
    flex: 1,
  },
  desktopLayout: {
    flex: 1,
    flexDirection: "row",
  },
  sidebar: {
    width: 240,
    borderRightWidth: 1,
    borderRightColor: tokens.colors.border,
    paddingHorizontal: 14,
    paddingVertical: tokens.spacing.lg,
    gap: tokens.spacing.lg,
    backgroundColor: tokens.colors.surface,
  },
  brandBlock: {
    paddingHorizontal: 12,
    gap: 2,
  },
  brandName: {
    fontSize: tokens.typography.title,
    fontWeight: "800",
    letterSpacing: -0.3,
    color: tokens.colors.ink,
  },
  brandSubtitle: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
  },
  sidebarNav: {
    gap: 2,
  },
  sidebarLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: tokens.radii.sm,
  },
  sidebarLinkHovered: {
    backgroundColor: tokens.colors.surfaceMuted,
  },
  sidebarLinkActive: {
    backgroundColor: tokens.colors.brandTint,
  },
  sidebarLinkLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  navBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: tokens.radii.round,
    backgroundColor: tokens.colors.warningBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  navBadgeSidebar: {
    marginLeft: "auto",
  },
  navBadgeBottom: {
    position: "absolute",
    top: -6,
    right: -12,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
  },
  navBadgeLabel: {
    fontSize: 11,
    lineHeight: 13,
    color: tokens.colors.surface,
    fontWeight: "700",
  },
  desktopMain: {
    flex: 1,
  },
  desktopContent: {
    flex: 1,
  },
  mobileLayout: {
    flex: 1,
  },
  mobileContent: {
    flex: 1,
  },
  bottomNav: {
    flexDirection: "row",
    alignItems: "stretch",
    borderTopWidth: 1,
    borderTopColor: tokens.colors.border,
    backgroundColor: tokens.colors.surface,
  },
  bottomNavItem: {
    flex: 1,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingTop: tokens.spacing.xs,
  },
  bottomNavLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
});
