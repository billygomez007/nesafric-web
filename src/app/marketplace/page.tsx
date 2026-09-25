import Link from "next/link";
import { MarketplaceSearch } from "@/components/marketplace-search";
import { MarketplaceCarousel } from "@/components/marketplace-carousel";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { MarketplaceSubnav } from "@/components/marketplace-subnav";

const ROUTES = [
  {
    href: "/marketplace/properties",
    title: "Homes and property",
    description: "Houses, apartments, units and land to rent or buy, published by the people responsible for them.",
    action: "Browse properties",
  },
  {
    href: "/marketplace/professionals",
    title: "Agents, brokers and developers",
    description: "Real estate businesses operating on NesAfric, with their listings and developments in one place.",
    action: "Find a professional",
  },
  {
    href: "#service-providers",
    title: "Service providers",
    description: "Plumbers, electricians, cleaners and other trades — search by category and the area they cover.",
    action: "Search service providers",
  },
];

export default function MarketplacePage() {
  return (
    <>
      <SiteNav />
      <MarketplaceSubnav />
      <main className="min-h-screen bg-warm-white text-ink">
        <section className="mx-auto max-w-[1400px] px-5 pb-6 pt-10 sm:px-8 sm:pt-14">
          <h1 className="max-w-3xl text-3xl font-semibold tracking-[-0.02em] text-forest-deep sm:text-[44px] sm:leading-[1.08]">
            Property, and the people who look after it.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
            Find a home, a real estate professional or a trusted service provider — all working on the same operating
            system as the owners and managers they serve.
          </p>

          <div className="mt-10 divide-y divide-hairline border-y border-hairline">
            {ROUTES.map((route, index) => (
              <Link
                className="group grid gap-2 py-6 sm:grid-cols-[56px_minmax(0,0.9fr)_minmax(0,1.3fr)_auto] sm:items-center sm:gap-6"
                href={route.href}
                key={route.href}
              >
                <span className="text-sm font-semibold tabular-nums text-gold-ink">0{index + 1}</span>
                <h2 className="text-xl font-semibold text-forest-deep group-hover:text-forest">{route.title}</h2>
                <p className="text-sm leading-6 text-muted">{route.description}</p>
                <span className="text-sm font-semibold text-forest group-hover:underline">
                  {route.action} <span aria-hidden="true">→</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-[1400px] px-5 py-8 sm:px-8">
          <MarketplaceCarousel placement="MARKETPLACE_PRIMARY" />
        </section>

        <section className="mx-auto max-w-[1400px] scroll-mt-28 px-5 pb-16 pt-4 sm:px-8" id="service-providers">
          <h2 className="mb-5 text-2xl font-semibold tracking-[-0.01em] text-forest-deep">Find a service provider</h2>
          <MarketplaceSearch />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
