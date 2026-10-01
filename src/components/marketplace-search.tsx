"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { buttonClass } from "@/components/ui/button-styles";
import { controlClass, fieldLabelClass } from "@/components/ui/field-styles";
import {
  AvailabilityBadge,
  completedJobsLabel,
  completionRatePercent,
  primaryServiceArea,
  ProviderLogo,
  providerTypeLabel,
  RatingLine,
  startingRateLabel,
  VerificationBadges,
} from "@/components/marketplace-provider-trust";
import { SaveProviderButton, SavedProvidersProvider } from "@/components/saved-providers";

type Category = {
  id: string;
  key: string;
  name: string;
  parentId?: string | null;
  parent?: { id: string; key: string; name: string; sortOrder: number } | null;
};
/** Public provider payload (`publicProfile()` in `src/modules/marketplace/service.ts`). Rating,
 * rating count, completed jobs, completion rate and verification badges are server-derived. */
export type PublicProvider = {
  id: string; slug: string | null; displayName: string; type: string; description: string | null; availability: string; verification: string; acceptingWork: boolean;
  verificationBadges?: { identity: boolean; business: boolean; skill: boolean };
  logo?: { url: string } | null;
  categories: Category[]; serviceAreas: { countryCode: string; region: string | null; city: string | null; district: string | null; label: string | null }[];
  contact: { email: string | null; phone: string | null }; pricing: { startingRateMinor: string | null; currencyCode: string | null }; responseTimeHours: number | null;
  aggregateRating: number | null; ratingCount: number; completedJobs: number;
  /** Server-derived (0–1) or null below the minimum history; never computed here. */
  completionRate?: number | null; completionRateBasis?: number;
  ranking: { score: number; signals: Record<string, number> };
};
type Result = { items: PublicProvider[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; meta: { ranking: { strategy: string; privateSignalsUsed: boolean } } };

export function MarketplaceSearch() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  async function search(search = "") {
    const response = await fetch(`/api/public/marketplace/providers${search ? `?${search}` : ""}`);
    if (!response.ok) throw new Error((await response.json()).error?.message ?? "Unable to search providers.");
    setResult(await response.json());
  }
  const searchParams = useSearchParams();
  // Deep links such as /marketplace/services?category=plumbing open pre-filtered by service.
  const initialCategory = searchParams?.get("category")?.trim() ?? "";
  const initialQ = searchParams?.get("q")?.trim() ?? "";
  useEffect(() => {
    const initialParams = new URLSearchParams();
    if (initialQ) initialParams.set("q", initialQ);
    if (initialCategory) initialParams.set("category", initialCategory);
    const initialQuery = initialParams.size ? `?${initialParams.toString()}` : "";
    if (initialQuery) setQuery(initialQuery.slice(1));
    Promise.all([fetch("/api/public/marketplace/categories"), fetch(`/api/public/marketplace/providers${initialQuery}`)]).then(async ([categoryResponse, providerResponse]) => {
      if (categoryResponse.ok) setCategories(await categoryResponse.json());
      if (!providerResponse.ok) throw new Error("Unable to load the marketplace.");
      setResult(await providerResponse.json());
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load the marketplace."));
  }, [initialCategory, initialQ]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const key of ["q", "category", "providerType", "country", "region", "city", "district", "availability", "minimumRating"]) {
      const value = String(data.get(key) ?? "").trim();
      if (value) params.set(key, value);
    }
    setQuery(params.toString());
    void search(params.toString()).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to search providers."));
  }
  if (error && !result) return <p className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</p>;
  return (
    <SavedProvidersProvider>
    <div className="grid gap-6">
      <form aria-label="Search service providers" className="grid gap-3 border-y border-hairline py-5 sm:grid-cols-2 lg:grid-cols-4" onSubmit={submit}>
        {/* Searched on the server (names, descriptions, services, areas); the list is never filtered here. */}
        <div className="sm:col-span-2 lg:col-span-4"><label className={fieldLabelClass} htmlFor="msp-q">Search</label><input className={controlClass} defaultValue={initialQ} id="msp-q" maxLength={200} name="q" placeholder="Plumber, electrician, Kwame Plumbing, Accra…" type="search" /></div>
        <div><label className={fieldLabelClass} htmlFor="msp-category">Service</label><select className={controlClass} defaultValue={initialCategory} id="msp-category" key={`${initialCategory}-${categories.length}`} name="category"><option value="">All services</option>{categories.filter((category) => category.parentId !== null).map((category) => <option key={category.id} value={category.key}>{category.name}</option>)}</select></div>
        <div><label className={fieldLabelClass} htmlFor="msp-type">Provider type</label><select className={controlClass} id="msp-type" name="providerType"><option value="">Individuals and companies</option><option value="INDIVIDUAL">Individual</option><option value="COMPANY">Company</option></select></div>
        <div><label className={fieldLabelClass} htmlFor="msp-city">City</label><input className={controlClass} id="msp-city" name="city" placeholder="e.g. Accra" /></div>
        <div><label className={fieldLabelClass} htmlFor="msp-district">District</label><input className={controlClass} id="msp-district" name="district" placeholder="e.g. Ayawaso West" /></div>
        <div><label className={fieldLabelClass} htmlFor="msp-region">Region</label><input className={controlClass} id="msp-region" name="region" placeholder="e.g. Greater Accra" /></div>
        <div><label className={fieldLabelClass} htmlFor="msp-country">Country</label><select className={controlClass} id="msp-country" name="country"><option value="">Any country</option><option value="GH">Ghana</option></select></div>
        <div><label className={fieldLabelClass} htmlFor="msp-availability">Availability</label><select className={controlClass} id="msp-availability" name="availability"><option value="">Any availability</option><option value="AVAILABLE">Available</option><option value="LIMITED">Limited</option><option value="UNAVAILABLE">Unavailable</option></select></div>
        <div><label className={fieldLabelClass} htmlFor="msp-rating">Minimum rating</label><select className={controlClass} id="msp-rating" name="minimumRating"><option value="">Any rating</option>{[4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating}+ stars</option>)}</select></div>
        <div className="flex items-end sm:col-span-2 lg:col-span-3 lg:justify-end"><button className={`${buttonClass("primary")} w-full sm:w-auto`} type="submit">Search providers</button></div>
      </form>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {result ? <>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted"><p>{result.pagination.total} listed providers</p><p>Explainable ranking · no private signals</p></div>
        {result.items.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{result.items.map((provider) => <ProviderCard provider={provider} key={provider.id} />)}</div> : <p className="rounded-3xl border border-dashed border-hairline bg-white p-12 text-center text-muted">No providers match this search.</p>}
        {result.pagination.totalPages > 1 && <div className="flex justify-center gap-2">{Array.from({ length: result.pagination.totalPages }, (_, index) => index + 1).slice(0, 10).map((page) => <button className={`h-11 min-w-11 rounded-control border border-hairline px-3 text-sm tabular-nums ${page === result.pagination.page ? "bg-forest text-white" : "bg-white text-forest"}`} key={page} onClick={() => void search(`${query}${query ? "&" : ""}page=${page}`)} type="button">{page}</button>)}</div>}
      </> : <p className="rounded-2xl border border-hairline bg-white p-6 text-muted">Loading marketplace providers...</p>}
    </div>
    </SavedProvidersProvider>
  );
}

