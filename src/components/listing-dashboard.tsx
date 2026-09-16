"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Listing = { id: string; title: string; listingType: string; category: string; status: string; verificationStatus: string; createdAt: string; publishedAt: string | null; property: { name: string; referenceNumber: string }; unit: { name: string } | null; rentAmountMinor: string | null; askingAmountMinor: string | null; currencyCode: string; media: { type: string }[] };

export function ListingDashboard() {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) { const timer = setTimeout(() => setError("Choose an organisation to view listings."), 0); return () => clearTimeout(timer); }
    fetch("/api/listings", { headers: { "x-organisation-id": organisationId } }).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error?.message ?? "Unable to load listings.");
      setListings((await response.json()).items);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load listings."));
  }, []);
  if (error) return <p className="rounded-xl bg-red-50 p-6 text-red-800">{error}</p>;
  if (!listings) return <p className="rounded-xl border border-hairline border-hairline bg-white p-6 text-muted">Loading listings...</p>;
  const count = (status: string) => listings.filter((listing) => listing.status === status).length;
  return <div className="grid gap-6"><section className="grid gap-4 sm:grid-cols-3">{[["Published", count("PUBLISHED")], ["Pending review", count("PENDING_REVIEW")], ["Drafts", count("DRAFT")]].map(([label, value]) => <div className="rounded-2xl border border-hairline bg-white p-5 shadow-sm" key={label}><p className="text-sm text-muted">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>)}</section><section className="rounded-2xl border border-hairline bg-white p-6 shadow-sm"><div className="flex flex-col justify-between gap-3 sm:flex-row"><div><h2 className="text-xl font-semibold">Listing history</h2><p className="mt-1 text-sm text-muted">{listings.length} property and unit listings</p></div><div className="flex gap-2"><Link className="rounded-xl border border-hairline px-4 py-2 text-sm font-semibold" href="/listings/leads">Lead inbox</Link><Link className="rounded-lg bg-forest px-4 py-2 text-sm font-semibold text-white" href="/listings/new">Create listing</Link></div></div>{listings.length ? <div className="mt-5 grid gap-3">{listings.map((listing) => <Link className="grid gap-3 rounded-xl border border-hairline p-4 hover:border-teal sm:grid-cols-[1fr_auto]" href={`/listings/${listing.id}`} key={listing.id}><div><div className="flex flex-wrap gap-2"><p className="font-semibold">{listing.title}</p><span className="rounded-full bg-surface px-2 py-1 text-xs">{listing.listingType}</span></div><p className="mt-1 text-sm text-muted">{listing.property.name}{listing.unit ? ` · ${listing.unit.name}` : ""} · {listing.category}</p><p className="mt-2 text-xs text-muted">{listing.media.length} media records · {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(listing.createdAt))}</p></div><div className="flex items-start gap-2"><span className="rounded-full bg-gold/10 px-2 py-1 text-xs font-semibold text-ink">{listing.verificationStatus}</span><span className="rounded-full bg-surface px-2 py-1 text-xs font-semibold">{listing.status}</span></div></Link>)}</div> : <p className="mt-5 rounded-xl border border-hairline border-dashed p-8 text-center text-muted">No listings created.</p>}</section></div>;
}
