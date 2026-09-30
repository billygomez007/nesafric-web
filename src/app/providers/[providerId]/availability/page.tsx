import { ProviderWorkspacePage } from "@/components/provider-workspace-page";

export default async function ProviderAvailabilityPage({
  params,
}: {
  params: Promise<{ providerId: string }>;
}) {
  const { providerId } = await params;
  return (
    <ProviderWorkspacePage
      providerId={providerId}
      section="availability"
    />
  );
}
