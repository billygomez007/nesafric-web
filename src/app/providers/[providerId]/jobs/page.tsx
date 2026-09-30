import { ProviderWorkspacePage } from "@/components/provider-workspace-page";

export default async function ProviderJobsPage({
  params,
}: {
  params: Promise<{ providerId: string }>;
}) {
  const { providerId } = await params;
  return <ProviderWorkspacePage providerId={providerId} section="jobs" />;
}
