import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { websiteUrl } from "@/config";

import { useWorkspaces } from "@/api/account-queries";
import { ApiError, NETWORK_ERROR } from "@/api/client";
import { useApi } from "@/api/provider";
import { useSession } from "@/auth/session";
import { AppText, Button, Card, Loading, Notice } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";
import { isWorkspaceIntent, parseIntent, resolveAvailableWorkspaces, type WorkspaceIntent } from "@/workspace/resolve";
import { SETUP_PATH } from "@/workspace/routing";
import { openWebsiteThenRefresh } from "@/workspace/web-handoff";

const COPY: Record<WorkspaceIntent, { title: string; body: string; action: string }> = {
  property_management: {
    title: "Set up Property Management",
    body: "This account doesn’t have a property management workspace yet. Set one up on nesafric.com to manage properties, units, tenants, leases, rent and maintenance.",
    action: "Set up property management",
  },
  professional: {
    title: "Register as a Real Estate Professional",
    body: "This account isn’t part of a real estate professional business yet. Register your agency, company or developer profile on nesafric.com to manage listings, leads and enquiries.",
    action: "Register as a Real Estate Professional",
  },
  service_provider: {
    title: "Register as a Service Provider",
    body: "This account doesn’t have a service provider profile yet. Register your business on nesafric.com to receive property jobs through NesAfric.",
    action: "Register as a Service Provider",
  },
};

/**
 * Shown after sign-in when the chosen card's kind isn't in the server's workspace list. It never
 * grants anything: set-up happens on the website, and the workspace appears only once the server
 * lists it (re-checked when the person comes back).
 */
export default function SetupScreen() {
  // Set-up exists only for workspace kinds; a tenancy is never "set up" by the tenant.
  const parsed = parseIntent(useLocalSearchParams<{ kind?: string }>().kind);
  const kind = isWorkspaceIntent(parsed) ? parsed : null;
  const { status } = useSession();
  const { apiUrl } = useApi();
  const workspaces = useWorkspaces();
  const insets = useSafeAreaInsets();

  if (!kind || status !== "signedIn") {
    return (
      <View style={[styles.screen, styles.content]}>
        <Card style={styles.card}>
          <AppText variant="label">Nothing to set up here</AppText>
          <Button label="Browse Marketplace" onPress={() => router.navigate("/")} />
        </Card>
      </View>
    );
  }

  const copy = COPY[kind];
  const ready = resolveAvailableWorkspaces({ status, workspaces: workspaces.data }).filter((workspace) => workspace.kind === kind);

  async function setUp() {
    // Back from the website: a workspace set up there shows up once the server lists it.
    await openWebsiteThenRefresh(websiteUrl(apiUrl, `${SETUP_PATH[kind!]}`), () => void workspaces.refetch());
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]}>
      <AppText variant="title" accessibilityRole="header">
        {copy.title}
      </AppText>
      {workspaces.isFetching && !workspaces.data ? <Loading /> : null}
      {workspaces.error && !workspaces.isFetching ? (
        <Notice message={workspaces.error instanceof ApiError && workspaces.error.code === NETWORK_ERROR ? "You’re offline, so we couldn’t check for your new workspace. Check again when you’re connected." : "We couldn’t check for your new workspace. Tap Check again."} />
      ) : null}
      {ready.length ? (
        <Card style={styles.card} testID="setup-ready">
          <AppText variant="label">Your workspace is ready</AppText>
          {ready.map((workspace, index) => (
            <Button key={workspace.id ?? workspace.name} label={`Open ${workspace.name}`} variant={index === 0 ? "primary" : "secondary"} onPress={() => router.replace(workspace.route)} testID={`setup-open-${workspace.id}`} />
          ))}
        </Card>
      ) : (
        <Card style={styles.card} testID="setup-needed">
          <AppText>{copy.body}</AppText>
          <Button label={copy.action} onPress={() => void setUp()} accessibilityHint="Opens nesafric.com" testID="setup-open-web" />
          <AppText variant="caption">Sign in on the website with the same account. When you come back, your new workspace appears here and under Account.</AppText>
          <Button label="Check again" variant="secondary" onPress={() => void workspaces.refetch()} testID="setup-refresh" />
        </Card>
      )}
      <Button label="Browse Marketplace" variant="secondary" onPress={() => router.navigate("/")} testID="setup-marketplace" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  card: { gap: spacing.md },
});
