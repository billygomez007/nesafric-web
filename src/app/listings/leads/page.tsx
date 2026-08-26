import Link from "next/link";
import { ListingLeadInbox } from "@/components/listing-lead-inbox";

export default function ListingLeadsPage() {
  return <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12"><header className="mb-8"><p className="text-sm font-semibold text-emerald-700">LEASING INBOX</p><h1 className="mt-1 text-3xl font-semibold">Listing leads and viewings</h1><p className="mt-2 text-slate-600">Prospects remain separate from tenant records until a future application workflow.</p><Link className="mt-3 inline-block text-sm font-semibold text-emerald-700" href="/listings">← Listings dashboard</Link></header><ListingLeadInbox /></main>;
}