export function providerProfileHref(provider: Pick<PublicProvider, "id" | "slug">) {
  return provider.slug ? `/marketplace/services/${provider.slug}` : `/marketplace/${provider.id}`;
}

/**
 * Public provider card: identity, what NesAfric has verified, its NesAfric record (all
 * server-derived), then what the provider states about itself. Same information as the app's card.
 */
export function ProviderCard({ provider }: { provider: PublicProvider }) {
  const href = providerProfileHref(provider);
  const type = providerTypeLabel(provider.type);
  const area = primaryServiceArea(provider);
  const completion = completionRatePercent(provider);
  const rate = startingRateLabel(provider);
  const mainCategory = provider.categories[0]?.name;
  return (
    <article aria-labelledby={`provider-${provider.id}-name`} className="flex min-w-0 flex-col gap-4 rounded-3xl border border-hairline bg-white p-5 shadow-sm" data-testid={`provider-card-${provider.id}`}>
      <div className="flex items-start gap-3">
        <ProviderLogo name={provider.displayName} url={provider.logo?.url} />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-snug text-forest-deep" id={`provider-${provider.id}-name`}>
            <Link className="break-words rounded-sm hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest" href={href}>{provider.displayName}</Link>
          </h2>
          <p className="mt-0.5 truncate text-sm text-muted">{[mainCategory, type].filter(Boolean).join(" · ")}</p>
          {area ? <p className="truncate text-sm text-muted" title={area}>{area}</p> : null}
        </div>
        <SaveProviderButton name={provider.displayName} providerId={provider.id} />
      </div>
      <VerificationBadges provider={provider} />

      {provider.ranking?.score !== undefined && (
        <div className="inline-flex w-fit rounded-full bg-teal/10 px-3 py-1 text-xs font-semibold text-forest">
          NesAfric quality score {Math.round(provider.ranking.score)}
        </div>
      )}

      <dl aria-label="NesAfric record" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <div><dt className="sr-only">Rating</dt><dd><RatingLine provider={provider} /></dd></div>
        <div><dt className="sr-only">Completed jobs</dt><dd className="font-semibold text-ink">{provider.completedJobs > 0 ? completedJobsLabel(provider.completedJobs) : "New on NesAfric"}</dd></div>
        {completion !== null ? <div><dt className="sr-only">Completion rate</dt><dd className="font-semibold text-ink">{completion}% completion rate</dd></div> : null}
      </dl>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-4">
        <AvailabilityBadge provider={provider} />
        {rate ? <p className="text-right text-sm font-semibold text-forest-deep">{rate}<span className="block text-xs font-normal text-muted">Provider’s starting rate</span></p> : <p className="text-sm font-semibold text-forest-deep">Request a quote</p>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Link className={buttonClass("secondary")} href={href}>View profile</Link>
        <Link className={buttonClass("primary")} href={`${href}#request-service`}>Request service</Link>
      </div>
    </article>
  );
}
