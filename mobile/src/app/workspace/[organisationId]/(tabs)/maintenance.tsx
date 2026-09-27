import { usePmMaintenance } from "@/api/workspace-queries";
import { ListRow, RowGroup } from "@/components/list-row";
import { humanise } from "@/marketplace/format";
import { StatusPill, useWorkspaceGate } from "@/workspace/inbox-ui";
import { EmptyCard, formatDate, QuerySection, useWorkspaceParam, WorkspaceScroll } from "@/workspace/shell";

export default function MaintenanceTab() {
  const { workspaceId } = useWorkspaceGate("organisation", useWorkspaceParam("organisation"));
  const requests = usePmMaintenance(workspaceId);
  if (!workspaceId) return null;
  return (
    <WorkspaceScroll refreshing={requests.isRefetching} onRefresh={() => void requests.refetch()}>
      <QuerySection query={requests} what="maintenance">
        {(items) =>
          items.length === 0 ? (
            <EmptyCard message="No maintenance requests yet." testID="maintenance-empty" />
          ) : (
            <RowGroup>
              {items.map((request, index) => (
                <ListRow
                  key={request.id}
                  icon="construct-outline"
                  title={request.title}
                  detail={request.place || null}
                  meta={[`${humanise(request.priority)} priority`, formatDate(request.createdAt)].filter(Boolean).join(" · ")}
                  trailing={<StatusPill status={request.status} />}
                  testID={`maintenance-${request.id}`}
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
