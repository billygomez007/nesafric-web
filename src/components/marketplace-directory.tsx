"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MarketplaceBanner } from "@/components/marketplace-banner";
import { BrandLogo } from "@/components/brand-logo";

type DirectoryItem = {
  slug: string;
  displayName: string;
  type: string;
  logoUrl: string | null;
  description: string | null;
  verificationStatus: string;
  countryCode: string;
  serviceAreas: string[];
  specialities: string[];
  _count: { listings: number; developments: number };
};

export const TYPE_LABELS: Record<string, string> = {
  INDIVIDUAL_AGENT: "Individual Agent",
  BROKER: "Broker",
  BROKERAGE: "Brokerage",
  REAL_ESTATE_COMPANY: "Real Estate Company",
  DEVELOPER: "Developer",
  PROPERTY_MARKETING_COMPANY: "Property Marketing Company",
  OTHER: "Real Estate Professional",
};

/** Public professional directory (item 8) — no auth required, deliberately not weighted toward
 * individual agents: developers and brokerages surface with the same prominence. */
export function MarketplaceDirectory() {
  const [items, setItems] = useState<DirectoryItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [type, setType] = useState("");
  const [query, setQuery] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const pageSize = 20;

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (type) params.set("type", type);
    if (query.trim()) params.set("query", query.trim());
    if (verifiedOnly) params.set("verifiedOnly", "true");
    const controller = new AbortController();
    fetch(`/api/public/marketplace-directory?${params}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json();
      setItems(body.items); setTotal(body.total);
    }).catch(() => {});
    return () => controller.abort();
  }, [page, type, query, verifiedOnly]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="min-h-screen bg-warm-white text-ink">
      <header className="border-b border-white/10 bg-forest-deep px-4 py-10 text-white sm:px-6 sm:py-14">
        <div className="mx-auto max-w-6xl">
          <nav className="flex items-center justify-between text-sm text-white/70"><Link href="/"><BrandLogo height={22} /></Link><Link className="transition hover:text-white" href="/marketplace/properties">Browse properties</Link></nav>
          <p className="mt-12 text-xs font-semibold uppercase tracking-[0.22em] text-gold-soft">TRUSTED REAL ESTATE NETWORK</p>
          <h1 className="mt-3 text-4xl font-semibold sm:text-5xl">Meet the professionals behind the opportunity.</h1>
          <p className="mt-4 max-w-2xl text-white/70">Agents, brokerages, real estate companies, and developers verified and active on NesAfric.</p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="mb-6"><MarketplaceBanner placement="PROFESSIONAL_FEATURED" /></div>
        <div className="grid gap-3 rounded-3xl border border-hairline bg-white p-4 shadow-sm sm:grid-cols-[2fr_1fr_auto] sm:items-center">
          <input
            className="rounded-xl border border-hairline bg-warm-white px-3 py-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal transition focus:border-teal focus:ring-2 focus:ring-teal/20"
            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
            placeholder="Search by name…"
            value={query}
          />
          <select className="rounded-xl border border-hairline bg-warm-white px-3 py-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal transition focus:border-teal focus:ring-2 focus:ring-teal/20" onChange={(event) => { setType(event.target.value); setPage(1); }} value={type}>
            <option value="">All professional types</option>
            {Object.entries(TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm font-medium text-forest">
            <input checked={verifiedOnly} onChange={(event) => { setVerifiedOnly(event.target.checked); setPage(1); }} type="checkbox" />
            Verified only
          </label>
        </div>

        {!items ? (
          <p className="mt-8 text-sm text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <div className="mt-8 rounded-3xl border border-dashed border-hairline bg-white p-10 text-center shadow-sm">
            <p className="font-medium text-forest">No professionals match those filters</p>
            <p className="mt-1 text-sm text-muted">Try clearing the search or type filter.</p>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <Link className="group grid gap-3 rounded-3xl border border-hairline bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-teal hover:shadow-md" href={`/marketplace/professionals/${item.slug}`} key={item.slug}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cream text-base font-semibold text-forest">
                    {item.displayName.slice(0, 1)}
                  </div>
                  {item.verificationStatus === "VERIFIED" && <span className="rounded-full bg-gold/10 px-2.5 py-0.5 text-xs font-semibold text-forest">Verified</span>}
                </div>
                <div>
                  <p className="font-semibold text-forest group-hover:text-teal">{item.displayName}</p>
                  <p className="mt-0.5 text-sm text-muted">{TYPE_LABELS[item.type] ?? item.type} · {item.countryCode}</p>
                </div>
                {item.description && <p className="line-clamp-2 text-sm text-muted">{item.description}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {item.serviceAreas.slice(0, 3).map((area) => <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted" key={area}>{area}</span>)}
                </div>
                <p className="text-xs text-muted">{item._count.listings} active listing{item._count.listings === 1 ? "" : "s"}{item._count.developments > 0 ? ` · ${item._count.developments} development${item._count.developments === 1 ? "" : "s"}` : ""}</p>
              </Link>
            ))}
          </div>
        )}

        {total > pageSize && (
          <div className="mt-8 flex items-center justify-between text-sm">
            <button className="font-medium text-slate-600 disabled:cursor-not-allowed disabled:text-slate-500" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} type="button">← Previous</button>
            <span className="text-slate-500">Page {page} of {totalPages}</span>
            <button className="font-medium text-slate-600 disabled:cursor-not-allowed disabled:text-slate-500" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} type="button">Next →</button>
          </div>
        )}
      </div>
    </main>
  );
}
