"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CompaniesCarouselSection } from "@/components/marketing/companies-carousel-section";
import { ListingCard, type PublicListing } from "@/components/property-marketplace-search";
import { buttonClass } from "@/components/ui/button-styles";

/**
 * Data-driven body of the marketplace homepage. Every section renders only from real public data
 * (listings, campaigns, directory, service categories) and disappears when there is nothing to
 * show — no placeholder listings, counts, ads or rankings.
 */

const LISTING_SAMPLE_SIZE = 50;
const SECTION_SIZE = 6;

type ListingsResult = { items: PublicListing[]; pagination: { total: number } };
const NO_LISTINGS: ListingsResult = { items: [], pagination: { total: 0 } };

/** Fetches public JSON. `onError`, when given, is used as the result if the request fails, so a
 * section can settle into its empty state instead of waiting forever. */
function useJson<T>(url: string, onError?: T) {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(async (response) => { if (response.ok) setData(await response.json()); else if (onError !== undefined) setData(onError); })
      .catch(() => { if (onError !== undefined && !controller.signal.aborted) setData(onError); });
    return () => controller.abort();
    // `onError` is a constant empty result per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return data;
}

function SectionHeading({ id, title, action }: { id: string; title: string; action?: { href: string; label: string } }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <h2 className="text-2xl font-semibold tracking-[-0.015em] text-forest-deep sm:text-[28px]" id={id}>{title}</h2>
      {action && (
        <Link className="text-sm font-semibold text-forest hover:underline" href={action.href}>
          {action.label} <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  );
}

/* ---------- Property discovery ---------- */

type Tab = { key: string; label: string; items: PublicListing[]; href: string };

function PropertyDiscovery({ result }: { result: ListingsResult | null }) {
  const tabs = useMemo<Tab[]>(() => {
    if (!result) return [];
    const all = result.items;
    return [
      { key: "recent", label: "Recent listings", items: all.slice(0, SECTION_SIZE), href: "/marketplace/properties" },
      { key: "rent", label: "For rent", items: all.filter((item) => item.listingType === "RENT").slice(0, SECTION_SIZE), href: "/marketplace/properties?listingType=RENT" },
      { key: "sale", label: "For sale", items: all.filter((item) => item.listingType === "SALE").slice(0, SECTION_SIZE), href: "/marketplace/properties?listingType=SALE" },
    ].filter((tab) => tab.items.length > 0);
  }, [result]);
  const [active, setActive] = useState("recent");
  const current = tabs.find((tab) => tab.key === active) ?? tabs[0];

  if (!result) {
    return (
      <section aria-busy="true" aria-labelledby="discover-heading" className="mx-auto max-w-[1400px] px-5 py-14 sm:px-8 sm:py-20">
        <SectionHeading id="discover-heading" title="Properties on NesAfric" />
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" role="status">
          <span className="sr-only">Loading properties</span>
          {[0, 1, 2].map((key) => <div aria-hidden="true" className={`aspect-[4/3] rounded-[var(--radius-panel)] bg-surface/70 ${key > 0 ? "hidden sm:block" : ""} ${key > 1 ? "sm:hidden lg:block" : ""}`} key={key} />)}
        </div>
      </section>
    );
  }

  if (!current) {
    return (
      <section aria-labelledby="discover-heading" className="mx-auto max-w-[1400px] px-5 py-14 sm:px-8 sm:py-20">
        <SectionHeading id="discover-heading" title="Properties on NesAfric" />
        <div className="mt-6 flex flex-col gap-4 border-y border-hairline py-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-sm leading-6 text-muted">
            Listings appear here as soon as owners, managers and agents publish them. Have property to let or sell?
          </p>
          <Link className={buttonClass("secondary", "sm")} href="/for-professionals">List a property</Link>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="discover-heading" className="mx-auto max-w-[1400px] px-5 py-14 sm:px-8 sm:py-20">
      <SectionHeading action={{ href: current.href, label: "See all" }} id="discover-heading" title="Properties on NesAfric" />
      {tabs.length > 1 && (
        <div aria-label="Property lists" className="mt-5 flex gap-1 overflow-x-auto border-b border-hairline [scrollbar-width:none]" role="tablist">
          {tabs.map((tab) => (
            <button
              aria-selected={tab.key === current.key}
              className={`relative min-h-11 shrink-0 px-3 text-sm font-semibold transition-colors ${
                tab.key === current.key ? "text-forest-deep after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-forest" : "text-muted hover:text-forest"
              }`}
              key={tab.key}
              onClick={() => setActive(tab.key)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      <div className="mt-8 grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3" role={tabs.length > 1 ? "tabpanel" : undefined}>
        {current.items.map((listing) => <ListingCard key={listing.id} listing={listing} />)}
      </div>
    </section>
  );
}

/* ---------- Popular locations (derived from real listings) ---------- */

type Place = { label: string; context: string | null; href: string; count: number };

function derivePlaces(result: ListingsResult): { places: Place[]; exact: boolean } {
  const map = new Map<string, Place>();
  const add = (label: string | null, context: string | null, param: "city" | "district") => {
    if (!label) return;
    const key = `${param}:${label.toLowerCase()}`;
    const existing = map.get(key);
    if (existing) { existing.count += 1; return; }
    const params = new URLSearchParams({ country: "GH", [param]: label });
    map.set(key, { label, context, href: `/marketplace/properties?${params.toString()}`, count: 1 });
  };
  for (const listing of result.items) {
    add(listing.location.city, listing.location.region, "city");
    add(listing.location.district, listing.location.city, "district");
  }
  const places = [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 8);
  // Counts are only exact when the whole public inventory fitted in the sample we loaded.
  return { places, exact: result.pagination.total <= result.items.length };
}

function PopularLocations({ result }: { result: ListingsResult | null }) {
  if (!result || result.items.length === 0) return null;
  const { places, exact } = derivePlaces(result);
  if (places.length === 0) return null;
  return (
    <section aria-labelledby="places-heading" className="mx-auto max-w-[1400px] px-5 py-14 sm:px-8 sm:py-20">
      <SectionHeading id="places-heading" title="Where people are listing" />
      <ul className="mt-6 grid border-t border-hairline sm:grid-cols-2 lg:grid-cols-4">
        {places.map((place) => (
          <li className="border-b border-hairline sm:odd:border-r lg:border-r lg:[&:nth-child(4n)]:border-r-0" key={place.href}>
            <Link className="group flex min-h-16 items-center justify-between gap-4 px-1 py-4 sm:px-4" href={place.href}>
              <span>
                <span className="block font-display text-[15px] font-semibold text-forest-deep group-hover:underline">{place.label}</span>
                {place.context && <span className="block text-xs text-muted">{place.context}</span>}
              </span>
              {exact && (
                <span className="text-sm tabular-nums text-muted">
                  {place.count} {place.count === 1 ? "listing" : "listings"}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- Professionals and developers ---------- */

const PROFESSIONAL_ENTRIES = [
  { type: "INDIVIDUAL_AGENT", title: "Agents", description: "Independent agents who list, show and let or sell property." },
  { type: "BROKERAGE", title: "Brokerages", description: "Firms with teams of agents working one shared pipeline." },
  { type: "REAL_ESTATE_COMPANY", title: "Property companies", description: "Companies that own, manage or market property portfolios." },
  { type: "DEVELOPER", title: "Developers", description: "Builders selling new apartments, homes and plots, unit by unit." },
];

function DirectoryCount({ type }: { type: string }) {
  // Same eligibility as the company carousel: verified professionals only.
  const data = useJson<{ total?: number; pagination?: { total: number } }>(`/api/public/marketplace-directory?type=${type}&verifiedOnly=true&page=1&pageSize=1`);
  const total = data?.total ?? data?.pagination?.total;
  if (!total) return null;
  return <span className="text-sm tabular-nums text-muted">{total} verified</span>;
}

function ProfessionalDiscovery() {
  return (
    <section aria-labelledby="pros-heading" className="mx-auto max-w-[1400px] px-5 py-14 sm:px-8 sm:py-20">
      <SectionHeading action={{ href: "/marketplace/professionals", label: "Full directory" }} id="pros-heading" title="Agents, brokerages and developers" />
      <div className="mt-6 divide-y divide-hairline border-y border-hairline">
        {PROFESSIONAL_ENTRIES.map((entry, index) => (
          <Link
            className="group grid gap-2 py-5 sm:grid-cols-[56px_minmax(0,0.8fr)_minmax(0,1.3fr)_auto] sm:items-center sm:gap-6"
            href={`/marketplace/professionals?type=${entry.type}`}
            key={entry.type}
          >
            <span className="text-sm font-semibold tabular-nums text-gold-ink">0{index + 1}</span>
            <span className="font-display text-lg font-semibold text-forest-deep group-hover:underline">{entry.title}</span>
            <span className="text-sm leading-6 text-muted">{entry.description}</span>
            <DirectoryCount type={entry.type} />
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ---------- Service providers ---------- */

type ServiceCategory = { id: string; key: string; name: string };
type ProviderPage = { items: Array<{ categories: ServiceCategory[] }>; pagination: { total: number } };

const PROVIDER_SAMPLE_SIZE = 50;

/**
 * Which service categories have at least one public provider. Derived from the provider sample
 * when it holds every public provider; otherwise asked per category, so a category link is only
 * ever shown when the search behind it returns someone. `null` while loading.
 */
function useCategoriesWithProviders(categories: ServiceCategory[] | null, providers: ProviderPage | null) {
  const [perCategory, setPerCategory] = useState<Record<string, number> | null>(null);
  const needsPerCategory = !!categories && !!providers && providers.pagination.total > providers.items.length;

  useEffect(() => {
    if (!needsPerCategory || !categories) return;
    const controller = new AbortController();
    Promise.all(categories.map(async (category) => {
      const response = await fetch(`/api/public/marketplace/providers?category=${encodeURIComponent(category.key)}&page=1&pageSize=1`, { signal: controller.signal });
      const body = response.ok ? await response.json() as ProviderPage : null;
      return [category.key, body?.pagination.total ?? 0] as const;
    })).then((entries) => setPerCategory(Object.fromEntries(entries))).catch(() => {});
    return () => controller.abort();
  }, [needsPerCategory, categories]);

  if (!categories || !providers) return null;
  if (providers.pagination.total === 0) return [];
  if (!needsPerCategory) {
    const offered = new Set(providers.items.flatMap((provider) => provider.categories.map((category) => category.key)));
    return categories.filter((category) => offered.has(category.key));
  }
  return perCategory ? categories.filter((category) => (perCategory[category.key] ?? 0) > 0) : null;
}

function ServiceProviders() {
  const categories = useJson<ServiceCategory[]>("/api/public/marketplace/categories");
  const providers = useJson<ProviderPage>(`/api/public/marketplace/providers?page=1&pageSize=${PROVIDER_SAMPLE_SIZE}`);
  const offered = useCategoriesWithProviders(categories, providers);

  if (offered === null) return null;

  // No public providers yet: invite providers rather than showing empty consumer destinations.
  if (offered.length === 0) {
    return (
      <section aria-labelledby="services-heading" className="border-t border-hairline bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <h2 className="text-xl font-semibold text-forest-deep" id="services-heading">Offer property services?</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted">
              Plumbers, electricians, cleaners and other trades can join NesAfric to be found by the owners and managers who need them.
            </p>
          </div>
          <Link className={`${buttonClass("secondary", "sm")} shrink-0`} href="/register">Join as a service provider</Link>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="services-heading" className="border-t border-hairline bg-white">
      <div className="mx-auto grid max-w-[1400px] gap-8 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.015em] text-forest-deep sm:text-[28px]" id="services-heading">Service providers</h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-muted">
            Plumbers, electricians, cleaners and other trades who work with owners and managers on NesAfric.
          </p>
          <Link className={`${buttonClass("secondary", "sm")} mt-5`} href="/marketplace/services">Find a service provider</Link>
        </div>
        <ul aria-label="Services" className="flex flex-wrap content-start gap-2">
          {offered.slice(0, 16).map((category) => (
            <li key={category.id}>
              <Link
                className="inline-flex min-h-10 items-center rounded-full border border-hairline px-4 text-sm font-medium text-forest-deep transition hover:border-forest/40 hover:bg-warm-white"
                href={`/marketplace/services?category=${encodeURIComponent(category.key)}`}
              >
                {category.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------- Business gateway ---------- */

const GATEWAY = [
  { title: "I own or manage property", description: "Tenants, leases, rent and repairs on one record — and your vacancies on the marketplace.", href: "/for-property-owners" },
  { title: "I'm an agent or broker", description: "A public profile, your listings, a lead inbox and viewings in one place.", href: "/for-professionals" },
  { title: "I'm a developer", description: "Sell units floor by floor and hand delivered units to property management.", href: "/for-developers" },
  { title: "I'm a service provider", description: "Be found by owners and managers, receive jobs and build a reputation.", href: "/register" },
];

function BusinessGateway() {
  return (
    <section aria-labelledby="gateway-heading" className="bg-forest-deep text-white">
      <div className="mx-auto grid max-w-[1400px] gap-8 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.015em] sm:text-[32px]" id="gateway-heading">Run property on NesAfric</h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-white/75">
            The marketplace sits on top of the NesAfric operating platform: the listing a buyer sees is the same record its owner uses for tenants, rent and maintenance.
          </p>
          <Link className="mt-5 inline-flex text-sm font-semibold text-gold-soft hover:underline" href="/platform">
            How the platform works <span aria-hidden="true" className="ml-1">→</span>
          </Link>
        </div>
        <div className="divide-y divide-white/10 border-y border-white/10">
          {GATEWAY.map((item) => (
            <Link className="group grid gap-1 py-5 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)_auto] sm:items-center sm:gap-6" href={item.href} key={item.title}>
              <span className="font-display text-[17px] font-semibold group-hover:underline">{item.title}</span>
              <span className="text-sm leading-6 text-white/70">{item.description}</span>
              <span aria-hidden="true" className="text-gold-soft transition-transform group-hover:translate-x-1">→</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Page body ---------- */

export function MarketplaceHome() {
  const listings = useJson<ListingsResult>(`/api/public/listings?page=1&pageSize=${LISTING_SAMPLE_SIZE}`, NO_LISTINGS);
  return (
    <>
      <CompaniesCarouselSection emptyState title="Trusted by leading companies" />
      <PropertyDiscovery result={listings} />
      <PopularLocations result={listings} />
      <ProfessionalDiscovery />
      <ServiceProviders />
      <BusinessGateway />
    </>
  );
}
