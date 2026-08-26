import Link from "next/link";
import { ConversationInbox } from "@/components/conversation-inbox";

export default function InboxPage() {
  return <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
    <div className="mb-6"><Link className="text-sm font-semibold text-emerald-700" href="/dashboard">← Dashboard</Link></div>
    <ConversationInbox />
  </main>;
}
