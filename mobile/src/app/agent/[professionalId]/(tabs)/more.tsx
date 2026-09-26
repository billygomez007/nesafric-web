import { ListRow, RowGroup } from "@/components/list-row";
import { humanise } from "@/marketplace/format";
import { useWorkspaceGate } from "@/workspace/inbox-ui";
import { useWorkspaceParam, WorkspaceMore } from "@/workspace/shell";

export default function ProfessionalMore() {
  const id = useWorkspaceParam("professional");
  const { professional } = useWorkspaceGate("professional", id);
  return (
    <WorkspaceMore kind="professional" webPath={`/pro/${encodeURIComponent(id ?? "")}`} webOnly="Creating and editing listings, replying to leads, team, promotions and billing are done on nesafric.com for now.">
      {professional ? (
        <RowGroup>
          <ListRow icon="briefcase-outline" title={professional.displayName} detail={humanise(professional.type)} meta={`Your role: ${humanise(professional.myRole)} · ${humanise(professional.verificationStatus)}`} last />
        </RowGroup>
      ) : null}
    </WorkspaceMore>
  );
}
