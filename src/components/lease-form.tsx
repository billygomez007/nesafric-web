"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type PropertyOption = { id: string; name: string; referenceNumber: string };
type UnitOption = { id: string; name: string; status: string };
type TenantOption = { id: string; tenant: { legalName: string; preferredName: string | null }; email: string | null };

export function LeaseForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [loadingUnits, setLoadingUnits] = useState(false);

  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) {
      const timer = setTimeout(() => {
        setError("Choose an organisation before creating a lease.");
        setLoading(false);
      }, 0);
      return () => clearTimeout(timer);
    }
    Promise.all([
      fetch("/api/dashboard", { headers: { "x-organisation-id": organisationId } }),
      fetch("/api/tenants", { headers: { "x-organisation-id": organisationId } }),
    ]).then(async ([propertyResponse, tenantResponse]) => {
      if (!propertyResponse.ok || !tenantResponse.ok) {
        const failed = !propertyResponse.ok ? propertyResponse : tenantResponse;
        throw new Error((await failed.json()).error?.message ?? "Unable to load lease options.");
      }
      setProperties((await propertyResponse.json()).properties);
      setTenants(await tenantResponse.json());
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load lease options."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!propertyId) return;
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return;
    fetch(`/api/properties?id=${encodeURIComponent(propertyId)}`, { headers: { "x-organisation-id": organisationId } })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error?.message ?? "Unable to load units.");
        const property = await response.json();
        setUnits([
          ...property.units,
          ...property.buildings.flatMap((building: { units: UnitOption[] }) => building.units),
        ]);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load units."))
      .finally(() => setLoadingUnits(false));
  }, [propertyId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Choose an organisation before creating a lease.");
    const form = new FormData(event.currentTarget);
    const tenantOrganisationIds = form.getAll("tenantOrganisationIds").map(String);
    const response = await fetch("/api/leases", { method: "POST", headers: { "content-type": "application/json", "x-organisation-id": organisationId }, body: JSON.stringify({ referenceNumber: form.get("referenceNumber"), propertyId: form.get("propertyId"), unitId: form.get("unitId") || undefined, tenantOrganisationIds, startDate: form.get("startDate"), endDate: form.get("endDate") || undefined, rentAmountMinor: String(Math.round(Number(form.get("rentAmount")) * 100)), currencyCode: form.get("currencyCode"), rentFrequency: form.get("rentFrequency"), depositAmountMinor: form.get("depositAmount") ? String(Math.round(Number(form.get("depositAmount")) * 100)) : undefined, notes: form.get("notes") || undefined }) });
    if (!response.ok) return setError((await response.json()).error?.message ?? "Unable to create lease.");
    const lease = await response.json();
    router.push(`/leases/${lease.id}`);
  }
  if (loading) return <p className="mt-8 rounded-xl border bg-white p-6 text-slate-600">Loading properties and tenants...</p>;
  return <form className="mt-8 grid gap-4 rounded-xl border p-6" onSubmit={submit}>
    <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Lease reference<input className="mt-1 w-full rounded border p-3" name="referenceNumber" required /></label><label className="text-sm font-medium">Property<select className="mt-1 w-full rounded border p-3" name="propertyId" required value={propertyId} onChange={(event) => { setUnits([]); setLoadingUnits(Boolean(event.target.value)); setPropertyId(event.target.value); }}><option value="">Select a property</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name} ({property.referenceNumber})</option>)}</select>{!properties.length && <span className="mt-1 block text-xs text-amber-700">No properties are available in this organisation.</span>}</label></div>
    <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Unit <span className="font-normal text-slate-500">(optional)</span><select className="mt-1 w-full rounded border p-3" name="unitId" disabled={!propertyId || loadingUnits}><option value="">{loadingUnits ? "Loading units..." : "No unit"}</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.status.toLowerCase()})</option>)}</select></label><label className="text-sm font-medium">Tenants<select className="mt-1 min-h-28 w-full rounded border p-3" name="tenantOrganisationIds" multiple required>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.tenant.preferredName || tenant.tenant.legalName}{tenant.email ? ` — ${tenant.email}` : ""}</option>)}</select>{!tenants.length && <span className="mt-1 block text-xs text-amber-700">No tenants are available in this organisation.</span>}<span className="mt-1 block text-xs font-normal text-slate-500">Use Ctrl/Cmd to select multiple tenants.</span></label></div>
    <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Start date<input className="mt-1 w-full rounded border p-3" name="startDate" type="date" required /></label><label className="text-sm font-medium">End date<input className="mt-1 w-full rounded border p-3" name="endDate" type="date" /></label></div>
    <div className="grid gap-4 md:grid-cols-3"><label className="text-sm font-medium">Rent<input className="mt-1 w-full rounded border p-3" min="0.01" name="rentAmount" required step="0.01" type="number" /></label><label className="text-sm font-medium">Currency<input className="mt-1 w-full rounded border p-3" name="currencyCode" defaultValue="GHS" required /></label><label className="text-sm font-medium">Frequency<select className="mt-1 w-full rounded border p-3" name="rentFrequency"><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="ANNUAL">Annual</option></select></label></div>
    <label className="text-sm font-medium">Deposit<input className="mt-1 w-full rounded border p-3" min="0" name="depositAmount" step="0.01" type="number" /></label>
    <label className="text-sm font-medium">Notes<textarea className="mt-1 w-full rounded border p-3" name="notes" rows={3} /></label>
    {error && <p className="text-sm text-red-700">{error}</p>}<button className="rounded bg-slate-950 p-3 font-semibold text-white">Create lease</button>
  </form>;
}
