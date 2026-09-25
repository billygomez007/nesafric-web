import { Stack, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useWorkspaceDashboard } from "@/api/account-queries";
import { ApiError, NETWORK_ERROR } from "@/api/client";
import { useInboxAccess } from "@/api/inbox-queries";
import { useApi } from "@/api/provider";
import { AppText, Button, Card, Loading } from "@/components/ui";
import { humanise } from "@/marketplace/format";
import { colors, radii, spacing } from "@/theme/tokens";
import { InboxEntry } from "@/workspace/inbox-entry";
import { useWorkspaceGate } from "@/workspace/inbox-ui";

/**
 * Read-only workspace overview. The organisation must come from the server's own workspace list
 * (so `x-organisation-id` is only ever sent for a workspace the user belongs to), and every number
 * shown comes from `/api/dashboard`, which re-checks membership and `property.read` server-side.
 */
export default function WorkspaceScreen() {
  const params = useLocalSearchParams<{ organisationId: string }>();
  const { gate, scope, organisation } = useWorkspaceGate("organisation", params.organisationId);
  const dashboard = useWorkspaceDashboard(scope?.id ?? null);
  const inbox = useInboxAccess(scope);
  const { apiUrl } = useApi();
  const insets = useSafeAreaInsets();

  if (gate) return <View style={styles.screen}>{gate}</View>;

  const error = dashboard.error;
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: organisation?.name ?? "Workspace" }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={dashboard.isRefetching} onRefresh={() => void Promise.all([dashboard.refetch(), inbox.retry()])} tintColor={colors.brand} />}
      >
        <View style={styles.header}>
          <AppText variant="caption">Property management workspace</AppText>
          <AppText variant="title" accessibilityRole="header">
            {organisation?.name}
          </AppText>
        </View>

        <InboxEntry scope={scope!} access={inbox} />

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
          Replying to enquiries, leases, rent, maintenance and team management are coming to the app. For now, manage them on the website.
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
