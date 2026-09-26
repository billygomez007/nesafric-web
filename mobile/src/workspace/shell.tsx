import Ionicons from "@expo/vector-icons/Ionicons";
import type { UseQueryResult } from "@tanstack/react-query";
import { router, useGlobalSearchParams } from "expo-router";
import { Tabs } from "expo-router/tabs";
import * as WebBrowser from "expo-web-browser";
import { useEffect, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, NETWORK_ERROR } from "@/api/client";
import { useApi } from "@/api/provider";
import { useSession } from "@/auth/session";
import { rememberWorkspace } from "@/auth/workspaces";
import { ListRow, RowGroup, type IconName } from "@/components/list-row";
import { AppText, Button, Card, Loading } from "@/components/ui";
import { colors, fonts, spacing } from "@/theme/tokens";
import { useWorkspaceGate, type GateKind } from "./inbox-ui";
import { WORKSPACE_KIND_LABEL, type WorkspaceKind } from "./resolve";

export const GATE_TO_KIND: Record<GateKind, Exclude<WorkspaceKind, "marketplace">> = {
  organisation: "property_management",
  professional: "professional",
  provider: "service_provider",
};

const PARAM: Record<GateKind, string> = { organisation: "organisationId", professional: "professionalId", provider: "providerId" };

/** The workspace id from the route (`organisationId` / `professionalId` / `providerId`). */
export function useWorkspaceParam(kind: GateKind) {
  const params = useGlobalSearchParams<Record<string, string>>();
  const value = params[PARAM[kind]];
  return Array.isArray(value) ? value[0] : value;
}

function tabIcon(active: IconName, inactive: IconName) {
  function TabIcon({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) {
    return <Ionicons name={focused ? active : inactive} color={color} size={size} />;
  }
  return TabIcon;
}

export type WorkspaceTab = { name: string; title: string; icon: IconName };

/**
 * Bottom tabs for one workspace. Nothing inside renders (and nothing is fetched) until the
 * workspace gate confirms the id is in the server's own list for this user. Opening a workspace
 * remembers it as the last one — navigation state only.
 */
export function WorkspaceTabs({ kind, tabs }: { kind: GateKind; tabs: WorkspaceTab[] }) {
  const id = useWorkspaceParam(kind);
  const { gate, organisation, professional, provider, workspaceId } = useWorkspaceGate(kind, id);
  const { user } = useSession();
  const name = organisation?.name ?? professional?.displayName ?? provider?.displayName ?? WORKSPACE_KIND_LABEL[GATE_TO_KIND[kind]];

  useEffect(() => {
    if (user && workspaceId) void rememberWorkspace(user.id, { kind: GATE_TO_KIND[kind], id: workspaceId });
  }, [user, kind, workspaceId]);

  if (gate) return <View style={styles.gate}>{gate}</View>;

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerTitle: name,
        headerTitleStyle: { fontFamily: fonts.bold, color: colors.ink },
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerLeft: () => <HeaderButton icon="chevron-back" label="Account" onPress={leaveWorkspace} testID="workspace-back" />,
        headerRight: () => <HeaderButton icon="swap-horizontal" label="Switch" onPress={() => openSwitcher(GATE_TO_KIND[kind], workspaceId)} testID="workspace-switch" />,
        sceneStyle: { backgroundColor: colors.background },
        tabBarStyle: { backgroundColor: colors.elevated, borderTopColor: colors.hairline },
        tabBarActiveTintColor: colors.forest,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16 },
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title, tabBarIcon: tabIcon(tab.icon, `${tab.icon}-outline` as IconName), tabBarButtonTestID: `tab-${tab.name}` }} />
      ))}
    </Tabs>
  );
}

function leaveWorkspace() {
  if (router.canGoBack()) router.back();
  else router.replace("/account");
}

export function openSwitcher(kind: WorkspaceKind, id: string | null) {
  router.push({ pathname: "/switch-workspace", params: { kind, id: id ?? "" } });
}

function HeaderButton({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label === "Switch" ? "Switch workspace" : `Back to ${label}`} onPress={onPress} testID={testID} hitSlop={8} style={styles.headerButton}>
      <Ionicons name={icon} size={20} color={colors.forest} />
      <AppText variant="label" style={styles.headerLabel}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Scrollable tab body with pull to refresh. */
export function WorkspaceScroll({ children, refreshing = false, onRefresh }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

/**
 * Loading, denied (403: the server says this role can't read it), offline and failed states for
 * one server section. Renders `children(data)` only with real server data.
 */
export function QuerySection<T>({ query, what, children }: { query: UseQueryResult<T>; what: string; children: (data: T) => ReactNode }) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isPending && query.fetchStatus !== "idle") return <Loading />;
  const error = query.error;
  if (error instanceof ApiError && error.status === 403) {
    return (
      <Card testID="section-denied">
        <AppText variant="label">Your role here doesn’t include {what}</AppText>
        <AppText variant="caption">Ask an owner or administrator of this workspace if you need it.</AppText>
      </Card>
    );
  }
  if (!error) return <Loading />;
  const offline = error instanceof ApiError && error.code === NETWORK_ERROR;
  return (
    <Card testID="section-error">
      <AppText variant="label">{offline ? "You’re offline" : `Couldn’t load ${what}`}</AppText>
      <AppText variant="caption">{offline ? "Check your connection and try again." : error instanceof Error ? error.message : "Please try again."}</AppText>
      <Button label="Try again" variant="secondary" onPress={() => void query.refetch()} />
    </Card>
  );
}

export function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant="title">{value}</AppText>
      <AppText variant="caption">{label}</AppText>
    </Card>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <View style={styles.stats}>{children}</View>;
}

export function EmptyCard({ message, testID }: { message: string; testID?: string }) {
  return (
    <Card testID={testID}>
      <AppText variant="caption">{message}</AppText>
    </Card>
  );
}

export function Heading({ children }: { children: string }) {
  return (
    <AppText variant="heading" accessibilityRole="header">
      {children}
    </AppText>
  );
}

/** The "More" tab: switching, back to Marketplace, and the website for everything the app doesn't do yet. */
export function WorkspaceMore({ kind, webPath, webOnly, children }: { kind: GateKind; webPath: string; webOnly: string; children?: ReactNode }) {
  const id = useWorkspaceParam(kind);
  const { workspaceId } = useWorkspaceGate(kind, id);
  const { apiUrl } = useApi();
  return (
    <WorkspaceScroll>
      {children}
      <RowGroup>
        <ListRow icon="swap-horizontal-outline" title="Switch workspace" detail="Move to another workspace you belong to" onPress={() => openSwitcher(GATE_TO_KIND[kind], workspaceId)} testID="more-switch" />
        <ListRow icon="storefront-outline" title="Switch to Marketplace" detail="Browse, save and enquire about properties" onPress={() => router.navigate("/")} testID="more-marketplace" />
        <ListRow icon="open-outline" title="Manage on nesafric.com" detail="Opens the website (sign in there with the same account)" onPress={() => void WebBrowser.openBrowserAsync(`${apiUrl}${webPath}`)} testID="more-web" last />
      </RowGroup>
      <AppText variant="caption" style={styles.center}>
        {webOnly}
      </AppText>
    </WorkspaceScroll>
  );
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const styles = StyleSheet.create({
  gate: { flex: 1, backgroundColor: colors.background },
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  headerButton: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: spacing.md, minHeight: 44 },
  headerLabel: { color: colors.forest },
  stats: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, borderTopWidth: 3, borderTopColor: colors.gold },
  center: { textAlign: "center" },
});
