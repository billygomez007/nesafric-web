import { MarketplaceProShell } from "@/components/marketplace-pro-shell";
import { MarketplaceVoiceWorkspace } from "@/components/marketplace-voice-workspace";

export default async function MarketplaceVoicePage({ params }: { params: Promise<{ professionalId: string }> }) {
  const { professionalId } = await params;
  return (
    <MarketplaceProShell professionalId={professionalId}>
      <MarketplaceVoiceWorkspace professionalId={professionalId} />
    </MarketplaceProShell>
  );
}
