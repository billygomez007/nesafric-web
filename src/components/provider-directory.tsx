"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Directory = { id: string; status: string; internalNotes: string | null; provider: { id: string; displayName: string; type: string; verificationStatus: string; availabilityStatus: string; acceptingWork: boolean; contactEmail: string | null; contactPhone: string | null; categories: { category: { id: string; name: string } }[]; serviceAreas: { id: string; areaType: string; name: string }[]; _count: { assignments: number; ratings: number } } };

export function ProviderDirectory() {
  const [entries, setEntries] = useState<Directory[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) {
      const timer = setTimeout(() => setError("Choose an organisation to view service providers."), 0);
      return () => clearTimeout(timer);
    }
    fetch("/api/providers", { headers: { "x-organisation-id": organisationId } }).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error?.message ?? "Unable to load providers.");
      setEntries(await response.json());
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load providers."));
  }, []);
  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</p>;
  if (!entries) return <p className="rounded-xl border bg-white p-6 text-slate-600">Loading provider directory...</p>;
  return <section className="rounded-2xl border bg-white p-6 shadow-sm"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-xl font-semibold">Internal provider directory</h2><p className="mt-1 text-sm text-slate-500">{entries.length} provider relationships</p></div><Link className="self-start rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white" href="/providers/new">Register provider</Link></div>{entries.length ? <div className="mt-5 grid gap-3">{entries.map(({ provider, status }) => <Link className="grid gap-3 rounded-xl border p-4 transition hover:border-emerald-500 md:grid-cols-[1fr_auto]" href={`/providers/${provider.id}`} key={provider.id}><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{provider.displayName}</p><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{provider.type}</span><span className={`rounded-full px-2 py-1 text-xs font-semibold ${provider.verificationStatus === "VERIFIED" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{provider.verificationStatus}</span></div><p className="mt-1 text-sm text-slate-600">{provider.categories.map(({ category }) => category.name).join(", ") || "No categories"} · {provider.serviceAreas.map((area) => area.name).join(", ") || "No service areas"}</p><p className="mt-2 text-xs text-slate-500">{provider._count.assignments} jobs · {provider._count.ratings} ratings · directory {status.toLowerCase()}</p></div><div className="text-sm md:text-right"><p className="font-medium">{provider.availabilityStatus}</p><p className="text-slate-500">{provider.acceptingWork ? "Accepting work" : "Not accepting work"}</p></div></Link>)}</div> : <p className="mt-5 rounded-xl border border-dashed p-8 text-center text-slate-500">No providers have been added to this organisation’s directory.</p>}</section>;
}
