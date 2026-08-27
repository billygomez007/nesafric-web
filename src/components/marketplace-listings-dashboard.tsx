"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Listing = {
  id: string; title: string; status: string; verificationStatus: string; listingType: string;
  city: string | null; marketplaceAssetId: string | null; listingRepresentativeUserId: string | null;
  listingAuthority: string | null;
};
type Page = { items: Listing[]; total: number; page: number; pageSize: number };

const STATUS_STYLES: Record<string, string> = {
  PUBLISHED: "bg-emerald-50 text-emerald-800",
  DRAFT: "bg-slate-100 text-slate-600",
  PENDING_REVIEW: "bg-amber-50 text-amber-800",
  PAUSED: "bg-slate-100 text-slate-600",
  ARCHIVED: "bg-slate-100 text-slate-500",
  REJECTED: "bg-red-50 text-red-800",
};

export function MarketplaceListingsDashboard({ professionalId }: { professionalId: string }) {
  const [data, setData] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const query = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (statusFilter) query.set("status", statusFilter);
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/listings?${query.toString()}`);
    const body = await response.json();
    if (response.ok) setData(body); else setError(body.error?.message ?? "Unable to load listings.");
  };

  useEffect(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (statusFilter) query.set("status", statusFilter);
    fetch(`/api/marketplace-professionals/${professionalId}/listings?${query.toString()}`).then(async (response) => {
      const body = await response.json();
      if (response.ok) setData(body); else setError(body.error?.message ?? "Unable to load listings.");
    });
  }, [professionalId, page, statusFilter]);

  async function transition(listingId: string, status: string) {
    setError("");
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/listings/${listingId}/transition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    const body = await response.json();
    if (!response.ok) setError(body.error?.message ?? "Unable to update listing."); else await load();
  }
  async function submitVerification(listingId: string) {
    const privateReference = window.prompt("Private authority evidence reference");
    if (!privateReference) return;
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/listings/${listingId}/verification`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "PENDING", evidence: [{ type: "listing_authority", privateReference }] }) });
    const body = await response.json();
    if (!response.ok) setError(body.error?.message ?? "Unable to submit verification."); else await load();
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Listings</h1>
          <p className="mt-1 text-sm text-slate-600">Standalone and development inventory marketed through this professional profile.</p>
        </div>
        <Link className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white" href={`/pro/${professionalId}/listings/new`}>
          New standalone listing
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {["", "DRAFT", "PENDING_REVIEW", "PUBLISHED", "PAUSED", "ARCHIVED"].map((status) => (
          <button
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${statusFilter === status ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
            key={status || "all"}
            onClick={() => { setStatusFilter(status); setPage(1); }}
            type="button"
          >
            {status ? status.replaceAll("_", " ") : "All"}
          </button>
        ))}
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
      {!data ? <p className="text-slate-600">Loading…</p> : data.items.length === 0 ? (
        <p className="rounded-xl border border-dashed p-10 text-center text-slate-600">No marketplace listings match this filter.</p>
      ) : (
        <div className="grid gap-3">
          {data.items.map((item) => (
            <article className="rounded-xl border bg-white p-5 shadow-sm" key={item.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-950">{item.title}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {item.listingType} · {item.city ?? "Location not set"} · {item.marketplaceAssetId ? "Marketplace native" : "UmoAfric backed"} · verification {item.verificationStatus.toLowerCase()}
                    {item.listingRepresentativeUserId && " · has a representative"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[item.status] ?? "bg-slate-100 text-slate-600"}`}>{item.status.replaceAll("_", " ")}</span>
                  {item.verificationStatus === "UNVERIFIED" && <button className="rounded-md border px-3 py-1.5 text-sm font-medium" onClick={() => void submitVerification(item.id)} type="button">Submit verification</button>}
                  {item.status === "DRAFT" && <button className="rounded-md border px-3 py-1.5 text-sm font-medium" onClick={() => void transition(item.id, "PENDING_REVIEW")} type="button">Submit for review</button>}
                  {item.status === "PUBLISHED" && <button className="rounded-md border px-3 py-1.5 text-sm font-medium" onClick={() => void transition(item.id, "PAUSED")} type="button">Pause</button>}
                  {item.status === "PAUSED" && <button className="rounded-md border px-3 py-1.5 text-sm font-medium" onClick={() => void transition(item.id, "PUBLISHED")} type="button">Publish</button>}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <p>Page {data.page} of {totalPages} · {data.total} listings</p>
          <div className="flex gap-2">
            <button className="rounded-md border px-3 py-1.5 font-medium disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-500" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">Previous</button>
            <button className="rounded-md border px-3 py-1.5 font-medium disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-500" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} type="button">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
