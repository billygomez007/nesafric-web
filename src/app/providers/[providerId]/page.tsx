import { ProviderDetail } from "@/components/provider-detail";

export default async function ProviderDetailPage({ params }: { params: Promise<{ providerId: string }> }) {
  const { providerId } = await params;
  return <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-12"><ProviderDetail providerId={providerId} /></main>;
}
