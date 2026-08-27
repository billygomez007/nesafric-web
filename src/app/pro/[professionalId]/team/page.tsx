import { MarketplaceProShell } from "@/components/marketplace-pro-shell";
import { MarketplaceTeamManager } from "@/components/marketplace-team-manager";

export default async function MarketplaceTeamPage({ params }: { params: Promise<{ professionalId: string }> }) {
  const { professionalId } = await params;
  return (
    <MarketplaceProShell professionalId={professionalId}>
      <MarketplaceTeamManager professionalId={professionalId} />
    </MarketplaceProShell>
  );
}
