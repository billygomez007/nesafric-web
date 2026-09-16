import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ListingDetail } from "@/components/listing-detail";

export default async function ListingDetailPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  return <AppShell actions={<Link className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-surface" href="/listings">Back to listings</Link>} description="Review content, visibility, attribution, media, and listing history." eyebrow="LISTING" title="Listing details"><ListingDetail listingId={listingId} /></AppShell>;
}
