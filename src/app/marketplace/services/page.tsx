import type { Metadata } from "next";
import { Suspense } from "react";
import { MarketplaceSearch } from "@/components/marketplace-search";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { MarketplaceSubnav } from "@/components/marketplace-subnav";

export const metadata: Metadata = {
  title: "Property service providers in Ghana",
  description: "Find plumbers, electricians, cleaners, security and other property service providers on NesAfric, by service and the area they cover.",
  alternates: { canonical: "/marketplace/services" },
};

export default function ServiceProvidersPage() {
  return (
    <>
      <SiteNav />
      <MarketplaceSubnav />
      <main className="min-h-screen bg-warm-white text-ink">
        <div className="mx-auto max-w-[1400px] px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
          <header className="max-w-2xl">
            <h1 className="text-3xl font-semibold tracking-[-0.02em] text-forest-deep sm:text-[40px] sm:leading-[1.1]">Service providers</h1>
            <p className="mt-3 text-base leading-7 text-muted">
              Trades and property services working with owners and managers on NesAfric. Search by service, area and availability.
            </p>
          </header>
          <div className="mt-8">
            <Suspense fallback={<p className="text-sm text-muted" role="status">Loading service providers…</p>}>
              <MarketplaceSearch />
            </Suspense>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
