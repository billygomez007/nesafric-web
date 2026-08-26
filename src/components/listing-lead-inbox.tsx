"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Lead = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  listing: { title: string };
  viewingRequests: { id: string; status: string; confirmedStartsAt: string | null }[];
  rentalApplications: { id: string; status: string }[];
};

export function ListingLeadInbox() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) {
      const timer = setTimeout(() => setError("Choose an organisation."), 0);
      return () => clearTimeout(timer);
    }
    fetch("/api/marketplace-leads?pageSize=100", { headers: { "x-organisation-id": organisationId } })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error?.message ?? "Unable to load leads.");
        setLeads((await response.json()).items);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load leads."));
  }, []);

  if (error) return <p className="rounded-xl bg-red-50 p-6 text-red-800">{error}</p>;
  if (!leads) return <p className="rounded-xl border bg-white p-6 text-slate-500">Loading lead inbox...</p>;
  return <section className="rounded-2xl border bg-white p-6 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-semibold">Marketplace prospects</h2><p className="mt-1 text-sm text-slate-500">Qualification, applications and viewings now live in the leasing CRM.</p></div>
      <Link className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white" href="/leasing">Open leasing CRM</Link>
    </div>
    {leads.length ? <div className="mt-5 grid gap-3">{leads.map((lead) => <Link className="rounded-xl border p-4 hover:border-emerald-500" href={`/leasing/leads/${lead.id}`} key={lead.id}>
      <div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs font-semibold text-emerald-700">{lead.listing.title}</p><h3 className="mt-1 font-semibold">{lead.name}</h3><p className="text-sm text-slate-500">{lead.email || lead.phone}</p></div><span className="self-start rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{lead.status.replaceAll("_", " ")}</span></div>
      <p className="mt-3 text-xs text-slate-500">{lead.viewingRequests.length} viewings · {lead.rentalApplications.length} applications</p>
    </Link>)}</div> : <p className="mt-5 rounded-xl border border-dashed p-8 text-center text-slate-500">No listing enquiries.</p>}
  </section>;
}
