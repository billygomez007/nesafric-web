"use client";

import { useCallback, useEffect, useState } from "react";

type Enquiry = { id: string; providerId: string; propertyId: string | null; maintenanceRequestId: string | null; quotationRequestId: string | null; message: string; status: string; createdAt: string; provider: { displayName: string }; category: { name: string }; requestingOrganisation: { name: string }; history: { id: string; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }[] };

export function MarketplaceRequestHistory({ providerId }: { providerId?: string }) {
  const [items, setItems] = useState<Enquiry[] | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const load = useCallback(async () => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    const response = await fetch(`/api/marketplace/enquiries${providerId ? `?providerId=${providerId}` : ""}`, { headers: organisationId ? { "x-organisation-id": organisationId } : {} });
    if (!response.ok) throw new Error((await response.json()).error?.message ?? "Unable to load marketplace requests.");
    setItems((await response.json()).items);
  }, [providerId]);
  useEffect(() => { const timer = setTimeout(() => void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load requests.")), 0); return () => clearTimeout(timer); }, [load]);
  async function update(enquiryId: string, status: string) {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    const response = await fetch(`/api/marketplace/enquiries/${enquiryId}`, { method: "PATCH", headers: { "content-type": "application/json", ...(organisationId ? { "x-organisation-id": organisationId } : {}) }, body: JSON.stringify({ status }) });
    if (!response.ok) return setError((await response.json()).error?.message ?? "Unable to update enquiry.");
    setError(""); setSuccess(`Enquiry marked ${status.toLowerCase()}.`); await load();
  }
  async function quote(enquiryId: string, message: string) {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Choose an organisation.");
    const response = await fetch(`/api/marketplace/enquiries/${enquiryId}/quote-request`, { method: "POST", headers: { "content-type": "application/json", "x-organisation-id": organisationId }, body: JSON.stringify({ scope: message }) });
    if (!response.ok) return setError((await response.json()).error?.message ?? "Unable to request quotation.");
    setError(""); setSuccess("Quotation requested."); await load();
  }
  if (!items && !error) return <p className="rounded-xl border bg-white p-6 text-slate-500">Loading marketplace request history...</p>;
  return <div className="grid gap-4">{(error || success) && <p className={`rounded-lg p-3 text-sm ${error ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{error || success}</p>}{items?.length ? items.map((item) => <article className="rounded-xl border bg-white p-5 shadow-sm" key={item.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-emerald-700">{item.category.name}</p><h3 className="mt-1 font-semibold">{providerId ? item.requestingOrganisation.name : item.provider.displayName}</h3><p className="mt-2 text-sm text-slate-700">{item.message}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{item.status}</span></div><p className="mt-3 text-xs text-slate-500">{new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))} · {item.maintenanceRequestId ? "Maintenance linked" : "General enquiry"} · {item.quotationRequestId ? "Quote requested" : "No quote"}</p><div className="mt-4 flex flex-wrap gap-2">{providerId && item.status === "NEW" && <button className="rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => void update(item.id, "VIEWED")}>Mark viewed</button>}{providerId && ["NEW", "VIEWED"].includes(item.status) && <button className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white" onClick={() => void update(item.id, "RESPONDED")}>Mark responded</button>}{!providerId && !item.quotationRequestId && item.maintenanceRequestId && !["CLOSED", "CANCELLED"].includes(item.status) && <button className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white" onClick={() => void quote(item.id, item.message)}>Request quote</button>}{!providerId && !["CLOSED", "CANCELLED"].includes(item.status) && <button className="rounded-lg border px-3 py-2 text-sm font-semibold text-red-700" onClick={() => void update(item.id, "CANCELLED")}>Cancel</button>}{["RESPONDED", "VIEWED"].includes(item.status) && <button className="rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => void update(item.id, "CLOSED")}>Close</button>}</div></article>) : <p className="rounded-xl border border-dashed bg-white p-8 text-center text-slate-500">No marketplace enquiries yet.</p>}</div>;
}
