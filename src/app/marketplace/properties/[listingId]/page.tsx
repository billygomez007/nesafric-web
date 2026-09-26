import Link from "next/link";
import { PublicListingDetail } from "@/components/public-listing-detail";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { MarketplaceSubnav } from "@/components/marketplace-subnav";

export default async function PublicListingPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  return (
    <>
      <SiteNav />
      <MarketplaceSubnav />
      <main className="min-h-screen bg-warm-white">
        <div className="mx-auto max-w-[1400px] px-5 py-6 sm:px-8 sm:py-10">
          <Link className="mb-5 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-forest hover:underline" href="/marketplace/properties">
            <span aria-hidden="true">←</span> All properties
          </Link>
          <PublicListingDetail listingId={listingId} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
