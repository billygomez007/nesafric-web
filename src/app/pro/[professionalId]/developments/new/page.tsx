import { MarketplaceProShell } from "@/components/marketplace-pro-shell";
import { MarketplaceDevelopmentForm } from "@/components/marketplace-development-form";

export default async function NewMarketplaceDevelopmentPage({ params }: { params: Promise<{ professionalId: string }> }) {
  const { professionalId } = await params;
  return (
    <MarketplaceProShell professionalId={professionalId}>
      <h1 className="text-2xl font-semibold">New development</h1>
      <MarketplaceDevelopmentForm professionalId={professionalId} />
    </MarketplaceProShell>
  );
}
