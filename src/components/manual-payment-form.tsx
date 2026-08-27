"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Lease = {
  id: string;
  referenceNumber: string;
  currencyCode: string;
  property: { name: string };
  parties: Array<{ tenantOrganisation: { id: string; tenant: { legalName: string; preferredName: string | null } } }>;
};

export function ManualPaymentForm() {
  const router = useRouter();
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [leaseId, setLeaseId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const selectedLease = useMemo(() => leases?.find((lease) => lease.id === leaseId), [leaseId, leases]);

  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) {
      const timer = setTimeout(() => setError("Choose an organisation before recording a payment."), 0);
      return () => clearTimeout(timer);
    }
    fetch("/api/leases", { headers: { "x-organisation-id": organisationId } })
      .then(async (response) => response.ok ? setLeases(await response.json()) : setError((await response.json()).error?.message ?? "Unable to load leases."));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Choose an organisation before recording a payment.");
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    const response = await fetch("/api/payments/manual", {
      method: "POST",
      headers: { "content-type": "application/json", "x-organisation-id": organisationId },
      body: JSON.stringify({
        leaseId,
        tenantOrganisationId: form.get("tenantOrganisationId"),
        amountMinor: String(Math.round(Number(form.get("amount")) * 100)),
        currencyCode: selectedLease?.currencyCode,
        paidAt: form.get("paidAt"),
        method: form.get("method"),
        externalReference: form.get("externalReference"),
        evidenceReference: form.get("evidenceReference"),
        idempotencyKey,
      }),
    });
    if (!response.ok) {
      setError((await response.json()).error?.message ?? "Unable to record payment.");
      setSaving(false);
      return;
    }
    const payment = await response.json();
    router.push(`/payments/${payment.id}`);
  }

  if (!leases && !error) return <p className="rounded-xl border bg-white p-6 text-slate-600">Loading leases and tenants...</p>;
  return <form className="grid gap-5 rounded-2xl border bg-white p-6 shadow-sm" onSubmit={submit}>
    <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Lease<select className="mt-1 w-full rounded-lg border p-3" required value={leaseId} onChange={(event) => setLeaseId(event.target.value)}><option value="">Select lease</option>{leases?.map((lease) => <option key={lease.id} value={lease.id}>{lease.referenceNumber} · {lease.property.name}</option>)}</select></label><label className="text-sm font-medium">Tenant<select className="mt-1 w-full rounded-lg border p-3" disabled={!selectedLease} name="tenantOrganisationId" required><option value="">Select tenant</option>{selectedLease?.parties.map(({ tenantOrganisation }) => <option key={tenantOrganisation.id} value={tenantOrganisation.id}>{tenantOrganisation.tenant.preferredName || tenantOrganisation.tenant.legalName}</option>)}</select></label></div>
    <div className="grid gap-4 md:grid-cols-3"><label className="text-sm font-medium">Amount<input className="mt-1 w-full rounded-lg border p-3" min="0.01" name="amount" required step="0.01" type="number" /></label><label className="text-sm font-medium">Currency<input className="mt-1 w-full rounded-lg border bg-slate-50 p-3" readOnly value={selectedLease?.currencyCode ?? ""} /></label><label className="text-sm font-medium">Payment date<input className="mt-1 w-full rounded-lg border p-3" name="paidAt" required type="datetime-local" /></label></div>
    <label className="text-sm font-medium">Method<select className="mt-1 w-full rounded-lg border p-3" name="method"><option value="CASH">Cash</option><option value="BANK_TRANSFER">Direct bank transfer</option><option value="MOBILE_MONEY">Manual Mobile Money</option></select></label>
    <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Payment reference<input className="mt-1 w-full rounded-lg border p-3" name="externalReference" placeholder="Receipt, transfer, or transaction reference" required /></label><label className="text-sm font-medium">Evidence reference<input className="mt-1 w-full rounded-lg border p-3" name="evidenceReference" placeholder="File key, URL, or document reference" required /></label></div>
    <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">The payment will be allocated automatically to the oldest outstanding obligations. Any overpayment remains safely unallocated.</p>
    {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <button className="rounded-lg bg-slate-950 p-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={saving || !selectedLease}>{saving ? "Recording..." : "Record confirmed payment"}</button>
  </form>;
}
