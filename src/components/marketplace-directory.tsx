"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MarketplaceBanner } from "@/components/marketplace-banner";
import { controlClass, fieldLabelClass } from "@/components/ui/field-styles";

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

/**
 * Public professional directory (item 8) — no auth required, deliberately not weighted toward
 * individual agents. Always verified-only: the public directory lists professionals whose
 * verification has been approved, never unverified profiles simply because they exist (same rule
 * as the homepage carousel and counts). Direct profile URLs are unaffected.
 */
export function MarketplaceDirectory() {
  const [items, setItems] = useState<DirectoryItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const searchParams = useSearchParams();
  // Deep links such as /marketplace/professionals?type=DEVELOPER open pre-filtered.
  const [type, setType] = useState(() => {
    const requested = searchParams?.get("type") ?? "";
    return requested in TYPE_LABELS ? requested : "";
  });
  const [query, setQuery] = useState("");
  const pageSize = 20;
  const filtered = Boolean(type || query.trim());

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), verifiedOnly: "true" });
    if (type) params.set("type", type);
    if (query.trim()) params.set("query", query.trim());
    const controller = new AbortController();
    fetch(`/api/public/marketplace-directory?${params}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json();
      setItems(body.items); setTotal(body.total);
    }).catch(() => {});
    return () => controller.abort();
  }, [page, type, query]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="min-h-screen bg-warm-white text-ink">
      <div className="mx-auto max-w-[1400px] px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
        <header className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-[-0.02em] text-forest-deep sm:text-[40px] sm:leading-[1.1]">Agents, brokerages and developers</h1>
          <p className="mt-3 text-base leading-7 text-muted">
            Real estate professionals who are verified and active on NesAfric. Every profile listed here has passed NesAfric&apos;s professional verification.
          </p>
        </header>

        <div className="mt-6"><MarketplaceBanner placement="PROFESSIONAL_FEATURED" /></div>

        <div className="mt-6 grid gap-3 border-y border-hairline py-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:items-end">
          <div>
            <label className={fieldLabelClass} htmlFor="directory-query">Name</label>
            <input
              className={controlClass}
              id="directory-query"
              onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              placeholder="Search by name"
              type="search"
              value={query}
            />
          </div>
          <div>
            <label className={fieldLabelClass} htmlFor="directory-type">Professional type</label>
            <select className={controlClass} id="directory-type" onChange={(event) => { setType(event.target.value); setPage(1); }} value={type}>
              <option value="">All types</option>
              {Object.entries(TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
        </div>

        {!items ? (
          <p className="mt-8 text-sm text-muted" role="status">Loading professionals…</p>
        ) : items.length === 0 ? (
          <div className="mt-8 border-b border-hairline pb-10">
            {filtered ? (
              <>
                <p className="font-display text-lg font-semibold text-forest-deep">No verified professionals match this search</p>
                <p className="mt-1 text-sm text-muted">Try another name or professional type.</p>
                <button className="mt-4 text-sm font-semibold text-forest underline-offset-4 hover:underline" onClick={() => { setQuery(""); setType(""); setPage(1); }} type="button">Clear search</button>
              </>
            ) : (
              <>
                <p className="font-display text-lg font-semibold text-forest-deep">Verified professionals will appear here</p>
                <p className="mt-1 max-w-xl text-sm leading-6 text-muted">
                  The directory lists agents, brokerages and developers once their verification is approved.
                </p>
                <Link className="mt-4 inline-flex text-sm font-semibold text-forest underline-offset-4 hover:underline" href="/for-professionals">
                  Are you a real estate professional? Join and get verified <span aria-hidden="true" className="ml-1">→</span>
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            <p aria-live="polite" className="mt-6 text-sm text-muted"><span className="font-semibold text-ink">{total}</span> verified {total === 1 ? "professional" : "professionals"}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <Link className="group grid content-start gap-3 rounded-[var(--radius-panel)] border border-hairline bg-white p-5 transition hover:border-forest/40" href={`/marketplace/professionals/${item.slug}`} key={item.slug}>
                  <div className="flex items-start justify-between gap-3">
                    {item.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- professional logos are served from the storage provider's public URL
                      <img alt="" className="h-11 w-11 shrink-0 rounded-[var(--radius-media)] object-contain" src={item.logoUrl} />
                    ) : (
                      <div aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-media)] bg-cream font-display text-base font-semibold text-forest-deep">
                        {item.displayName.slice(0, 1)}
                      </div>
                    )}
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-gold-ink">
                      <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></svg>
                      Verified
                    </span>
                  </div>
                  <div>
                    <p className="font-display text-[17px] font-semibold text-forest-deep group-hover:underline">{item.displayName}</p>
                    <p className="mt-0.5 text-sm text-muted">{TYPE_LABELS[item.type] ?? item.type}{item.countryCode === "GH" ? " · Ghana" : ` · ${item.countryCode}`}</p>
                  </div>
                  {item.description && <p className="line-clamp-2 text-sm leading-6 text-muted">{item.description}</p>}
                  {item.serviceAreas.length > 0 && (
                    <p className="text-xs text-muted">Covers {item.serviceAreas.slice(0, 3).join(", ")}{item.serviceAreas.length > 3 ? " and more" : ""}</p>
                  )}
                  <p className="border-t border-hairline pt-3 text-xs text-muted">
                    {item._count.listings} active listing{item._count.listings === 1 ? "" : "s"}{item._count.developments > 0 ? ` · ${item._count.developments} development${item._count.developments === 1 ? "" : "s"}` : ""}
                  </p>
                </Link>
              ))}
            </div>
          </>
        )}

        {total > pageSize && (
          <nav aria-label="Directory pages" className="mt-8 flex items-center justify-between text-sm">
            <button className="min-h-11 font-semibold text-forest disabled:cursor-not-allowed disabled:text-slate-500" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} type="button">← Previous</button>
            <span className="text-muted">Page {page} of {totalPages}</span>
            <button className="min-h-11 font-semibold text-forest disabled:cursor-not-allowed disabled:text-slate-500" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} type="button">Next →</button>
          </nav>
        )}
      </div>
    </main>
  );
}
