"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Deposit = { internalReference: string; amountMinor: string; refundedAmountMinor: string; deductedAmountMinor: string; currencyCode: string; receivedAt: string; method: string; externalReference: string; evidenceReference: string | null; status: string; notes: string | null; tenantOrganisation: { tenant: { legalName: string; preferredName: string | null } }; lease: { id: string; referenceNumber: string }; property: { name: string }; unit: { name: string } | null; ledgerEntries: Array<{ id: string; type: string; direction: string; amountMinor: string; effectiveAt: string }> };

export function DepositDetail({ depositId }: { depositId: string }) {
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) {
      const timer = setTimeout(() => setError("Choose an organisation to view this deposit."), 0);
      return () => clearTimeout(timer);
    }
    fetch(`/api/deposits/${depositId}`, { headers: { "x-organisation-id": organisationId } }).then(async (response) => response.ok ? setDeposit(await response.json()) : setError((await response.json()).error?.message ?? "Unable to load deposit."));
  }, [depositId]);
  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</p>;
  if (!deposit) return <p className="rounded-xl border bg-white p-6 text-slate-600">Loading deposit...</p>;
  const money = (value: string) => new Intl.NumberFormat("en-GH", { style: "currency", currency: deposit.currencyCode }).format(Number(value) / 100);
  return <article className="rounded-2xl border bg-white p-6 shadow-sm sm:p-8"><header className="flex flex-col justify-between gap-4 border-b pb-6 sm:flex-row"><div><p className="text-sm font-semibold text-emerald-700">SECURITY DEPOSIT</p><h1 className="mt-1 text-3xl font-semibold">{deposit.internalReference}</h1><p className="mt-2 text-3xl font-semibold">{money(deposit.amountMinor)}</p></div><div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{deposit.status}</span><Link className="ml-2 rounded-lg border px-4 py-2 text-sm font-semibold" href="/deposits">Back</Link></div></header><dl className="mt-6 grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-slate-500">Tenant</dt><dd className="mt-1 font-medium">{deposit.tenantOrganisation.tenant.preferredName || deposit.tenantOrganisation.tenant.legalName}</dd></div><div><dt className="text-slate-500">Lease</dt><dd className="mt-1 font-medium"><Link href={`/leases/${deposit.lease.id}`}>{deposit.lease.referenceNumber}</Link></dd></div><div><dt className="text-slate-500">Property/unit</dt><dd className="mt-1 font-medium">{deposit.property.name}{deposit.unit ? ` · ${deposit.unit.name}` : ""}</dd></div><div><dt className="text-slate-500">Method/reference</dt><dd className="mt-1 font-medium">{deposit.method.replaceAll("_", " ")} · {deposit.externalReference}</dd></div><div><dt className="text-slate-500">Refunded</dt><dd className="mt-1 font-medium">{money(deposit.refundedAmountMinor)}</dd></div><div><dt className="text-slate-500">Deducted</dt><dd className="mt-1 font-medium">{money(deposit.deductedAmountMinor)}</dd></div></dl>{deposit.notes && <p className="mt-6 rounded-lg bg-slate-50 p-4 text-sm">{deposit.notes}</p>}<section className="mt-8"><h2 className="text-xl font-semibold">Immutable ledger history</h2><div className="mt-3 divide-y rounded-xl border">{deposit.ledgerEntries.map((entry) => <div className="flex justify-between p-4" key={entry.id}><span>{entry.type.replaceAll("_", " ")} · {entry.direction}</span><strong>{money(entry.amountMinor)}</strong></div>)}</div></section></article>;
}
