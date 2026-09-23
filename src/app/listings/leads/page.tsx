import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ListingLeadInbox } from "@/components/listing-lead-inbox";

export default function ListingLeadsPage() {
  return <AppShell actions={<Link className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-surface" href="/listings">Back to listings</Link>} description="Prospects remain separate from tenant records until a future application workflow." eyebrow="LEASING INBOX" title="Listing leads and viewings"><ListingLeadInbox /></AppShell>;
}
