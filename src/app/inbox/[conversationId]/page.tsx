import Link from "next/link";
import { ConversationDetailView } from "@/components/conversation-detail";

export default async function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  return <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
    <div className="mb-6"><Link className="text-sm font-semibold text-emerald-700" href="/inbox">← Inbox</Link></div>
    <ConversationDetailView conversationId={(await params).conversationId} />
  </main>;
}
