import { MarketplaceProShell } from "@/components/marketplace-pro-shell";
import { MarketplaceLeadInbox } from "@/components/marketplace-lead-inbox";

export default async function MarketplaceLeadsPage({ params }: { params: Promise<{ professionalId: string }> }) {
  const { professionalId } = await params;
  return (
    <MarketplaceProShell professionalId={professionalId}>
      <MarketplaceLeadInbox professionalId={professionalId} />
    </MarketplaceProShell>
  );
}
