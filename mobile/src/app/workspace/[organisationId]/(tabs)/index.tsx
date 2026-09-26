import { router } from "expo-router";
import { View } from "react-native";

import { useWorkspaceDashboard } from "@/api/account-queries";
import { useInboxAccess } from "@/api/inbox-queries";
import { usePmMaintenanceSummary } from "@/api/workspace-queries";
import { ListRow, RowGroup } from "@/components/list-row";
import { AppText } from "@/components/ui";
import { humanise } from "@/marketplace/format";
import { InboxEntry } from "@/workspace/inbox-entry";
import { useWorkspaceGate } from "@/workspace/inbox-ui";
import { EmptyCard, Heading, QuerySection, Stat, StatRow, useWorkspaceParam, WorkspaceScroll } from "@/workspace/shell";

/**
 * Property management dashboard. Every number comes from the server for this organisation
 * (`/api/dashboard`, `/api/maintenance/dashboard`), each re-checking membership and permission.
 */
const PREVIEW = 5;

export default function PropertyManagementDashboard() {
  const { scope, organisation, workspaceId } = useWorkspaceGate("organisation", useWorkspaceParam("organisation"));
  const dashboard = useWorkspaceDashboard(workspaceId);
  const maintenance = usePmMaintenanceSummary(workspaceId);
  const inbox = useInboxAccess(scope);
  if (!scope) return null;

  return (
    <WorkspaceScroll refreshing={dashboard.isRefetching} onRefresh={() => void Promise.all([dashboard.refetch(), maintenance.refetch(), inbox.retry()])}>
      <View>
        <AppText variant="caption">Property management workspace</AppText>
        <AppText variant="title" accessibilityRole="header">
          {organisation?.name}
        </AppText>
      </View>

      <QuerySection query={dashboard} what="property access">
        {(data) => (
          <>
            <StatRow>
              <Stat label="Properties" value={data.properties.length} />
              <Stat label="Units" value={data.units} />
              <Stat label="Team members" value={data.members} />
            </StatRow>
            {data.properties.length === 0 ? (
              <EmptyCard message="No properties in this workspace yet." />
            ) : (
              <RowGroup>
                {data.properties.slice(0, PREVIEW).map((property, index, shown) => (
                  <ListRow
                    key={property.id}
                    icon="business-outline"
                    title={property.name}
                    detail={[property.referenceNumber, humanise(property.category), humanise(property.status)].filter(Boolean).join(" · ")}
                    last={index === shown.length - 1 && data.properties.length <= PREVIEW}
                  />
                ))}
                {data.properties.length > PREVIEW ? (
                  <ListRow title={`See all ${data.properties.length} properties`} onPress={() => router.navigate({ pathname: "/workspace/[organisationId]/properties", params: { organisationId: scope.id } })} testID="see-all-properties" last />
                ) : null}
              </RowGroup>
            )}
          </>
        )}
      </QuerySection>

      <InboxEntry scope={scope} access={inbox} />

      <Heading>Maintenance</Heading>
      <QuerySection query={maintenance} what="maintenance">
        {(data) => (
          <>
            <StatRow>
              <Stat label="Open requests" value={data.open} />
              <Stat label="All requests" value={data.total} />
            </StatRow>
            {Object.keys(data.openByPriority).length ? (
              <AppText variant="caption" testID="open-by-priority">
                Open by priority: {Object.entries(data.openByPriority).map(([priority, count]) => `${humanise(priority)} ${count}`).join(" · ")}
              </AppText>
            ) : null}
          </>
        )}
      </QuerySection>
    </WorkspaceScroll>
  );
}
