import { useWorkspaceParam, WorkspaceMore } from "@/workspace/shell";

export default function ProviderMore() {
  const id = useWorkspaceParam("provider");
  return (
    <WorkspaceMore
      kind="provider"
      webPath={`/providers/${encodeURIComponent(id ?? "")}`}
      webOnly="Accepting or declining jobs, sending quotes, updating your profile and verification documents are done on nesafric.com for now."
    />
  );
}
