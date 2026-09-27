import { router } from "expo-router";

import { usePmProperties } from "@/api/workspace-queries";
import { ListRow, RowGroup } from "@/components/list-row";
import { Button } from "@/components/ui";
import { humanise } from "@/marketplace/format";
import { useWorkspaceGate } from "@/workspace/inbox-ui";
import { EmptyCard, QuerySection, useWorkspaceParam, WorkspaceScroll } from "@/workspace/shell";

/** The workspace's properties. Add property and each property's units are managed in the app. */
export default function PropertiesTab() {
  const { workspaceId } = useWorkspaceGate("organisation", useWorkspaceParam("organisation"));
  const properties = usePmProperties(workspaceId);
  if (!workspaceId) return null;
  return (
    <WorkspaceScroll refreshing={properties.isRefetching} onRefresh={() => void properties.refetch()}>
      <Button label="Add property" onPress={() => router.push({ pathname: "/workspace/[organisationId]/property/new", params: { organisationId: workspaceId } })} testID="add-property" />
      <QuerySection query={properties} what="properties">
        {(items) =>
          items.length === 0 ? (
            <EmptyCard message="No properties in this workspace yet. Add your first property." testID="properties-empty" />
          ) : (
            <RowGroup>
              {items.map((property, index) => (
                <ListRow
                  key={property.id}
                  icon="business-outline"
                  title={property.name}
                  detail={[property.referenceNumber, humanise(property.category), property.city].filter(Boolean).join(" · ")}
                  meta={`${humanise(property.status)} · ${property.units} ${property.units === 1 ? "unit" : "units"}`}
                  onPress={() => router.push({ pathname: "/workspace/[organisationId]/property/[propertyId]", params: { organisationId: workspaceId, propertyId: property.id } })}
                  testID={`property-${property.id}`}
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
