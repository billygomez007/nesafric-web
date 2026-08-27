import Link from "next/link";
import { MarketplaceRequestHistory } from "@/components/marketplace-request-history";

export default function MarketplaceRequestsPage() {
  return <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 sm:py-12"><div className="mx-auto max-w-5xl"><header className="mb-8"><p className="text-sm font-semibold text-navy">MARKETPLACE REQUESTS</p><h1 className="mt-1 text-3xl font-semibold">Provider enquiry history</h1><p className="mt-2 text-slate-600">Track enquiries and linked quotation requests for the active organisation.</p><Link className="mt-3 inline-block text-sm font-semibold text-navy" href="/marketplace">← Browse providers</Link></header><MarketplaceRequestHistory /></div></main>;
}
