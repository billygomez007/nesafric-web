import type { Metadata } from "next";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteNav } from "@/components/marketing/site-nav";
import { MarketplaceSubnav } from "@/components/marketplace-subnav";
import { PropertyServicesDirectory } from "@/components/property-services-directory";

export const metadata: Metadata = {
  title: "Property Services in Ghana",
  description:
    "Find trusted professionals and companies for every stage of your property.",
  alternates: { canonical: "/marketplace/services" },
};

export default function PropertyServicesPage() {
  return (
    <>
      <SiteNav />
      <MarketplaceSubnav />
      <main className="min-h-screen bg-warm-white text-ink">
        <div className="mx-auto max-w-[1400px] px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
          <header className="max-w-3xl">
            <h1 className="text-3xl font-semibold tracking-[-0.02em] text-forest-deep sm:text-[40px] sm:leading-[1.1]">
              Property Services
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted">
              Find trusted professionals and companies for every stage of your
              property.
            </p>
          </header>

          <section
            aria-labelledby="property-services-categories"
            className="mt-10"
          >
            <div className="mb-5">
              <h2
                className="text-xl font-semibold text-forest-deep"
                id="property-services-categories"
              >
                Browse by category
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted">
                Choose a property service category to see its available
                services.
              </p>
            </div>

            <PropertyServicesDirectory />
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
