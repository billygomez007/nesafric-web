import { usePmProperties } from "@/api/workspace-queries";
import { ListRow, RowGroup } from "@/components/list-row";
import { humanise } from "@/marketplace/format";
import { useWorkspaceGate } from "@/workspace/inbox-ui";
import { EmptyCard, QuerySection, useWorkspaceParam, WorkspaceScroll } from "@/workspace/shell";

export default function PropertiesTab() {
  const { workspaceId } = useWorkspaceGate("organisation", useWorkspaceParam("organisation"));
  const properties = usePmProperties(workspaceId);
  if (!workspaceId) return null;
  return (
    <WorkspaceScroll refreshing={properties.isRefetching} onRefresh={() => void properties.refetch()}>
      <QuerySection query={properties} what="properties">
        {(items) =>
          items.length === 0 ? (
            <EmptyCard message="No properties in this workspace yet. Add them on nesafric.com." testID="properties-empty" />
          ) : (
            <RowGroup>
              {items.map((property, index) => (
                <ListRow
                  key={property.id}
                  icon="business-outline"
                  title={property.name}
                  detail={[property.referenceNumber, humanise(property.category), property.city].filter(Boolean).join(" · ")}
                  meta={`${humanise(property.status)} · ${property.units} ${property.units === 1 ? "unit" : "units"}`}
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
