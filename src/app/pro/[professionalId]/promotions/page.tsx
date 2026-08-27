import { MarketplaceProShell } from "@/components/marketplace-pro-shell";
import { MarketplacePromotions } from "@/components/marketplace-promotions";

export default async function MarketplacePromotionsPage({ params }: { params: Promise<{ professionalId: string }> }) {
  const { professionalId } = await params;
  return (
    <MarketplaceProShell professionalId={professionalId}>
      <MarketplacePromotions professionalId={professionalId} />
    </MarketplaceProShell>
  );
}
