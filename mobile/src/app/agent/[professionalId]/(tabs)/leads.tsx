import { InboxScreen } from "@/workspace/screens/inbox";
import { useWorkspaceParam } from "@/workspace/shell";

/** The existing agent enquiry and viewing inbox, as a tab. */
export default function LeadsTab() {
  return <InboxScreen kind="professional" id={useWorkspaceParam("professional")} />;
}
