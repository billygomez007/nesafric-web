import Link from "next/link";
import { ListingEditor } from "@/components/listing-editor";

export default async function EditListingPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  return <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12"><header className="mb-8"><h1 className="text-3xl font-semibold">Edit listing</h1><Link className="mt-3 inline-block text-sm font-semibold text-emerald-700" href={`/listings/${listingId}`}>← Listing detail</Link></header><ListingEditor listingId={listingId} /></main>;
}
