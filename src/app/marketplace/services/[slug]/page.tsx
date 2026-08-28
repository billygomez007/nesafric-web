import Link from "next/link";
import { MarketplaceProviderProfile } from "@/components/marketplace-provider-profile";

export default async function PublicServiceProviderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 sm:py-12"><div className="mx-auto max-w-7xl"><Link className="mb-6 inline-block text-sm font-semibold text-navy" href="/marketplace">← Back to marketplace</Link><MarketplaceProviderProfile slug={slug} /></div></main>;
}
