"use client";

import { useEffect, useState } from "react";

type ReconciliationEvent = {
  id: string;
  providerKey: string;
  eventKey: string;
  transactionRef: string | null;
  status: "UNMATCHED" | "PENDING" | "MATCHED" | "MISMATCHED" | "DUPLICATE";
  receivedAt: string;
  processedAt: string | null;
  payment: { id: string; internalReference: string; amountMinor: string; currencyCode: string; status: string } | null;
};

const statusStyle: Record<ReconciliationEvent["status"], string> = {
  MATCHED: "bg-emerald-100 text-emerald-800",
  UNMATCHED: "bg-amber-100 text-amber-800",
  MISMATCHED: "bg-red-100 text-red-800",
  DUPLICATE: "bg-slate-100 text-slate-700",
  PENDING: "bg-slate-100 text-slate-700",
};

const tabs = ["ALL", "MATCHED", "MISMATCHED", "UNMATCHED", "DUPLICATE"] as const;

/**
 * Manager financial view over every provider webhook event this organisation has received,
 * including the ones that never produced a payment (mismatched amounts, unmatched provider
 * references, or replayed duplicates) so nothing silently disappears from reconciliation.
 */
export function ReconciliationDashboard() {
  const [events, setEvents] = useState<ReconciliationEvent[] | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<(typeof tabs)[number]>("ALL");

  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) {
      const timer = setTimeout(() => setError("Choose an organisation to view reconciliation."), 0);
      return () => clearTimeout(timer);
    }
    const query = tab === "ALL" ? "" : `?status=${tab}`;
    fetch(`/api/payments/reconciliation${query}`, { headers: { "x-organisation-id": organisationId } })
      .then(async (response) => {
        if (!response.ok) return setError((await response.json()).error?.message ?? "Unable to load reconciliation events.");
        setEvents(await response.json());
      });
  }, [tab]);

  return <section className="rounded-2xl border bg-white p-6 shadow-sm">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div><h2 className="text-xl font-semibold">Provider reconciliation</h2><p className="mt-1 text-sm text-slate-500">Every mobile money / card / bank webhook event received, matched or not.</p></div>
      <div className="flex flex-wrap gap-2">{tabs.map((value) => <button className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${tab === value ? "bg-slate-950 text-white" : "border"}`} key={value} onClick={() => setTab(value)}>{value}</button>)}</div>
    </div>
    {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {!error && !events && <p className="mt-4 text-sm text-slate-500">Loading reconciliation events...</p>}
    {events && !events.length && <p className="mt-4 rounded-xl border border-dashed p-8 text-center text-slate-500">No reconciliation events for this filter.</p>}
    {events && events.length > 0 && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-3xl text-left text-sm"><thead className="border-b text-slate-500"><tr><th className="py-3">Provider</th><th>Transaction ref</th><th>Status</th><th>Payment</th><th>Received</th></tr></thead><tbody className="divide-y">{events.map((event) => <tr key={event.id}>
      <td className="py-3 font-medium">{event.providerKey}</td>
      <td className="text-xs text-slate-500">{event.transactionRef ?? "—"}</td>
      <td><span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusStyle[event.status]}`}>{event.status}</span></td>
      <td>{event.payment ? <span>{event.payment.internalReference} · {new Intl.NumberFormat("en-GH", { style: "currency", currency: event.payment.currencyCode }).format(Number(event.payment.amountMinor) / 100)}</span> : "—"}</td>
      <td>{new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.receivedAt))}</td>
    </tr>)}</tbody></table></div>}
  </section>;
}
