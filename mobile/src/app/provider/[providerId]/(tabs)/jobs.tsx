import { useProviderJobs } from "@/api/workspace-queries";
import { ListRow, RowGroup } from "@/components/list-row";
import { AppText } from "@/components/ui";
import { StatusPill, useWorkspaceGate } from "@/workspace/inbox-ui";
import { EmptyCard, formatDate, QuerySection, useWorkspaceParam, WorkspaceScroll } from "@/workspace/shell";

/** Work assigned to this provider. Read-only: accepting, declining and quoting happen on the website. */
export default function JobsTab() {
  const { workspaceId } = useWorkspaceGate("provider", useWorkspaceParam("provider"));
  const jobs = useProviderJobs(workspaceId);
  if (!workspaceId) return null;
  return (
    <WorkspaceScroll refreshing={jobs.isRefetching} onRefresh={() => void jobs.refetch()}>
      <QuerySection query={jobs} what="jobs">
        {(items) =>
          items.length === 0 ? (
            <EmptyCard message="No jobs yet. Work that landlords and property managers assign to you appears here." testID="jobs-empty" />
          ) : (
            <>
              <AppText variant="caption">Respond to new jobs and send quotes on nesafric.com.</AppText>
              <RowGroup>
                {items.map((job, index) => (
                  <ListRow
                    key={job.id}
                    icon="hammer-outline"
                    title={job.title}
                    detail={job.property}
                    meta={formatDate(job.assignedAt) ? `Assigned ${formatDate(job.assignedAt)}` : null}
                    trailing={<StatusPill status={job.status} />}
                    testID={`job-${job.id}`}
                    last={index === items.length - 1}
                  />
                ))}
              </RowGroup>
            </>
          )
        }
      </QuerySection>
    </WorkspaceScroll>
  );
}
