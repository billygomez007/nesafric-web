import { router, Stack, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useWorkspaceDashboard, useWorkspaces } from "@/api/account-queries";
import { ApiError, NETWORK_ERROR } from "@/api/client";
import { useApi } from "@/api/provider";
import { useSession } from "@/auth/session";
import { isListedOrganisation } from "@/auth/workspaces";
import { AppText, Button, Card, Loading, StateMessage } from "@/components/ui";
import { humanise } from "@/marketplace/format";
import { colors, radii, spacing } from "@/theme/tokens";

/**
 * Read-only workspace overview. The organisation must come from the server's own workspace list
 * (so `x-organisation-id` is only ever sent for a workspace the user belongs to), and every number
 * shown comes from `/api/dashboard`, which re-checks membership and `property.read` server-side.
 */
export default function WorkspaceScreen() {
  const { organisationId } = useLocalSearchParams<{ organisationId: string }>();
  const { status } = useSession();
  const workspaces = useWorkspaces();
  const listed = isListedOrganisation(workspaces.data, organisationId);
  const dashboard = useWorkspaceDashboard(listed ? organisationId : null);
  const { apiUrl } = useApi();
  const insets = useSafeAreaInsets();
  const organisation = workspaces.data?.propertyOsOrganisations.find((item) => item.id === organisationId);

  if (status !== "signedIn") {
    return (
      <View style={styles.screen}>
        <StateMessage title="Sign in to see this workspace" actionLabel="Sign in" onAction={() => router.replace("/sign-in")} />
      </View>
    );
  }
  if (workspaces.isPending) return <Loading />;
  if (!listed) {
    return (
      <View style={styles.screen}>
        <StateMessage title="Workspace not available" message="You’re not a member of this workspace, or it’s no longer available to you." actionLabel="Back to Account" onAction={() => (router.canGoBack() ? router.back() : router.replace("/account"))} />
      </View>
    );
  }

  const error = dashboard.error;
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: organisation?.name ?? "Workspace" }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={dashboard.isRefetching} onRefresh={() => dashboard.refetch()} tintColor={colors.brand} />}
      >
        <View style={styles.header}>
          <AppText variant="caption">Property management workspace</AppText>
          <AppText variant="title" accessibilityRole="header">
            {organisation?.name}
          </AppText>
        </View>

        {dashboard.isPending ? (
          <Loading />
        ) : dashboard.data ? (
          <>
            <View style={styles.stats}>
              <Stat label="Properties" value={dashboard.data.properties.length} />
              <Stat label="Units" value={dashboard.data.units} />
              <Stat label="Team members" value={dashboard.data.members} />
            </View>
            <AppText variant="heading" accessibilityRole="header">
              Properties
            </AppText>
            {dashboard.data.properties.length === 0 ? (
              <Card>
                <AppText variant="caption">No properties in this workspace yet.</AppText>
              </Card>
            ) : (
              <View style={styles.list}>
                {dashboard.data.properties.map((property, index) => (
                  <View key={property.id} style={[styles.item, index === dashboard.data.properties.length - 1 && styles.itemLast]}>
                    <AppText variant="label">{property.name}</AppText>
                    <AppText variant="caption">{[property.referenceNumber, humanise(property.category), humanise(property.status)].filter(Boolean).join(" · ")}</AppText>
                  </View>
                ))}
              </View>
            )}
          </>
        ) : error instanceof ApiError && error.status === 403 ? (
          <Card>
            <AppText variant="label">Your role here doesn’t include property access</AppText>
            <AppText variant="caption">Ask an owner or administrator of this workspace if you need it.</AppText>
          </Card>
        ) : (
          <Card>
            <AppText variant="label">{error instanceof ApiError && error.code === NETWORK_ERROR ? "You’re offline" : "Couldn’t load this workspace"}</AppText>
            <AppText variant="caption">{error instanceof Error ? error.message : "Please try again."}</AppText>
            <Button label="Try again" variant="secondary" onPress={() => dashboard.refetch()} />
          </Card>
        )}

        <Button label="Manage this workspace on nesafric.com" variant="secondary" onPress={() => WebBrowser.openBrowserAsync(`${apiUrl}/dashboard`)} />
        <AppText variant="caption" style={styles.center}>
          Leases, rent, maintenance and team management are coming to the app. For now, manage them on the website.
        </AppText>
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant="title">{value}</AppText>
      <AppText variant="caption">{label}</AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  header: { gap: 2 },
  stats: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, borderTopWidth: 3, borderTopColor: colors.gold },
  list: { borderRadius: radii.panel, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.elevated },
  item: { padding: spacing.lg, gap: 2, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  itemLast: { borderBottomWidth: 0 },
  center: { textAlign: "center" },
});
