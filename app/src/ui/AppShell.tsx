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

type AppShellProps = {
  activeTab: PrimaryTab;
  hideNavigation?: boolean;
  dataSourceLabel: string;
  dataSourceGeneratedAt: string | null;
  expectedSyncIntervalHours?: number;
  onNavigate: (tab: PrimaryTab) => void;
  children: ReactNode;
};

const tabs: { key: PrimaryTab; label: string }[] = [
  { key: "events", label: tr("Wydarzenia", "Events") },
  { key: "profile", label: tr("Profil", "Profile") },
];

export function AppShell({
  activeTab,
  hideNavigation,
  dataSourceLabel,
  dataSourceGeneratedAt,
  expectedSyncIntervalHours,
  onNavigate,
  children,
}: AppShellProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isDesktop = width >= tokens.breakpoints.desktop;

  if (hideNavigation) {
    return (
      <View style={styles.immersiveRoot}>
        <DataFreshnessBanner
          dataSourceLabel={dataSourceLabel}
          dataSourceGeneratedAt={dataSourceGeneratedAt}
          expectedSyncIntervalHours={expectedSyncIntervalHours}
        />
        <View style={styles.immersiveContent}>{children}</View>
      </View>
    );
  }

  if (isDesktop) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.desktopLayout}>
          <View style={styles.sidebar}>
            <Text style={styles.sidebarKicker}>ORAGH</Text>
            <Text style={styles.sidebarTitle}>Orkiestra Reprezentacyjna AGH</Text>
            <View style={styles.sidebarNav}>
              {tabs.map((tab) => {
                const isActive = tab.key === activeTab;

                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => onNavigate(tab.key)}
                    style={[styles.sidebarLink, isActive && styles.sidebarLinkActive]}
                  >
                    <Text
                      style={[
                        styles.sidebarLinkLabel,
                        isActive && styles.sidebarLinkLabelActive,
                      ]}
                    >
                      {tab.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.desktopMain}>
            <DataFreshnessBanner
              dataSourceLabel={dataSourceLabel}
              dataSourceGeneratedAt={dataSourceGeneratedAt}
              expectedSyncIntervalHours={expectedSyncIntervalHours}
            />
            <View style={styles.desktopContent}>{children}</View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.mobileLayout}>
        <DataFreshnessBanner
          dataSourceLabel={dataSourceLabel}
          dataSourceGeneratedAt={dataSourceGeneratedAt}
          expectedSyncIntervalHours={expectedSyncIntervalHours}
        />
        <View style={styles.mobileContent}>{children}</View>
      </View>
      <View
        style={[
          styles.bottomNav,
          { paddingBottom: tokens.spacing.sm + insets.bottom },
        ]}
      >
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;

          return (
            <Pressable
              key={tab.key}
              onPress={() => onNavigate(tab.key)}
              style={styles.bottomNavItem}
            >
              <Text
                style={[
                  styles.bottomNavLabel,
                  isActive && styles.bottomNavLabelActive,
                ]}
              >
                {tab.label}
              </Text>
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
    width: 260,
    borderRightWidth: 1,
    borderRightColor: tokens.colors.border,
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.xl,
    gap: tokens.spacing.lg,
    backgroundColor: tokens.colors.surface,
  },
  sidebarKicker: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  sidebarTitle: {
    fontSize: tokens.typography.title,
    lineHeight: 28,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  sidebarNav: {
    gap: tokens.spacing.sm,
  },
  sidebarLink: {
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radii.md,
  },
  sidebarLinkActive: {
    backgroundColor: tokens.colors.brandTint,
  },
  sidebarLinkLabel: {
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  sidebarLinkLabelActive: {
    color: tokens.colors.brand,
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
    justifyContent: "space-around",
    alignItems: "center",
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: tokens.colors.border,
    backgroundColor: tokens.colors.surface,
  },
  bottomNavItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: tokens.spacing.sm,
  },
  bottomNavLabel: {
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
    fontWeight: "700",
  },
  bottomNavLabelActive: {
    color: tokens.colors.brand,
  },
});
