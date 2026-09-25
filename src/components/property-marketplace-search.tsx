"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MarketplaceCarousel } from "@/components/marketplace-carousel";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { buttonClass } from "@/components/ui/button-styles";
import { formatListingPrice, frequencySuffix, humanize, listingLocation, listingTypeLabel, scopeLabel, specLine } from "@/lib/listing-display";
import { categorical, compactParams, trackEvent } from "@/platform/analytics";

export type PublicListing = { id: string; listingType: string; scope: string; category: string; title: string; description: string; pricing: { askingAmountMinor: string | null; rentAmountMinor: string | null; currencyCode: string; frequency: string | null }; availability: { availableFrom: string; actual: boolean }; attributes: { bedrooms: number | null; bathrooms: string | null; sizeSqm: string | null }; location: { countryCode: string; region: string | null; city: string | null; district: string | null; locality: string | null; label: string | null; map: { latitude: string | null; longitude: string | null; precision: string | null; geocodingRequired: boolean } }; amenities: { key: string; label: string; category: string | null }[]; media: { id: string; type: string; url: string; altText: string | null; title: string | null }[]; contact: { name: string | null; email: string | null; phone: string | null; enquiryEnabled: boolean }; verification: { status: string; evidenceReady: boolean }; attribution: { listedBy: string; professional: { displayName: string; slug: string; type: string; verificationStatus: string } | null }; publishedAt: string };
type Result = { items: PublicListing[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; meta: { availability: string; map: { countryNeutral: boolean } } };

const fieldClass =
  "h-11 w-full rounded-[var(--radius-control)] border border-hairline bg-white px-3 text-sm text-ink outline-none transition placeholder:text-slate-500 focus:border-forest focus:ring-2 focus:ring-forest/10";
const labelClass = "mb-1.5 block text-xs font-medium text-muted";

const PASS_THROUGH_KEYS = ["q", "listingType", "category", "scope", "country", "region", "city", "district", "bedroomsMin", "bathroomsMin", "currencyCode", "availableOn", "amenities"] as const;
const ADVANCED_KEYS = ["category", "scope", "country", "region", "city", "district", "bathroomsMin", "currencyCode", "availableOn", "amenities", "minPrice"];

/** Location filters need a country for the public API; NesAfric's marketplace is Ghana-first. */
function withDefaultCountry(params: URLSearchParams) {
  if (!params.get("country") && (params.get("region") || params.get("city") || params.get("district"))) params.set("country", "GH");
  return params;
}

/** Reads a deep link such as ?listingType=RENT&region=Greater%20Accra&maxPrice=9000 into form
 * defaults and the equivalent public-listings API query (prices arrive in whole cedis). */
function initialFromUrl(searchParams: URLSearchParams) {
  const form: Record<string, string> = {};
  const api = new URLSearchParams();
  for (const key of PASS_THROUGH_KEYS) {
    const value = searchParams.get(key)?.trim();
    if (value) { form[key] = value; api.set(key, value); }
  }
  for (const [formKey, apiKey] of [["minPrice", "minPriceMinor"], ["maxPrice", "maxPriceMinor"]] as const) {
    const whole = searchParams.get(formKey)?.trim();
    if (whole && Number.isFinite(Number(whole)) && Number(whole) >= 0) { form[formKey] = whole; api.set(apiKey, String(Math.round(Number(whole) * 100))); }
  }
  withDefaultCountry(api);
  return { form, api: api.toString(), advanced: ADVANCED_KEYS.some((key) => form[key]) };
}

export function PropertyMarketplaceSearch() {
  const searchParams = useSearchParams();
  const initial = useMemo(() => initialFromUrl(new URLSearchParams(searchParams?.toString() ?? "")), [searchParams]);
  const [result, setResult] = useState<Result | null>(null);
  const [query, setQuery] = useState(initial.api);
  const [error, setError] = useState("");
  const [filtered, setFiltered] = useState(initial.api.length > 0);
  async function search(search = "") {
    const response = await fetch(`/api/public/listings${search ? `?${search}` : ""}`);
    if (!response.ok) throw new Error((await response.json()).error?.message ?? "Unable to search listings.");
    setResult(await response.json());
  }
  useEffect(() => {
    setQuery(initial.api);
    setFiltered(initial.api.length > 0);
    void search(initial.api).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load listings."));
  }, [initial.api]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const key of ["q", "listingType", "category", "scope", "country", "region", "city", "district", "bedroomsMin", "bathroomsMin", "currencyCode", "availableOn", "amenities"]) {
      const value = String(data.get(key) ?? "").trim();
      if (value) params.set(key, value);
    }
    // The public API filters on minor currency units (e.g. pesewas), but showing that to a
    // consumer would be confusing — the form collects a whole-currency-unit amount (e.g. "2200"
    // meaning GHS 2,200) and converts it here, at the boundary, before it ever reaches the API.
    for (const [formKey, apiKey] of [["minPrice", "minPriceMinor"], ["maxPrice", "maxPriceMinor"]] as const) {
      const whole = String(data.get(formKey) ?? "").trim();
      if (whole) params.set(apiKey, String(Math.round(Number(whole) * 100)));
    }
    withDefaultCountry(params);
    setQuery(params.toString());
    setFiltered(params.toString().length > 0);
    // Keep the address bar shareable: whole-cedi prices and the plain filters, no pagination.
    const shareable = new URLSearchParams();
    for (const key of [...PASS_THROUGH_KEYS, "minPrice", "maxPrice"]) {
      const value = String(data.get(key) ?? "").trim();
      if (value) shareable.set(key, value);
    }
    window.history.replaceState(null, "", `${window.location.pathname}${shareable.toString() ? `?${shareable.toString()}` : ""}`);
    setError("");
    // Engagement, not a conversion — fires once per explicit form submission (never per keystroke,
    // never on the initial unfiltered load in the mount effect above). The free-text "q" field is
    // never sent verbatim, only whether one was used.
    trackEvent("property_search", compactParams({
      transaction_type: categorical(String(data.get("listingType") ?? "")),
      property_type: categorical(String(data.get("category") ?? "")),
      region: categorical(String(data.get("region") ?? "")),
      city: categorical(String(data.get("city") ?? "")),
      has_keyword: Boolean(String(data.get("q") ?? "").trim()),
    }));
    void search(params.toString()).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to search listings."));
  }
  function reset() {
    window.history.replaceState(null, "", window.location.pathname);
    setQuery("");
    setFiltered(false);
    setError("");
    void search().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load listings."));
  }

  return (
    <div className="grid gap-8">
      <MarketplaceCarousel placement="MARKETPLACE_INLINE" />

      <form aria-label="Search public listings" className="border-y border-hairline py-5" key={initial.api} onReset={reset} onSubmit={submit}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] md:items-end">
          <div className="col-span-2 md:col-span-1">
            <label className={labelClass} htmlFor="pms-q">Area, neighbourhood or keyword</label>
            <input className={fieldClass} defaultValue={initial.form.q ?? ""} id="pms-q" name="q" placeholder="e.g. East Legon, 3 bedroom" type="search" />
          </div>
          <div>
            <label className={labelClass} htmlFor="pms-type">Rent or buy</label>
            <select className={fieldClass} defaultValue={initial.form.listingType ?? ""} id="pms-type" name="listingType">
              <option value="">Rent or buy</option>
              <option value="RENT">To rent</option>
              <option value="SALE">To buy</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="pms-beds">Bedrooms</label>
            <select className={fieldClass} defaultValue={initial.form.bedroomsMin ?? ""} id="pms-beds" name="bedroomsMin">
              <option value="">Any</option>
              <option value="1">1+</option>
              <option value="2">2+</option>
              <option value="3">3+</option>
              <option value="4">4+</option>
              <option value="5">5+</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="pms-max">Max price</label>
            <input className={fieldClass} defaultValue={initial.form.maxPrice ?? ""} id="pms-max" inputMode="numeric" min="0" name="maxPrice" placeholder="Any" type="number" />
          </div>
          <button className={`${buttonClass("primary")} w-full self-end md:w-auto`} type="submit">Search</button>
        </div>

        <details className="group mt-4" open={initial.advanced || undefined}>
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-forest marker:hidden hover:text-emerald [&::-webkit-details-marker]:hidden">
            More filters
            <svg aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={labelClass} htmlFor="pms-category">Property type</label>
              <input className={fieldClass} defaultValue={initial.form.category ?? ""} id="pms-category" name="category" placeholder="e.g. Apartment, House, Land" />
            </div>
            <div>
              <label className={labelClass} htmlFor="pms-scope">Whole property or unit</label>
              <select className={fieldClass} defaultValue={initial.form.scope ?? ""} id="pms-scope" name="scope">
                <option value="">Either</option>
                <option value="PROPERTY">Whole property</option>
                <option value="UNIT">Unit in a building</option>
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="pms-baths">Bathrooms</label>
              <select className={fieldClass} defaultValue={initial.form.bathroomsMin ?? ""} id="pms-baths" name="bathroomsMin">
                <option value="">Any</option>
                <option value="1">1+</option>
                <option value="2">2+</option>
                <option value="3">3+</option>
                <option value="4">4+</option>
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="pms-min">Min price</label>
              <input className={fieldClass} defaultValue={initial.form.minPrice ?? ""} id="pms-min" inputMode="numeric" min="0" name="minPrice" placeholder="Any" type="number" />
            </div>
            <div>
              <label className={labelClass} htmlFor="pms-city">City</label>
              <input className={fieldClass} defaultValue={initial.form.city ?? ""} id="pms-city" name="city" placeholder="e.g. Accra" />
            </div>
            <div>
              <label className={labelClass} htmlFor="pms-district">District</label>
              <input className={fieldClass} defaultValue={initial.form.district ?? ""} id="pms-district" name="district" placeholder="e.g. Ayawaso West" />
            </div>
            <div>
              <label className={labelClass} htmlFor="pms-region">Region</label>
              <input className={fieldClass} defaultValue={initial.form.region ?? ""} id="pms-region" name="region" placeholder="e.g. Greater Accra" />
            </div>
            <div>
              <label className={labelClass} htmlFor="pms-country">Country</label>
              <select className={fieldClass} defaultValue={initial.form.country ?? ""} id="pms-country" name="country">
                <option value="">Any country</option>
                <option value="GH">Ghana</option>
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="pms-currency">Currency</label>
              <select className={fieldClass} defaultValue={initial.form.currencyCode ?? ""} id="pms-currency" name="currencyCode">
                <option value="">Any currency</option>
                <option value="GHS">Ghana cedi (GH₵)</option>
                <option value="USD">US dollar (US$)</option>
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="pms-available">Available from</label>
              <input className={fieldClass} defaultValue={initial.form.availableOn ?? ""} id="pms-available" name="availableOn" type="date" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="pms-amenities">Amenities</label>
              <input className={fieldClass} defaultValue={initial.form.amenities ?? ""} id="pms-amenities" name="amenities" placeholder="e.g. parking, internet, generator" />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className={buttonClass("primary", "sm")} type="submit">Apply filters</button>
            <button className={buttonClass("secondary", "sm")} type="reset">Clear all</button>
          </div>
        </details>
      </form>

      {error && <ErrorState message={error} onRetry={() => { setError(""); void search(query).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to search listings.")); }} title="Listings could not be loaded" />}

      {result ? (
        <>
          <p aria-live="polite" className="text-sm text-muted">
            <span className="font-semibold text-ink">{result.pagination.total.toLocaleString("en")}</span>{" "}
            {result.pagination.total === 1 ? "property" : "properties"}
            {filtered ? " match your search" : " available"}
          </p>
          {result.items.length ? (
            <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
              {result.items.map((listing) => <ListingCard listing={listing} key={listing.id} />)}
            </div>
          ) : filtered ? (
            <EmptyState
              action={<button className={buttonClass("secondary", "sm")} onClick={reset} type="button">Clear filters</button>}
              description="Try a wider area, a higher budget or fewer filters."
              title="No properties match this search"
            />
          ) : (
            <EmptyState
              action={<Link className={buttonClass("secondary", "sm")} href="/listings">List a property</Link>}
              description="New homes and property appear here as soon as their owner, manager or agent publishes them."
              title="No properties are listed right now"
            />
          )}
          {result.pagination.totalPages > 1 && (
            <nav aria-label="Listing results pages" className="flex flex-wrap justify-center gap-1.5">
              {Array.from({ length: result.pagination.totalPages }, (_, index) => index + 1).slice(0, 10).map((page) => (
                <button
                  aria-current={page === result.pagination.page ? "page" : undefined}
                  aria-label={`Page ${page}`}
                  className={`h-11 min-w-11 rounded-[var(--radius-control)] border px-3 text-sm tabular-nums transition ${page === result.pagination.page ? "border-forest bg-forest text-white" : "border-hairline bg-white text-ink hover:border-forest/40"}`}
                  key={page}
                  onClick={() => void search(`${query}${query ? "&" : ""}page=${page}`)}
                  type="button"
                >
                  {page}
                </button>
              ))}
            </nav>
          )}
        </>
      ) : !error ? (
        <div aria-busy="true" className="grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3" role="status">
          <span className="sr-only">Loading properties</span>
          {[0, 1, 2].map((index) => (
            <div className="grid gap-3" key={index}>
              <Skeleton className="aspect-[4/3] w-full" />
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ListingCard({ listing }: { listing: PublicListing }) {
  const photo = listing.media.find((media) => media.type === "PHOTO");
  const amount = listing.pricing.rentAmountMinor ?? listing.pricing.askingAmountMinor;
  const suffix = listing.listingType === "RENT" ? frequencySuffix(listing.pricing.frequency) : "";
  const specs = specLine(listing.attributes);
  const verified = listing.verification.status === "VERIFIED";
  const lister = listing.attribution.professional?.displayName ?? listing.attribution.listedBy;

  return (
    <Link
      className="group block rounded-[var(--radius-media)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-strong"
      href={`/marketplace/properties/${listing.id}`}
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-[var(--radius-media)] bg-cream">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- listing photos are served from the storage provider's public URL
          <img
            alt={photo.altText ?? listing.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
            decoding="async"
            loading="lazy"
            src={photo.url}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">Photos coming soon</div>
        )}
        <span className="absolute left-3 top-3 rounded-[var(--radius-media)] bg-white/95 px-2 py-1 text-xs font-semibold text-forest-deep">
          {listingTypeLabel(listing.listingType)}
        </span>
      </div>

      <div className="pt-4">
        <p className="text-xl font-semibold tracking-[-0.01em] text-forest-deep tabular-nums" data-money>
          {amount ? formatListingPrice(amount, listing.pricing.currencyCode) : "Price on request"}
          {amount && suffix && <span className="text-sm font-normal text-muted"> / {suffix}</span>}
        </p>
        <h2 className="mt-1 font-sans text-[15px] font-semibold leading-6 text-ink group-hover:text-forest">{listing.title}</h2>
        <p className="mt-0.5 text-sm text-muted">{listingLocation(listing.location)}</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline pt-3 text-[13px] text-slate-600">
          {specs.map((part) => <span key={part}>{part}</span>)}
          <span>{humanize(listing.category)}{listing.scope === "UNIT" ? ` · ${scopeLabel(listing.scope)}` : ""}</span>
        </div>

        <p className="mt-2 flex items-center gap-2 text-xs text-muted">
          {verified && (
            <span className="inline-flex items-center gap-1 font-semibold text-gold-ink">
              <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></svg>
              Verified
            </span>
          )}
          <span className="truncate">Listed by {lister}</span>
        </p>
      </div>
    </Link>
  );
}
