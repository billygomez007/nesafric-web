"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { PublicProvider } from "@/components/marketplace-search";

type Property = { id: string; name: string; referenceNumber: string };
type Maintenance = { id: string; title: string; property: { id: string; name: string }; status: string };

export function MarketplaceProviderProfile({ providerId }: { providerId: string }) {
  const [provider, setProvider] = useState<PublicProvider | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [maintenance, setMaintenance] = useState<Maintenance[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => {
    fetch(`/api/public/marketplace/providers/${providerId}`).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error?.message ?? "Provider is not publicly listed.");
      setProvider((await response.json()).provider);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load provider."));
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (organisationId) {
      Promise.all([fetch("/api/dashboard", { headers: { "x-organisation-id": organisationId } }), fetch("/api/maintenance/requests", { headers: { "x-organisation-id": organisationId } })]).then(async ([propertyResponse, maintenanceResponse]) => {
        if (propertyResponse.ok) setProperties((await propertyResponse.json()).properties);
        if (maintenanceResponse.ok) setMaintenance(await maintenanceResponse.json());
      });
    }
  }, [providerId]);
  async function enquire(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Sign in and choose an organisation to contact this provider.");
    const data = new FormData(event.currentTarget);
    const maintenanceRequestId = String(data.get("maintenanceRequestId") || "");
    const selectedMaintenance = maintenance.find((request) => request.id === maintenanceRequestId);
    const response = await fetch("/api/marketplace/enquiries", { method: "POST", headers: { "content-type": "application/json", "x-organisation-id": organisationId }, body: JSON.stringify({ providerId, categoryId: data.get("categoryId"), propertyId: selectedMaintenance?.property.id || data.get("propertyId") || undefined, maintenanceRequestId: maintenanceRequestId || undefined, message: data.get("message") }) });
    if (!response.ok) return setError((await response.json()).error?.message ?? "Unable to send enquiry.");
    const enquiry = await response.json();
    if (data.get("requestQuote") === "on") {
      const quoteResponse = await fetch(`/api/marketplace/enquiries/${enquiry.id}/quote-request`, { method: "POST", headers: { "content-type": "application/json", "x-organisation-id": organisationId }, body: JSON.stringify({ scope: data.get("message") }) });
      if (!quoteResponse.ok) return setError((await quoteResponse.json()).error?.message ?? "Enquiry created, but quotation could not be requested.");
    }
    event.currentTarget.reset(); setError(""); setSuccess(data.get("requestQuote") === "on" ? "Enquiry and quotation request sent." : "Enquiry sent.");
  }
  if (error && !provider) return <p className="rounded-xl bg-red-50 p-6 text-red-800">{error}</p>;
  if (!provider) return <p className="rounded-xl border bg-white p-6 text-slate-500">Loading public provider profile...</p>;
  return <div className="grid gap-6 lg:grid-cols-[2fr_1fr]"><div className="grid content-start gap-6"><section className="rounded-2xl border bg-white p-6 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-emerald-700">{provider.type}</p><h1 className="mt-1 text-3xl font-semibold">{provider.displayName}</h1></div><div className="flex gap-2"><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">{provider.verification}</span><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">{provider.availability}</span></div></div><p className="mt-5 whitespace-pre-wrap text-slate-700">{provider.description || "This provider has not added a public description."}</p><div className="mt-5 flex flex-wrap gap-2">{provider.categories.map((category) => <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm" key={category.id}>{category.name}</span>)}</div></section><section className="grid gap-4 sm:grid-cols-3">{[["Average rating", provider.aggregateRating ? `${provider.aggregateRating.toFixed(1)} / 5` : "New"], ["Completed jobs", provider.completedJobs], ["Response time", provider.responseTimeHours ? `Within ${provider.responseTimeHours}h` : "Ask provider"]].map(([label, value]) => <div className="rounded-2xl border bg-white p-5 shadow-sm" key={label}><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-xl font-semibold">{value}</p></div>)}</section><section className="rounded-2xl border bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Public service areas</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{provider.serviceAreas.map((area, index) => <div className="rounded-xl border p-4" key={`${area.countryCode}-${index}`}><p className="font-medium">{area.label || [area.district, area.city, area.region].filter(Boolean).join(", ") || area.countryCode}</p><p className="mt-1 text-sm text-slate-500">{[area.countryCode, area.region, area.city, area.district].filter(Boolean).join(" · ")}</p></div>)}</div></section></div><aside><form className="sticky top-6 grid gap-4 rounded-2xl border bg-white p-5 shadow-sm" onSubmit={enquire}><div><h2 className="text-xl font-semibold">Contact provider</h2><p className="mt-1 text-sm text-slate-500">Enquiries remain private between your organisation and the provider.</p></div><label className="text-sm font-medium">Service category<select className="mt-1 w-full rounded-lg border p-3" name="categoryId" required>{provider.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="text-sm font-medium">Property <span className="font-normal text-slate-500">(optional)</span><select className="mt-1 w-full rounded-lg border p-3" name="propertyId"><option value="">No property link</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label><label className="text-sm font-medium">Maintenance request <span className="font-normal text-slate-500">(optional)</span><select className="mt-1 w-full rounded-lg border p-3" name="maintenanceRequestId"><option value="">No maintenance link</option>{maintenance.filter((request) => !["COMPLETED", "CLOSED", "REJECTED", "CANCELLED"].includes(request.status)).map((request) => <option key={request.id} value={request.id}>{request.title} · {request.property.name}</option>)}</select></label><label className="text-sm font-medium">Message<textarea className="mt-1 w-full rounded-lg border p-3" minLength={1} name="message" required rows={5} /></label><label className="flex items-start gap-2 text-sm"><input className="mt-1" name="requestQuote" type="checkbox" />Request a formal quotation now (requires a maintenance request)</label><button className="rounded-lg bg-slate-950 p-3 font-semibold text-white">Send request</button>{success && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}{error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}<Link className="text-center text-sm font-semibold text-emerald-700" href="/marketplace/requests">View request history</Link></form></aside></div>;
}
