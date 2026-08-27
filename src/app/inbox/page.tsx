import { AppShell } from "@/components/app-shell";
import { ConversationInbox } from "@/components/conversation-inbox";

export default function InboxPage() {
  return (
    <AppShell description="Every organisation conversation, across channels, in one inbox." eyebrow="COMMUNICATIONS" title="Inbox">
      <ConversationInbox />
    </AppShell>
  );
}
