"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Lease = { id: string; referenceNumber: string; currencyCode: string; parties: Array<{ tenantOrganisation: { id: string; tenant: { legalName: string; preferredName: string | null } } }> };
type Deposit = { id: string; internalReference: string; amountMinor: string; currencyCode: string; receivedAt: string; method: string; status: string; tenantOrganisation: { tenant: { legalName: string; preferredName: string | null } }; lease: { referenceNumber: string }; property: { name: string } };

export function DepositManager() {
  const [leases, setLeases] = useState<Lease[]>([]);
  const [deposits, setDeposits] = useState<Deposit[] | null>(null);
  const [leaseId, setLeaseId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const selectedLease = useMemo(() => leases.find((lease) => lease.id === leaseId), [leaseId, leases]);

  async function load() {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) throw new Error("Choose an organisation to view deposits.");
    const [depositResponse, leaseResponse] = await Promise.all([
      fetch("/api/deposits", { headers: { "x-organisation-id": organisationId } }),
      fetch("/api/leases", { headers: { "x-organisation-id": organisationId } }),
    ]);
    if (!depositResponse.ok || !leaseResponse.ok) {
      const failed = !depositResponse.ok ? depositResponse : leaseResponse;
      throw new Error((await failed.json()).error?.message ?? "Unable to load deposits.");
    }
    setDeposits(await depositResponse.json());
    setLeases(await leaseResponse.json());
  }

  useEffect(() => {
    const timer = setTimeout(() => void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load deposits.")), 0);
    return () => clearTimeout(timer);
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId || !selectedLease) return setError("Choose an organisation and lease.");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/deposits", {
      method: "POST",
      headers: { "content-type": "application/json", "x-organisation-id": organisationId },
      body: JSON.stringify({
        leaseId,
        tenantOrganisationId: form.get("tenantOrganisationId"),
        amountMinor: form.get("amountMinor"),
        currencyCode: selectedLease.currencyCode,
        receivedAt: form.get("receivedAt"),
        method: form.get("method"),
        externalReference: form.get("externalReference"),
        idempotencyKey,
        evidenceReference: form.get("evidenceReference") || undefined,
        notes: form.get("notes") || undefined,
      }),
    });
    if (!response.ok) return setError((await response.json()).error?.message ?? "Unable to record deposit.");
    event.currentTarget.reset();
    setIdempotencyKey(crypto.randomUUID());
    setLeaseId("");
    setError("");
    setSuccess("Security deposit recorded separately from rent revenue.");
    await load();
  }

  if (!deposits && !error) return <p className="rounded-xl border bg-white p-6 text-slate-600">Loading deposits...</p>;
  return <div className="grid gap-6">
    <form className="grid gap-4 rounded-2xl border bg-white p-6 shadow-sm" onSubmit={create}><h2 className="text-xl font-semibold">Record security/caution deposit</h2><div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Lease<select className="mt-1 w-full rounded-lg border p-3" required value={leaseId} onChange={(event) => setLeaseId(event.target.value)}><option value="">Select lease</option>{leases.map((lease) => <option key={lease.id} value={lease.id}>{lease.referenceNumber}</option>)}</select></label><label className="text-sm font-medium">Tenant<select className="mt-1 w-full rounded-lg border p-3" disabled={!selectedLease} name="tenantOrganisationId" required><option value="">Select tenant</option>{selectedLease?.parties.map(({ tenantOrganisation }) => <option key={tenantOrganisation.id} value={tenantOrganisation.id}>{tenantOrganisation.tenant.preferredName || tenantOrganisation.tenant.legalName}</option>)}</select></label></div><div className="grid gap-4 md:grid-cols-3"><label className="text-sm font-medium">Amount (minor units)<input className="mt-1 w-full rounded-lg border p-3" min="1" name="amountMinor" required /></label><label className="text-sm font-medium">Received date<input className="mt-1 w-full rounded-lg border p-3" name="receivedAt" required type="datetime-local" /></label><label className="text-sm font-medium">Method<select className="mt-1 w-full rounded-lg border p-3" name="method"><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="MOBILE_MONEY">Mobile Money</option></select></label></div><div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Reference<input className="mt-1 w-full rounded-lg border p-3" name="externalReference" required /></label><label className="text-sm font-medium">Evidence reference<input className="mt-1 w-full rounded-lg border p-3" name="evidenceReference" /></label></div><label className="text-sm font-medium">Notes<textarea className="mt-1 w-full rounded-lg border p-3" name="notes" rows={2} /></label><button className="rounded-lg bg-slate-950 p-3 font-semibold text-white disabled:opacity-50" disabled={!selectedLease}>Record deposit</button>{success && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}{error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}</form>
    <section className="rounded-2xl border bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Deposit history</h2>{deposits?.length ? <div className="mt-4 grid gap-3">{deposits.map((deposit) => <Link className="grid gap-2 rounded-xl border p-4 hover:border-emerald-500 sm:grid-cols-[1fr_auto]" href={`/deposits/${deposit.id}`} key={deposit.id}><div><p className="font-semibold">{deposit.internalReference}</p><p className="text-sm text-slate-600">{deposit.tenantOrganisation.tenant.preferredName || deposit.tenantOrganisation.tenant.legalName} · {deposit.lease.referenceNumber} · {deposit.property.name}</p><p className="mt-1 text-xs text-slate-500">{new Intl.DateTimeFormat("en-GH", { dateStyle: "medium" }).format(new Date(deposit.receivedAt))} · {deposit.method.replaceAll("_", " ")}</p></div><div className="text-right"><p className="font-semibold">{new Intl.NumberFormat("en-GH", { style: "currency", currency: deposit.currencyCode }).format(Number(deposit.amountMinor) / 100)}</p><span className="text-xs">{deposit.status}</span></div></Link>)}</div> : <p className="mt-4 rounded-xl border border-dashed p-8 text-center text-slate-500">No security deposits recorded.</p>}</section>
  </div>;
}
