import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ConversationDetailView } from "@/components/conversation-detail";

export default async function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  return <AppShell description="Review messages, context and next actions for every conversation." eyebrow="COMMUNICATIONS" title="Conversation">
    <div className="mb-5"><Link className="text-sm font-semibold text-forest transition hover:text-teal" href="/inbox">← Back to inbox</Link></div>
    <ConversationDetailView conversationId={(await params).conversationId} />
  </AppShell>;
}
