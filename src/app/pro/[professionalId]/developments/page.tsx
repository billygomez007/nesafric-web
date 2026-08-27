import { MarketplaceProShell } from "@/components/marketplace-pro-shell";
import { MarketplaceDevelopmentsDashboard } from "@/components/marketplace-developments-dashboard";

export default async function MarketplaceDevelopmentsPage({ params }: { params: Promise<{ professionalId: string }> }) {
  const { professionalId } = await params;
  return (
    <MarketplaceProShell professionalId={professionalId}>
      <MarketplaceDevelopmentsDashboard professionalId={professionalId} />
    </MarketplaceProShell>
  );
}
