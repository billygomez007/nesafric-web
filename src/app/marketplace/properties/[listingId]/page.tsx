import Link from "next/link";
import { PublicListingDetail } from "@/components/public-listing-detail";

export default async function PublicListingPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  return <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 sm:py-12"><div className="mx-auto max-w-7xl"><Link className="mb-6 inline-block text-sm font-semibold text-navy" href="/marketplace/properties">← Back to property search</Link><PublicListingDetail listingId={listingId} /></div></main>;
}
