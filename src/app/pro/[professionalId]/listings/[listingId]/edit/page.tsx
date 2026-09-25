import { MarketplaceProShell } from "@/components/marketplace-pro-shell";
import { MarketplaceListingEditor } from "@/components/marketplace-listing-editor";

export default async function Page({ params }: { params: Promise<{ professionalId: string; listingId: string }> }) {
  const { professionalId, listingId } = await params;
  return (
    <MarketplaceProShell professionalId={professionalId}>
      <MarketplaceListingEditor listingId={listingId} professionalId={professionalId} />
    </MarketplaceProShell>
  );
}
