import { MarketplaceProShell } from "@/components/marketplace-pro-shell";
import { MarketplaceDevelopmentDetail } from "@/components/marketplace-development-detail";

export default async function MarketplaceDevelopmentPage({ params }: { params: Promise<{ professionalId: string; developmentId: string }> }) {
  const { professionalId, developmentId } = await params;
  return (
    <MarketplaceProShell professionalId={professionalId}>
      <MarketplaceDevelopmentDetail developmentId={developmentId} professionalId={professionalId} />
    </MarketplaceProShell>
  );
}
