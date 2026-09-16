import Link from "next/link";
import { MarketplaceRequestHistory } from "@/components/marketplace-request-history";

export default function MarketplaceRequestsPage() {
  return <main className="min-h-screen bg-warm-white px-4 py-8 text-ink sm:px-6 sm:py-12"><div className="mx-auto max-w-5xl"><header className="mb-8"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal">MARKETPLACE REQUESTS</p><h1 className="mt-2 text-4xl font-semibold text-forest">Provider enquiry history</h1><p className="mt-2 text-muted">Track enquiries and linked quotation requests for the active organisation.</p><Link className="mt-4 inline-block text-sm font-semibold text-forest transition hover:text-teal" href="/marketplace">← Browse providers</Link></header><MarketplaceRequestHistory /></div></main>;
}
