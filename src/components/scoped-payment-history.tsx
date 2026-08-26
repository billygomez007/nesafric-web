"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Payment = { id: string; internalReference: string; amountMinor: string; currencyCode: string; paidAt: string; status: string; method: string; receipt: { id: string; receiptNumber: string } | null };

export function ScopedPaymentHistory({ scope, id }: { scope: "leases" | "tenants"; id: string }) {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return;
    fetch(`/api/${scope}/${id}/payments`, { headers: { "x-organisation-id": organisationId } })
      .then(async (response) => response.ok ? setPayments(await response.json()) : setUnavailable(true));
  }, [id, scope]);
  if (unavailable) return <p className="mt-4 text-sm text-slate-500">Payment history is unavailable for your role.</p>;
  if (!payments) return <p className="mt-4 text-sm text-slate-500">Loading payment history...</p>;
  if (!payments.length) return <p className="mt-4 rounded-xl border border-dashed p-6 text-center text-slate-500">No rent payments recorded.</p>;
  return <div className="mt-4 divide-y rounded-xl border">{payments.map((payment) => <div className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center" key={payment.id}><div><Link className="font-semibold text-emerald-700" href={`/payments/${payment.id}`}>{payment.internalReference}</Link><p className="text-xs text-slate-500">{new Intl.DateTimeFormat("en-GH", { dateStyle: "medium" }).format(new Date(payment.paidAt))} · {payment.method.replaceAll("_", " ")} · {payment.status}</p></div><div className="text-left sm:text-right"><p className="font-semibold">{new Intl.NumberFormat("en-GH", { style: "currency", currency: payment.currencyCode }).format(Number(payment.amountMinor) / 100)}</p>{payment.receipt && <Link className="text-xs text-emerald-700" href={`/receipts/${payment.receipt.id}`}>{payment.receipt.receiptNumber}</Link>}</div></div>)}</div>;
}
