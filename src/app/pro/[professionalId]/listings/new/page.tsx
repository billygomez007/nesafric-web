import { MarketplaceProShell } from "@/components/marketplace-pro-shell";
import { MarketplaceListingForm } from "@/components/marketplace-listing-form";
export default async function Page({ params }: { params: Promise<{ professionalId: string }> }) { const { professionalId } = await params; return <MarketplaceProShell professionalId={professionalId}><MarketplaceListingForm professionalId={professionalId} /></MarketplaceProShell>; }
