import { router } from "expo-router";

import { usePmTenants } from "@/api/workspace-queries";
import { ListRow, RowGroup } from "@/components/list-row";
import { Button } from "@/components/ui";
import { useWorkspaceGate } from "@/workspace/inbox-ui";
import { EmptyCard, formatDate, QuerySection, useWorkspaceParam, WorkspaceScroll } from "@/workspace/shell";

/** Tenant names in the list; a tenant's contact details load only on their own screen. */
export default function TenantsTab() {
  const { workspaceId } = useWorkspaceGate("organisation", useWorkspaceParam("organisation"));
  const tenants = usePmTenants(workspaceId);
  if (!workspaceId) return null;
  return (
    <WorkspaceScroll refreshing={tenants.isRefetching} onRefresh={() => void tenants.refetch()}>
      <Button label="Add tenant" onPress={() => router.push({ pathname: "/workspace/[organisationId]/tenant/new", params: { organisationId: workspaceId } })} testID="add-tenant" />
      <QuerySection query={tenants} what="tenants">
        {(items) =>
          items.length === 0 ? (
            <EmptyCard message="No tenants in this workspace yet." testID="tenants-empty" />
          ) : (
            <RowGroup>
              {items.map((tenant, index) => (
                <ListRow
                  key={tenant.id}
                  icon="person-outline"
                  title={tenant.name}
                  detail={formatDate(tenant.since) ? `Added ${formatDate(tenant.since)}` : null}
                  onPress={() => router.push({ pathname: "/workspace/[organisationId]/tenant/[tenantId]", params: { organisationId: workspaceId, tenantId: tenant.id } })}
                  testID={`tenant-${tenant.id}`}
                  last={index === items.length - 1}
                />
              ))}
            </RowGroup>
          )
        }
      </QuerySection>
    </WorkspaceScroll>
  );
}
