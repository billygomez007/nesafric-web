"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Payment = {
  id: string;
  internalReference: string;
  externalReference: string;
  evidenceReference: string | null;
  providerTransactionRef: string | null;
  amountMinor: string;
  currencyCode: string;
  method: string;
  source: string;
  status: string;
  paidAt: string;
  reconciliationStatus: string;
  failureReason: string | null;
  reversalReason: string | null;
  tenantOrganisation: { id: string; tenant: { legalName: string; preferredName: string | null } };
  lease: { id: string; referenceNumber: string };
  property: { name: string };
  unit: { name: string } | null;
  allocations: Array<{ id: string; amountMinor: string; reversedAt: string | null; rentObligation: { dueDate: string; periodStart: string; periodEnd: string } }>;
  receipt: { id: string; receiptNumber: string; status: string } | null;
  ledgerEntries: Array<{ id: string; type: string; direction: string; amountMinor: string; effectiveAt: string }>;
};

function money(value: string, currency: string) {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency }).format(Number(value) / 100);
}

function date(value: string) {
  return new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function PaymentDetail({ paymentId }: { paymentId: string }) {
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState("");
  const [reversing, setReversing] = useState(false);

  const load = useCallback(async () => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) throw new Error("Choose an organisation to view this payment.");
    const response = await fetch(`/api/payments/${paymentId}`, { headers: { "x-organisation-id": organisationId } });
    if (!response.ok) throw new Error((await response.json()).error?.message ?? "Unable to load payment.");
    setPayment(await response.json());
  }, [paymentId]);

  useEffect(() => {
    const timer = setTimeout(() => void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load payment.")), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function reverse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Choose an organisation to reverse this payment.");
    const reason = new FormData(event.currentTarget).get("reason");
    setReversing(true);
    const response = await fetch(`/api/payments/${paymentId}/reverse`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-organisation-id": organisationId },
      body: JSON.stringify({ reason }),
    });
    if (!response.ok) setError((await response.json()).error?.message ?? "Unable to reverse payment.");
    else await load();
    setReversing(false);
  }

  if (error && !payment) return <p className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</p>;
  if (!payment) return <p className="rounded-xl border bg-white p-6 text-slate-600">Loading payment...</p>;
  const allocated = payment.allocations.filter(({ reversedAt }) => !reversedAt).reduce((sum, allocation) => sum + Number(allocation.amountMinor), 0);

  return <div className="grid gap-6">
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-4 sm:flex-row"><div><p className="text-sm font-semibold text-emerald-700">PAYMENT</p><h1 className="mt-1 text-3xl font-semibold">{payment.internalReference}</h1><p className="mt-2 text-2xl font-semibold">{money(payment.amountMinor, payment.currencyCode)}</p></div><div className="flex items-start gap-2"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{payment.status}</span><Link className="rounded-lg border px-4 py-2 text-sm font-semibold" href="/payments">Back</Link></div></div>
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-slate-500">Tenant</dt><dd className="mt-1 font-medium"><Link href={`/tenants/${payment.tenantOrganisation.id}`}>{payment.tenantOrganisation.tenant.preferredName || payment.tenantOrganisation.tenant.legalName}</Link></dd></div><div><dt className="text-slate-500">Lease</dt><dd className="mt-1 font-medium"><Link href={`/leases/${payment.lease.id}`}>{payment.lease.referenceNumber}</Link></dd></div><div><dt className="text-slate-500">Property</dt><dd className="mt-1 font-medium">{payment.property.name}{payment.unit ? ` · ${payment.unit.name}` : ""}</dd></div><div><dt className="text-slate-500">Paid</dt><dd className="mt-1 font-medium">{date(payment.paidAt)}</dd></div><div><dt className="text-slate-500">Method/source</dt><dd className="mt-1 font-medium">{payment.method.replaceAll("_", " ")} · {payment.source}</dd></div><div><dt className="text-slate-500">External reference</dt><dd className="mt-1 font-medium">{payment.externalReference}</dd></div><div><dt className="text-slate-500">Reconciliation</dt><dd className="mt-1 font-medium">{payment.reconciliationStatus}</dd></div><div><dt className="text-slate-500">Allocated</dt><dd className="mt-1 font-medium">{money(String(allocated), payment.currencyCode)}</dd></div></dl>
      {payment.receipt && <Link className="mt-6 inline-block rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white" href={`/receipts/${payment.receipt.id}`}>View receipt {payment.receipt.receiptNumber}</Link>}
    </section>
    <section className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Rent allocations</h2>{payment.allocations.length ? <div className="mt-4 divide-y rounded-xl border">{payment.allocations.map((allocation) => <div className="flex justify-between gap-4 p-4" key={allocation.id}><div><p className="font-medium">Due {date(allocation.rentObligation.dueDate)}</p><p className="text-xs text-slate-500">{allocation.reversedAt ? `Reversed ${date(allocation.reversedAt)}` : "Active allocation"}</p></div><p className="font-semibold">{money(allocation.amountMinor, payment.currencyCode)}</p></div>)}</div> : <p className="mt-4 rounded-xl border border-dashed p-6 text-slate-500">This overpayment is currently unallocated.</p>}</div>
      <div className="rounded-2xl border bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Ledger entries</h2><div className="mt-4 divide-y rounded-xl border">{payment.ledgerEntries.map((entry) => <div className="flex justify-between gap-4 p-4" key={entry.id}><div><p className="font-medium">{entry.type.replaceAll("_", " ")}</p><p className="text-xs text-slate-500">{entry.direction} · {date(entry.effectiveAt)}</p></div><p className="font-semibold">{money(entry.amountMinor, payment.currencyCode)}</p></div>)}</div></div>
    </section>
    {payment.status === "SUCCEEDED" && <section className="rounded-2xl border border-red-200 bg-red-50 p-6"><h2 className="font-semibold text-red-900">Reverse payment</h2><p className="mt-1 text-sm text-red-700">Reversal preserves the payment, voids its receipt, reverses allocations, and appends a ledger entry.</p><form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={reverse}><input className="flex-1 rounded-lg border border-red-200 p-3" minLength={3} name="reason" placeholder="Required reversal reason" required /><button className="rounded-lg bg-red-800 px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={reversing}>{reversing ? "Reversing..." : "Reverse payment"}</button></form></section>}
    {payment.reversalReason && <p className="rounded-xl border bg-slate-50 p-4 text-sm"><strong>Reversal reason:</strong> {payment.reversalReason}</p>}
    {error && <p className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
  </div>;
}
