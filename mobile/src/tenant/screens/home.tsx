import Ionicons from "@expo/vector-icons/Ionicons";
import { router, Stack } from "expo-router";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, NETWORK_ERROR } from "@/api/client";
import type { TenantMaintenanceRequest } from "@/api/tenant";
import { useTenancy, useTenantMaintenance } from "@/api/tenant-queries";
import { AppText, Button, Card, Loading, Notice, StateMessage } from "@/components/ui";
import { categoryLabel, formatDay, isOpenStatus, leaseLabel, statusLabel } from "@/tenant/maintenance";
import { TenancyUnavailable } from "@/tenant/tenancy-state";
import { colors, radii, spacing } from "@/theme/tokens";

/**
 * A home the signed-in user rents: their current lease(s) and their own maintenance requests.
 * Everything shown comes from the tenant endpoints, which the server scopes to this tenant only.
 */
export function TenantHomeScreen({ tenancyId }: { tenancyId: string | undefined }) {
  const insets = useSafeAreaInsets();
  const { tenancies, tenancy } = useTenancy(tenancyId);
  const requests = useTenantMaintenance(tenancy);

  if (!tenancy) return <TenancyUnavailable tenancies={tenancies} />;

  const canReport = tenancy.leases.length > 0;
  const items = requests.data ?? [];
  const open = items.filter((item) => isOpenStatus(item.status));
  const past = items.filter((item) => !isOpenStatus(item.status));

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]}
      refreshControl={<RefreshControl refreshing={requests.isRefetching} onRefresh={() => void requests.refetch()} tintColor={colors.brand} />}
    >
      <Stack.Screen options={{ title: tenancy.organisation.name }} />
      <Card style={styles.home}>
        <AppText variant="caption">Rented through {tenancy.organisation.name}</AppText>
        {tenancy.leases.length ? (
          tenancy.leases.map((lease) => (
            <View key={lease.id}>
              <AppText variant="heading">{leaseLabel(lease)}</AppText>
              <AppText variant="caption">
                {lease.status === "EXPIRING" ? "Lease ending soon" : "Current lease"}
                {lease.endDate ? ` · until ${formatDay(lease.endDate)}` : ""}
              </AppText>
            </View>
          ))
        ) : (
          <AppText variant="caption">There’s no current lease linked to your account here, so repairs can’t be reported from the app. Contact {tenancy.organisation.name} directly.</AppText>
        )}
      </Card>

      {canReport ? <Button label="Report a problem" testID="report-problem" onPress={() => router.push({ pathname: "/home/[tenancyId]/report", params: { tenancyId: tenancy.tenantOrganisationId } })} /> : null}

      <AppText variant="heading" accessibilityRole="header">
        Your repair requests
      </AppText>
      <RequestList query={requests} open={open} past={past} tenancyId={tenancy.tenantOrganisationId} />
    </ScrollView>
  );
}

function RequestList({ query, open, past, tenancyId }: { query: ReturnType<typeof useTenantMaintenance>; open: TenantMaintenanceRequest[]; past: TenantMaintenanceRequest[]; tenancyId: string }) {
  if (query.isPending) return <Loading />;
  if (!query.data) {
    const error = query.error;
    const offline = error instanceof ApiError && error.code === NETWORK_ERROR;
    if (error instanceof ApiError && error.status === 403) {
      return <StateMessage title="Repairs aren’t available for this home" message="Your link to this home may have changed. Contact your landlord or property manager." />;
    }
    return (
      <StateMessage
        title={offline ? "You’re offline" : "Couldn’t load your requests"}
        message={offline ? "Check your connection and try again." : error instanceof Error ? error.message : "Please try again."}
        actionLabel="Try again"
        onAction={() => void query.refetch()}
      />
    );
  }
  if (!open.length && !past.length) {
    return <AppText variant="caption">No repair requests yet. If something needs fixing, tap Report a problem.</AppText>;
  }
  return (
    <View style={styles.lists}>
      {query.error ? <Notice tone="warning" message="Couldn’t refresh. Showing what was already loaded; pull down to try again." /> : null}
      {open.length ? <Group title="Open" items={open} tenancyId={tenancyId} /> : null}
      {past.length ? <Group title="Finished" items={past} tenancyId={tenancyId} /> : null}
    </View>
  );
}

function Group({ title, items, tenancyId }: { title: string; items: TenantMaintenanceRequest[]; tenancyId: string }) {
  return (
    <View style={styles.groupWrap}>
      <AppText variant="label">{title}</AppText>
      <View style={styles.group}>
        {items.map((item, index) => (
          <Pressable
            key={item.id}
            testID={`maintenance-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${statusLabel(item.status)}`}
            onPress={() => router.push({ pathname: "/home/[tenancyId]/request/[requestId]", params: { tenancyId, requestId: item.id } })}
            style={({ pressed }) => [styles.row, index === items.length - 1 && styles.rowLast, pressed && styles.rowPressed]}
          >
            <View style={styles.rowText}>
              <AppText variant="label">{item.title}</AppText>
              <AppText variant="caption">
                {statusLabel(item.status)} · {categoryLabel(item.category)} · {formatDay(item.createdAt)}
              </AppText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  home: { gap: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.gold },
  lists: { gap: spacing.lg },
  groupWrap: { gap: spacing.sm },
  group: { borderRadius: radii.panel, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.elevated, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.hairline, minHeight: 56 },
  rowLast: { borderBottomWidth: 0 },
  rowPressed: { backgroundColor: colors.surface },
  rowText: { flex: 1, gap: 2 },
});
