import { Stack } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, NETWORK_ERROR } from "@/api/client";
import { useTenancy, useTenantMaintenanceRequest } from "@/api/tenant-queries";
import { AppText, Card, Loading, Notice, StateMessage } from "@/components/ui";
import { categoryLabel, formatDateTime, formatDay, leaseLabel, priorityLabel, statusLabel } from "@/tenant/maintenance";
import { TenancyUnavailable } from "@/tenant/tenancy-state";
import { colors, spacing } from "@/theme/tokens";

/** One of the tenant's own repair requests: what they reported and its progress (tenant view only). */
export function TenantRequestScreen({ tenancyId, requestId }: { tenancyId: string | undefined; requestId: string | undefined }) {
  const insets = useSafeAreaInsets();
  const { tenancies, tenancy } = useTenancy(tenancyId);
  const query = useTenantMaintenanceRequest(tenancy, requestId);

  if (!tenancy) return <TenancyUnavailable tenancies={tenancies} />;

  const { data: request, error } = query;
  // A refusal or "not found" from the server always wins, even over a row shown from the list.
  const refused = error instanceof ApiError && (error.status === 403 || error.status === 404);
  if (query.isPending && !request && !error) return <Loading />;
  if (!request || refused) {
    if (refused) return <StateMessage title="This request isn’t available" message="It may have been removed, or it belongs to another home." />;
    const offline = error instanceof ApiError && error.code === NETWORK_ERROR;
    return (
      <StateMessage
        title={offline ? "You’re offline" : "Couldn’t load this request"}
        message={offline ? "Check your connection and try again." : error instanceof Error ? error.message : "Please try again."}
        actionLabel="Try again"
        onAction={() => void query.refetch()}
      />
    );
  }

  const home = leaseLabel(request);
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.brand} />}
    >
      <Stack.Screen options={{ title: "Repair request" }} />
      {error ? <Notice tone="warning" message="Couldn’t refresh this. Showing what was already loaded; pull down to try again." /> : null}
      <View style={styles.header}>
        <AppText variant="title">{request.title}</AppText>
        <AppText variant="label" testID="request-status" style={styles.status}>
          {statusLabel(request.status)}
        </AppText>
      </View>
      <Card style={styles.card}>
        <Fact label="Home" value={home} />
        <Fact label="Type" value={categoryLabel(request.category)} />
        <Fact label="Priority" value={priorityLabel(request.priority)} />
        <Fact label="Reported" value={formatDateTime(request.createdAt) ?? "—"} />
      </Card>
      <Card style={styles.card}>
        <AppText variant="label">What you reported</AppText>
        <AppText>{request.description}</AppText>
        {request.attachments.length ? <AppText variant="caption">{request.attachments.length === 1 ? "1 photo or file attached" : `${request.attachments.length} photos or files attached`}</AppText> : null}
      </Card>

      {request.workOrders.length ? (
        <Card style={styles.card}>
          <AppText variant="label">Repair work</AppText>
          {request.workOrders.map((work) => (
            <View key={work.id} style={styles.work}>
              <AppText>{work.title}</AppText>
              <AppText variant="caption">
                {workLabel(work)}
                {work.dueAt && !work.completedAt ? ` · due ${formatDay(work.dueAt)}` : ""}
              </AppText>
            </View>
          ))}
        </Card>
      ) : null}

      <Card style={styles.card}>
        <AppText variant="label">Progress</AppText>
        {request.timeline.map((entry) => (
          <View key={entry.id} style={styles.step} testID={`timeline-${entry.toStatus}`}>
            <View style={styles.dot} />
            <View style={styles.stepText}>
              <AppText>{statusLabel(entry.toStatus)}</AppText>
              <AppText variant="caption">{formatDateTime(entry.createdAt)}</AppText>
            </View>
          </View>
        ))}
      </Card>
      <AppText variant="caption" style={styles.center}>
        To add details or ask about this repair, contact your landlord or property manager.
      </AppText>
    </ScrollView>
  );
}

function workLabel(work: { status: string; completedAt: string | null; startedAt: string | null; assignedAt: string | null }) {
  if (work.completedAt) return `Done ${formatDay(work.completedAt)}`;
  if (work.startedAt) return `Started ${formatDay(work.startedAt)}`;
  if (work.assignedAt) return `Repairer booked ${formatDay(work.assignedAt)}`;
  return work.status === "CANCELLED" ? "Cancelled" : "Being arranged";
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <AppText variant="caption">{label}</AppText>
      <AppText style={styles.factValue}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  header: { gap: spacing.xs },
  status: { color: colors.brandStrong },
  card: { gap: spacing.sm },
  fact: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  factValue: { flexShrink: 1, textAlign: "right" },
  work: { gap: 2 },
  step: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand, marginTop: 6 },
  stepText: { flex: 1, gap: 2 },
  center: { textAlign: "center" },
});
