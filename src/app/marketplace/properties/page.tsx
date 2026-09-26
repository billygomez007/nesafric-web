import type { Metadata } from "next";
import { Suspense } from "react";
import { PropertyMarketplaceSearch } from "@/components/property-marketplace-search";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { MarketplaceSubnav } from "@/components/marketplace-subnav";

export const metadata: Metadata = {
  title: "Homes and property to rent or buy in Ghana",
  description: "Search houses, apartments, land and commercial property to rent or buy across Ghana, published by the owners, managers, agents and developers responsible for them.",
  alternates: { canonical: "/marketplace/properties" },
};

export default function PropertyMarketplacePage() {
  return (
    <>
      <SiteNav />
      <MarketplaceSubnav />
      <main className="min-h-screen bg-warm-white">
        <div className="mx-auto max-w-[1400px] px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
          <header className="max-w-2xl">
            <h1 className="text-3xl font-semibold tracking-[-0.02em] text-forest-deep sm:text-[40px] sm:leading-[1.1]">
              Homes and property to rent or buy
            </h1>
            <p className="mt-3 text-base leading-7 text-muted">
              Every listing is published by the owner, manager or agent responsible for it. Verified listings have had
              their authority to list checked by NesAfric.
            </p>
          </header>
          <div className="mt-8">
            <Suspense fallback={<p className="text-sm text-muted" role="status">Loading properties…</p>}>
              <PropertyMarketplaceSearch />
            </Suspense>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
