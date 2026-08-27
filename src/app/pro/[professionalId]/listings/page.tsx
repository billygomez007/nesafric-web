import { MarketplaceProShell } from "@/components/marketplace-pro-shell";
import { MarketplaceListingsDashboard } from "@/components/marketplace-listings-dashboard";
export default async function Page({ params }: { params: Promise<{ professionalId: string }> }) { const { professionalId } = await params; return <MarketplaceProShell professionalId={professionalId}><MarketplaceListingsDashboard professionalId={professionalId} /></MarketplaceProShell>; }
