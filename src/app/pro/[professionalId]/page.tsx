import { MarketplaceProShell } from "@/components/marketplace-pro-shell";
import { MarketplaceProfileDashboard } from "@/components/marketplace-profile-dashboard";

export default async function MarketplaceProfessionalProfilePage({ params }: { params: Promise<{ professionalId: string }> }) {
  const { professionalId } = await params;
  return (
    <MarketplaceProShell professionalId={professionalId}>
      <MarketplaceProfileDashboard professionalId={professionalId} />
    </MarketplaceProShell>
  );
}
