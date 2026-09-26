import { MarketplaceBusinessProfile } from "@/components/marketplace-business-profile";
import { MarketplaceProShell } from "@/components/marketplace-pro-shell";

export default async function MarketplaceBusinessProfilePage({ params }: { params: Promise<{ professionalId: string }> }) {
  const { professionalId } = await params;
  return (
    <MarketplaceProShell professionalId={professionalId}>
      <MarketplaceBusinessProfile professionalId={professionalId} />
    </MarketplaceProShell>
  );
}
