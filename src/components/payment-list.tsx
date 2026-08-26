"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Payment = {
  id: string;
  internalReference: string;
  amountMinor: string;
  currencyCode: string;
  method: string;
  source: string;
  status: string;
  paidAt: string;
  tenantOrganisation: { tenant: { legalName: string; preferredName: string | null } };
  lease: { referenceNumber: string };
  property: { name: string };
};

type Metrics = {
  currencyCode: string | null;
  chargedAmountMinor: string;
  collectedAmountMinor: string;
  outstandingAmountMinor: string;
  obligations: { total: number; unpaid: number; partiallyPaid: number; fullyPaid: number };
};

function money(value: string, currency: string | null) {
  if (!currency) return "—";
  return new Intl.NumberFormat("en-GH", { style: "currency", currency }).format(Number(value) / 100);
}

function date(value: string) {
  return new Intl.DateTimeFormat("en-GH", { dateStyle: "medium" }).format(new Date(value));
}

export function PaymentList() {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) {
      const timer = setTimeout(() => setError("Choose an organisation to view payments."), 0);
      return () => clearTimeout(timer);
    }
    Promise.all([
      fetch("/api/payments", { headers: { "x-organisation-id": organisationId } }),
      fetch("/api/rent-collection/metrics", { headers: { "x-organisation-id": organisationId } }),
    ]).then(async ([paymentResponse, metricResponse]) => {
      if (!paymentResponse.ok || !metricResponse.ok) {
        const failed = !paymentResponse.ok ? paymentResponse : metricResponse;
        throw new Error((await failed.json()).error?.message ?? "Unable to load rent collection.");
      }
      setPayments(await paymentResponse.json());
      setMetrics(await metricResponse.json());
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load rent collection."));
  }, []);

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</p>;
  if (!payments || !metrics) return <p className="rounded-xl border bg-white p-6 text-slate-600">Loading payments and collection metrics...</p>;

  return <div className="grid gap-6">
    <section className="grid gap-4 sm:grid-cols-3">
      {[["Expected rent", metrics.chargedAmountMinor], ["Collected rent", metrics.collectedAmountMinor], ["Outstanding rent", metrics.outstandingAmountMinor]].map(([label, value]) => <div className="rounded-2xl border bg-white p-5 shadow-sm" key={label}><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold">{money(value, metrics.currencyCode)}</p></div>)}
    </section>
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-xl font-semibold">Payment history</h2><p className="mt-1 text-sm text-slate-500">{payments.length} recorded payments</p></div><div className="flex gap-2"><Link className="rounded-lg border px-4 py-2 text-sm font-semibold" href="/deposits">Deposits</Link><Link className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white" href="/payments/new">Record payment</Link></div></div>
      {payments.length ? <div className="mt-5 overflow-x-auto"><table className="w-full min-w-3xl text-left text-sm"><thead className="border-b text-slate-500"><tr><th className="py-3">Reference</th><th>Tenant / lease</th><th>Method</th><th>Status</th><th>Date</th><th className="text-right">Amount</th></tr></thead><tbody className="divide-y">{payments.map((payment) => <tr key={payment.id}><td className="py-4"><Link className="font-semibold text-emerald-700" href={`/payments/${payment.id}`}>{payment.internalReference}</Link><p className="text-xs text-slate-500">{payment.source.toLowerCase()}</p></td><td>{payment.tenantOrganisation.tenant.preferredName || payment.tenantOrganisation.tenant.legalName}<p className="text-xs text-slate-500">{payment.lease.referenceNumber} · {payment.property.name}</p></td><td>{payment.method.replaceAll("_", " ")}</td><td><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{payment.status}</span></td><td>{date(payment.paidAt)}</td><td className="text-right font-semibold">{money(payment.amountMinor, payment.currencyCode)}</td></tr>)}</tbody></table></div> : <p className="mt-5 rounded-xl border border-dashed p-8 text-center text-slate-500">No payments have been recorded.</p>}
    </section>
  </div>;
}
