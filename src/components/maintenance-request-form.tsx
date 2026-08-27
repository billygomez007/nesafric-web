"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Property = { id: string; name: string; referenceNumber: string };
type Unit = { id: string; name: string };
type Tenant = { id: string; tenant: { legalName: string; preferredName: string | null } };

const categories = ["plumbing", "electrical", "roofing", "air conditioning", "appliance", "carpentry", "painting", "structural", "security", "sanitation", "other"];

export function MaintenanceRequestForm() {
  const router = useRouter();
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedProperty = useMemo(() => properties?.find((property) => property.id === propertyId), [properties, propertyId]);

  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) {
      const timer = setTimeout(() => setError("Choose an organisation before reporting maintenance."), 0);
      return () => clearTimeout(timer);
    }
    Promise.all([
      fetch("/api/dashboard", { headers: { "x-organisation-id": organisationId } }),
      fetch("/api/tenants", { headers: { "x-organisation-id": organisationId } }),
    ]).then(async ([propertyResponse, tenantResponse]) => {
      if (!propertyResponse.ok) throw new Error((await propertyResponse.json()).error?.message ?? "Unable to load properties.");
      setProperties((await propertyResponse.json()).properties);
      if (tenantResponse.ok) setTenants(await tenantResponse.json());
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load maintenance options."));
  }, []);

  useEffect(() => {
    if (!propertyId) return;
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return;
    fetch(`/api/properties?id=${encodeURIComponent(propertyId)}`, { headers: { "x-organisation-id": organisationId } }).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error?.message ?? "Unable to load units.");
      const property = await response.json();
      setUnits([...property.units, ...property.buildings.flatMap((building: { units: Unit[] }) => building.units)]);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load units."));
  }, [propertyId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Choose an organisation before reporting maintenance.");
    const form = new FormData(event.currentTarget);
    const fileKey = String(form.get("fileKey") ?? "").trim();
    setSaving(true);
    const response = await fetch("/api/maintenance/requests", {
      method: "POST",
      headers: { "content-type": "application/json", "x-organisation-id": organisationId },
      body: JSON.stringify({
        propertyId,
        unitId: form.get("unitId") || undefined,
        tenantOrganisationId: form.get("tenantOrganisationId") || undefined,
        title: form.get("title"),
        description: form.get("description"),
        category: form.get("category"),
        priority: form.get("priority"),
        attachments: fileKey ? [{ fileKey, fileName: form.get("fileName") || fileKey, contentType: form.get("contentType") || undefined }] : [],
      }),
    });
    if (!response.ok) {
      setError((await response.json()).error?.message ?? "Unable to report maintenance.");
      setSaving(false);
      return;
    }
    const request = await response.json();
    router.push(`/maintenance/${request.id}`);
  }

  if (!properties && !error) return <p className="rounded-xl border bg-white p-6 text-slate-600">Loading properties and tenants...</p>;
  return <form className="grid gap-5 rounded-2xl border bg-white p-6 shadow-sm" onSubmit={submit}>
    <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Property<select className="mt-1 w-full rounded-lg border p-3" required value={propertyId} onChange={(event) => { setUnits([]); setPropertyId(event.target.value); }}><option value="">Select property</option>{properties?.map((property) => <option key={property.id} value={property.id}>{property.name} ({property.referenceNumber})</option>)}</select></label><label className="text-sm font-medium">Unit<select className="mt-1 w-full rounded-lg border p-3" disabled={!selectedProperty} name="unitId"><option value="">Whole property / no unit</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label></div>
    <label className="text-sm font-medium">Tenant reporter <span className="font-normal text-slate-500">(optional for internal reports)</span><select className="mt-1 w-full rounded-lg border p-3" name="tenantOrganisationId"><option value="">Internal report</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.tenant.preferredName || tenant.tenant.legalName}</option>)}</select></label>
    <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Category<select className="mt-1 w-full rounded-lg border p-3" name="category">{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label><label className="text-sm font-medium">Priority<select className="mt-1 w-full rounded-lg border p-3" name="priority"><option value="EMERGENCY">Emergency</option><option value="URGENT">Urgent</option><option value="NORMAL">Normal</option><option value="LOW">Low</option></select></label></div>
    <label className="text-sm font-medium">Issue title<input className="mt-1 w-full rounded-lg border p-3" minLength={3} name="title" required /></label><label className="text-sm font-medium">Description<textarea className="mt-1 w-full rounded-lg border p-3" minLength={3} name="description" required rows={5} /></label>
    <fieldset className="grid gap-3 rounded-xl border p-4"><legend className="px-1 text-sm font-semibold">Photo/document metadata <span className="font-normal text-slate-500">(optional)</span></legend><div className="grid gap-3 md:grid-cols-3"><input className="rounded-lg border p-3 text-sm" name="fileKey" placeholder="Storage file key" /><input className="rounded-lg border p-3 text-sm" name="fileName" placeholder="File name" /><input className="rounded-lg border p-3 text-sm" name="contentType" placeholder="image/jpeg" /></div></fieldset>
    {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}<button className="rounded-lg bg-slate-950 p-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={saving || !propertyId}>{saving ? "Reporting..." : "Report maintenance issue"}</button>
  </form>;
}
