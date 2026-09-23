import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ListingEditor } from "@/components/listing-editor";

export default async function EditListingPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  return <AppShell actions={<Link className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-surface" href={`/listings/${listingId}`}>Back to listing</Link>} description="Update listing details while preserving its publication and verification rules." eyebrow="LISTING EDITOR" title="Edit listing"><ListingEditor listingId={listingId} /></AppShell>;
}
