import Link from "next/link";
import { MarketplaceProviderProfile } from "@/components/marketplace-provider-profile";

export default async function PublicProviderPage({ params }: { params: Promise<{ providerId: string }> }) {
  const { providerId } = await params;
  return <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 sm:py-12"><div className="mx-auto max-w-7xl"><Link className="mb-6 inline-block text-sm font-semibold text-navy" href="/marketplace">← Back to marketplace</Link><MarketplaceProviderProfile providerId={providerId} /></div></main>;
}
