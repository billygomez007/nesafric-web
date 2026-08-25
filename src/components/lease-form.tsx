"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function LeaseForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Choose an organisation before creating a lease.");
    const form = new FormData(event.currentTarget);
    const tenantOrganisationIds = String(form.get("tenantOrganisationIds")).split(",").map((value) => value.trim()).filter(Boolean);
    const response = await fetch("/api/leases", { method: "POST", headers: { "content-type": "application/json", "x-organisation-id": organisationId }, body: JSON.stringify({ referenceNumber: form.get("referenceNumber"), propertyId: form.get("propertyId"), unitId: form.get("unitId") || undefined, tenantOrganisationIds, startDate: form.get("startDate"), endDate: form.get("endDate") || undefined, rentAmountMinor: form.get("rentAmountMinor"), currencyCode: form.get("currencyCode"), rentFrequency: form.get("rentFrequency"), depositAmountMinor: form.get("depositAmountMinor") || undefined, notes: form.get("notes") || undefined }) });
    if (!response.ok) return setError((await response.json()).error?.message ?? "Unable to create lease.");
    router.push("/leases");
  }
  return <form className="mt-8 grid gap-4 rounded-xl border p-6" onSubmit={submit}>
    <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Lease reference<input className="mt-1 w-full rounded border p-3" name="referenceNumber" required /></label><label className="text-sm font-medium">Property ID<input className="mt-1 w-full rounded border p-3" name="propertyId" required /></label></div>
    <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Unit ID <span className="font-normal text-slate-500">(optional)</span><input className="mt-1 w-full rounded border p-3" name="unitId" /></label><label className="text-sm font-medium">Tenant relationship IDs<input className="mt-1 w-full rounded border p-3" name="tenantOrganisationIds" placeholder="comma-separated UUIDs" required /></label></div>
    <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Start date<input className="mt-1 w-full rounded border p-3" name="startDate" type="date" required /></label><label className="text-sm font-medium">End date<input className="mt-1 w-full rounded border p-3" name="endDate" type="date" /></label></div>
    <div className="grid gap-4 md:grid-cols-3"><label className="text-sm font-medium">Rent (minor units)<input className="mt-1 w-full rounded border p-3" name="rentAmountMinor" inputMode="numeric" required /></label><label className="text-sm font-medium">Currency<input className="mt-1 w-full rounded border p-3" name="currencyCode" defaultValue="GHS" required /></label><label className="text-sm font-medium">Frequency<select className="mt-1 w-full rounded border p-3" name="rentFrequency"><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="ANNUAL">Annual</option></select></label></div>
    <label className="text-sm font-medium">Deposit (minor units)<input className="mt-1 w-full rounded border p-3" name="depositAmountMinor" inputMode="numeric" /></label>
    <label className="text-sm font-medium">Notes<textarea className="mt-1 w-full rounded border p-3" name="notes" rows={3} /></label>
    {error && <p className="text-sm text-red-700">{error}</p>}<button className="rounded bg-slate-950 p-3 font-semibold text-white">Create lease</button>
  </form>;
}
