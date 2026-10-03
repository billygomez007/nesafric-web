import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteNav } from "@/components/marketing/site-nav";
import { MarketplaceSubnav } from "@/components/marketplace-subnav";
import { PropertyServicesDirectory } from "@/components/property-services-directory";
import { MarketplaceCarousel } from "@/components/marketplace-carousel";
import { MarketplaceSearch } from "@/components/marketplace-search";
import { CompaniesCarouselSection } from "@/components/marketing/companies-carousel-section";

export const metadata: Metadata = {
  title: "Property Service Professionals in Ghana",
  description:
    "Find trusted property service professionals and companies across Ghana.",
  alternates: { canonical: "/marketplace/services" },
};

export default function PropertyServicesPage() {
  return (
    <>
      <SiteNav />
      <MarketplaceSubnav />

      <main className="min-h-screen bg-warm-white text-ink">
        <section className="border-b border-hairline bg-warm-white">
          <div className="mx-auto max-w-[1400px] px-5 pb-8 pt-8 sm:px-8 sm:pb-10 sm:pt-12">
            <header className="max-w-4xl">
              <h1 className="text-3xl font-semibold tracking-[-0.025em] text-forest-deep sm:text-[44px] sm:leading-[1.05]">
                Find your perfect professional
              </h1>

              <p className="mt-3 max-w-2xl text-base leading-7 text-muted">
                Search trusted professionals and companies for your property.
              </p>
            </header>

            <form
              action="/marketplace/services"
              className="mt-7 max-w-4xl"
              method="get"
              role="search"
            >
              <label className="sr-only" htmlFor="service-provider-search">
                Search service providers
              </label>

              <div className="flex min-h-14 items-center gap-3 rounded-2xl border border-hairline bg-white px-5 shadow-sm focus-within:border-forest">
                <svg
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 text-muted"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>

                <input
                  className="min-w-0 flex-1 bg-transparent py-4 text-base text-ink outline-none placeholder:text-muted"
                  id="service-provider-search"
                  maxLength={200}
                  name="q"
                  placeholder="Search plumbers, electricians, cleaners..."
                  type="search"
                />

                <button
                  className="rounded-xl bg-forest px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
                  type="submit"
                >
                  Search
                </button>
              </div>
            </form>

            <section
              aria-labelledby="service-categories"
              className="mt-8"
            >
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h2
                    className="text-xl font-semibold text-forest-deep"
                    id="service-categories"
                  >
                    Browse services
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    Choose a category to explore available professionals.
                  </p>
                </div>
              </div>

              <PropertyServicesDirectory
                limit={8}
                variant="rail"
              />
            </section>

            <MarketplaceCarousel
              frameClassName="mt-8 overflow-hidden rounded-[var(--radius-panel)]"
              placement="SERVICE_MARKETPLACE_PRIMARY"
            />
          </div>
        </section>

        <CompaniesCarouselSection
          compact
          emptyState
          title="Trusted by leading companies"
        />

        <section
          aria-labelledby="service-providers"
          className="mx-auto max-w-[1400px] px-5 pb-16 pt-10 sm:px-8"
        >
          <div className="mb-6">
            <h2
              className="text-2xl font-semibold tracking-[-0.02em] text-forest-deep"
              id="service-providers"
            >
              Service providers
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Discover professionals and companies available on NesAfric.
            </p>
          </div>

          <Suspense
            fallback={
              <p className="text-sm text-muted" role="status">
                Loading service providers…
              </p>
            }
          >
            <MarketplaceSearch />
          </Suspense>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
