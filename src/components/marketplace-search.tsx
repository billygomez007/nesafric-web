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
    for (const key of ["category", "country", "region", "city", "district", "availability", "verification", "minimumRating"]) {
      const value = String(data.get(key) ?? "").trim();
      if (value) params.set(key, value);
    }
    setQuery(params.toString());
    void search(params.toString()).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to search providers."));
  }
  if (error && !result) return <p className="rounded-xl bg-red-50 p-6 text-red-800">{error}</p>;
  return <div className="grid gap-6"><form className="grid gap-3 rounded-2xl border bg-white p-5 shadow-sm md:grid-cols-4" onSubmit={submit}><select className="rounded-lg border p-3 text-sm" name="category"><option value="">All service categories</option>{categories.map((category) => <option key={category.id} value={category.key}>{category.name}</option>)}</select><input className="rounded-lg border p-3 text-sm" maxLength={2} name="country" placeholder="Country code (e.g. GH)" /><input className="rounded-lg border p-3 text-sm" name="region" placeholder="Region / state" /><input className="rounded-lg border p-3 text-sm" name="city" placeholder="City" /><input className="rounded-lg border p-3 text-sm" name="district" placeholder="District" /><select className="rounded-lg border p-3 text-sm" name="availability"><option value="">Any availability</option><option value="AVAILABLE">Available</option><option value="LIMITED">Limited</option><option value="UNAVAILABLE">Unavailable</option></select><select className="rounded-lg border p-3 text-sm" name="verification"><option value="">Any verification</option><option value="VERIFIED">Verified</option><option value="PENDING">Pending</option><option value="UNVERIFIED">Unverified</option></select><div className="flex gap-2"><select className="min-w-0 flex-1 rounded-lg border p-3 text-sm" name="minimumRating"><option value="">Any rating</option>{[4,3,2,1].map((rating) => <option key={rating} value={rating}>{rating}+ stars</option>)}</select><button className="rounded-lg bg-slate-950 px-5 text-sm font-semibold text-white">Search</button></div></form>{error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}{result ? <><div className="flex items-center justify-between text-sm text-slate-600"><p>{result.pagination.total} listed providers</p><p>Explainable ranking · no private signals</p></div>{result.items.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{result.items.map((provider) => <ProviderCard provider={provider} key={provider.id} />)}</div> : <p className="rounded-2xl border border-dashed bg-white p-12 text-center text-slate-500">No providers match these filters.</p>}{result.pagination.totalPages > 1 && <div className="flex justify-center gap-2">{Array.from({ length: result.pagination.totalPages }, (_, index) => index + 1).slice(0, 10).map((page) => <button className={`rounded-lg border px-3 py-2 text-sm ${page === result.pagination.page ? "bg-slate-950 text-white" : "bg-white"}`} key={page} onClick={() => void search(`${query}${query ? "&" : ""}page=${page}`)}>{page}</button>)}</div>}</> : <p className="rounded-xl border bg-white p-6 text-slate-500">Loading marketplace providers...</p>}</div>;
}

function ProviderCard({ provider }: { provider: PublicProvider }) {
  const location = provider.serviceAreas[0];
  return <Link className="rounded-2xl border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand" href={provider.slug ? `/marketplace/services/${provider.slug}` : `/marketplace/${provider.id}`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-navy">{provider.type}</p><h2 className="mt-1 text-xl font-semibold">{provider.displayName}</h2></div><span className={`rounded-full px-2 py-1 text-xs font-semibold ${provider.verification === "VERIFIED" ? "bg-premium/15 text-navy" : "bg-slate-100 text-slate-700"}`}>{provider.verification}</span></div><p className="mt-3 line-clamp-3 text-sm text-slate-600">{provider.description || "Service provider profile"}</p><div className="mt-4 flex flex-wrap gap-1">{provider.categories.slice(0, 4).map((category) => <span className="rounded-full bg-slate-100 px-2 py-1 text-xs" key={category.id}>{category.name}</span>)}</div><dl className="mt-5 grid grid-cols-2 gap-3 border-t pt-4 text-sm"><div><dt className="text-slate-500">Location</dt><dd className="font-medium">{location ? [location.district, location.city, location.region, location.countryCode].filter(Boolean).join(", ") : "Flexible"}</dd></div><div><dt className="text-slate-500">Rating</dt><dd className="font-medium">{provider.aggregateRating ? `${provider.aggregateRating.toFixed(1)} (${provider.ratingCount})` : "New"}</dd></div><div><dt className="text-slate-500">Availability</dt><dd className="font-medium">{provider.availability}</dd></div><div><dt className="text-slate-500">Completed jobs</dt><dd className="font-medium">{provider.completedJobs}</dd></div></dl></Link>;
}
