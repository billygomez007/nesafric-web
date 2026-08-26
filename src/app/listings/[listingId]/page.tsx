import Link from "next/link";
import { ListingDetail } from "@/components/listing-detail";

export default async function ListingDetailPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12"><Link className="mb-6 inline-block text-sm font-semibold text-emerald-700" href="/listings">← Listings dashboard</Link><ListingDetail listingId={listingId} /></main>;
}
