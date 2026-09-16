"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type Category = { id: string; key: string; name: string };
export type PublicProvider = { id: string; slug: string | null; displayName: string; type: string; description: string | null; availability: string; verification: string; acceptingWork: boolean; categories: Category[]; serviceAreas: { countryCode: string; region: string | null; city: string | null; district: string | null; label: string | null }[]; contact: { email: string | null; phone: string | null }; pricing: { startingRateMinor: string | null; currencyCode: string | null }; responseTimeHours: number | null; aggregateRating: number | null; ratingCount: number; completedJobs: number; ranking: { score: number; signals: Record<string, number> } };
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
  useEffect(() => {
    Promise.all([fetch("/api/public/marketplace/categories"), fetch("/api/public/marketplace/providers")]).then(async ([categoryResponse, providerResponse]) => {
      if (categoryResponse.ok) setCategories(await categoryResponse.json());
      if (!providerResponse.ok) throw new Error("Unable to load the marketplace.");
      setResult(await providerResponse.json());
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load the marketplace."));
  }, []);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const key of ["category", "providerType", "country", "region", "city", "district", "availability", "verification", "minimumRating"]) {
      const value = String(data.get(key) ?? "").trim();
      if (value) params.set(key, value);
    }
    setQuery(params.toString());
    void search(params.toString()).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to search providers."));
  }
  if (error && !result) return <p className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</p>;
  return (
    <div className="grid gap-6">
      <form className="grid gap-3 rounded-3xl border border-hairline bg-white p-5 shadow-sm md:grid-cols-4" onSubmit={submit}>
        <select className="rounded-xl border border-hairline bg-warm-white p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal focus:border-teal focus:ring-2 focus:ring-teal/20" name="category"><option value="">All service categories</option>{categories.map((category) => <option key={category.id} value={category.key}>{category.name}</option>)}</select>
        <select className="rounded-xl border border-hairline bg-warm-white p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal focus:border-teal focus:ring-2 focus:ring-teal/20" name="providerType"><option value="">Individual + company</option><option value="INDIVIDUAL">Individual</option><option value="COMPANY">Company</option></select>
        <input className="rounded-xl border border-hairline bg-warm-white p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal focus:border-teal focus:ring-2 focus:ring-teal/20" maxLength={2} name="country" placeholder="Country code (e.g. GH)" />
        <input className="rounded-xl border border-hairline bg-warm-white p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal focus:border-teal focus:ring-2 focus:ring-teal/20" name="region" placeholder="Region / state" />
        <input className="rounded-xl border border-hairline bg-warm-white p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal focus:border-teal focus:ring-2 focus:ring-teal/20" name="city" placeholder="City" />
        <input className="rounded-xl border border-hairline bg-warm-white p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal focus:border-teal focus:ring-2 focus:ring-teal/20" name="district" placeholder="District" />
        <select className="rounded-xl border border-hairline bg-warm-white p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal focus:border-teal focus:ring-2 focus:ring-teal/20" name="availability"><option value="">Any availability</option><option value="AVAILABLE">Available</option><option value="LIMITED">Limited</option><option value="UNAVAILABLE">Unavailable</option></select>
        <select className="rounded-xl border border-hairline bg-warm-white p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal focus:border-teal focus:ring-2 focus:ring-teal/20" name="verification"><option value="">Any verification</option><option value="VERIFIED">Verified</option><option value="PENDING">Pending</option><option value="UNVERIFIED">Unverified</option></select>
        <div className="flex gap-2 md:col-span-4"><select className="min-w-0 flex-1 rounded-xl border border-hairline bg-warm-white p-3 text-sm" name="minimumRating"><option value="">Any rating</option>{[4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating}+ stars</option>)}</select><button className="rounded-xl bg-forest px-5 text-sm font-semibold text-white transition hover:bg-emerald" type="submit">Search providers</button></div>
      </form>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {result ? <>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted"><p>{result.pagination.total} listed providers</p><p>Explainable ranking · no private signals</p></div>
        {result.items.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{result.items.map((provider) => <ProviderCard provider={provider} key={provider.id} />)}</div> : <p className="rounded-3xl border border-dashed border-hairline bg-white p-12 text-center text-muted">No providers match these filters.</p>}
        {result.pagination.totalPages > 1 && <div className="flex justify-center gap-2">{Array.from({ length: result.pagination.totalPages }, (_, index) => index + 1).slice(0, 10).map((page) => <button className={`rounded-xl border border-hairline px-3 py-2 text-sm ${page === result.pagination.page ? "bg-forest text-white" : "bg-white text-forest"}`} key={page} onClick={() => void search(`${query}${query ? "&" : ""}page=${page}`)} type="button">{page}</button>)}</div>}
      </> : <p className="rounded-2xl border border-hairline bg-white p-6 text-muted">Loading marketplace providers...</p>}
    </div>
  );
}

function ProviderCard({ provider }: { provider: PublicProvider }) {
  const location = provider.serviceAreas[0];
  return <Link className="group rounded-3xl border border-hairline bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-teal hover:shadow-md" href={provider.slug ? `/marketplace/services/${provider.slug}` : `/marketplace/${provider.id}`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-teal">{provider.type}</p><h2 className="mt-1 text-xl font-semibold text-forest group-hover:text-teal">{provider.displayName}</h2></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${provider.verification === "VERIFIED" ? "bg-gold/10 text-forest" : "bg-surface text-muted"}`}>{provider.verification}</span></div><p className="mt-3 line-clamp-3 text-sm leading-6 text-muted">{provider.description || "Service provider profile"}</p><div className="mt-4 flex flex-wrap gap-1.5">{provider.categories.slice(0, 4).map((category) => <span className="rounded-full bg-surface px-2 py-1 text-xs text-muted" key={category.id}>{category.name}</span>)}</div><dl className="mt-5 grid grid-cols-2 gap-3 border-t border-hairline pt-4 text-sm"><div><dt className="text-muted">Location</dt><dd className="font-medium text-forest">{location ? [location.district, location.city, location.region, location.countryCode].filter(Boolean).join(", ") : "Flexible"}</dd></div><div><dt className="text-muted">Rating</dt><dd className="font-medium text-forest">{provider.aggregateRating ? `${provider.aggregateRating.toFixed(1)} (${provider.ratingCount})` : "New"}</dd></div><div><dt className="text-muted">Availability</dt><dd className="font-medium text-forest">{provider.availability}</dd></div><div><dt className="text-muted">Completed jobs</dt><dd className="font-medium text-forest">{provider.completedJobs}</dd></div></dl></Link>;
}
