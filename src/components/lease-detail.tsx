"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ScopedPaymentHistory } from "@/components/scoped-payment-history";
import { MobileMoneyCheckout } from "@/components/mobile-money-checkout";

type LeaseDetailData = {
  id: string;
  referenceNumber: string;
  status: string;
  renewalStatus: string;
  renewalWorkflowStatus: string;
  moveStatus: string;
  startDate: string;
  endDate: string | null;
  rentAmountMinor: string;
  depositAmountMinor: string | null;
  currencyCode: string;
  rentFrequency: string;
  notes: string | null;
  property: { id: string; name: string; referenceNumber: string };
  unit: { id: string; name: string } | null;
  parties: Array<{ id: string; role: string; isPrimary: boolean; tenantOrganisation: { id: string; tenant: { legalName: string; preferredName: string | null }; email: string | null } }>;
  history: Array<{ id: string; version: number; status: string; startDate: string; endDate: string | null; rentAmountMinor: string; createdAt: string }>;
  amendments: Array<{ id: string; sequence: number; summary: string; changes: Record<string, unknown>; createdAt: string }>;
  obligations: Array<{ id: string; dueDate: string; periodStart: string; periodEnd: string; amountMinor: string; collectedAmountMinor: string; collectionState: string; currencyCode: string; status: string }>;
};

type Notification = { id: string; leaseId: string | null; eventType: string; channel: string; status: string; createdAt: string; readAt: string | null };

const renewalActions: Record<string, Array<{ label: string; status: string }>> = {
  NONE: [{ label: "Request renewal", status: "REQUESTED" }],
  REQUESTED: [{ label: "Start discussion", status: "UNDER_DISCUSSION" }, { label: "Decline", status: "DECLINED" }],
  UNDER_DISCUSSION: [{ label: "Approve", status: "APPROVED" }, { label: "Decline", status: "DECLINED" }],
  APPROVED: [{ label: "Complete renewal", status: "COMPLETED" }],
  DECLINED: [{ label: "Reopen renewal", status: "REQUESTED" }],
  COMPLETED: [],
};

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-GH", { dateStyle: "medium" }).format(new Date(value)) : "Ongoing";
}

function money(value: string, currency: string) {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency }).format(Number(value) / 100);
}

export function LeaseDetail({ leaseId }: { leaseId: string }) {
  const [lease, setLease] = useState<LeaseDetailData | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState("");
  const [renewing, setRenewing] = useState(false);

  const load = useCallback(async () => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) throw new Error("Choose an organisation to view this lease.");
    const [leaseResponse, notificationResponse] = await Promise.all([
      fetch(`/api/leases/${leaseId}`, { headers: { "x-organisation-id": organisationId } }),
      fetch("/api/notifications", { headers: { "x-organisation-id": organisationId } }),
    ]);
    if (!leaseResponse.ok) throw new Error((await leaseResponse.json()).error?.message ?? "Unable to load lease.");
    setLease(await leaseResponse.json());
    if (notificationResponse.ok) {
      const history: Notification[] = await notificationResponse.json();
      setNotifications(history.filter((notification) => notification.leaseId === leaseId));
    }
  }, [leaseId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load lease."));
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function transitionRenewal(status: string) {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Choose an organisation to update this lease.");
    setRenewing(true);
    setError("");
    const response = await fetch(`/api/leases/${leaseId}/renewal`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-organisation-id": organisationId },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) setError((await response.json()).error?.message ?? "Unable to update renewal.");
    else await load();
    setRenewing(false);
  }

  if (error && !lease) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</div>;
  if (!lease) return <div className="rounded-xl border bg-white p-6 text-slate-600">Loading lease details...</div>;
  const upcoming = lease.obligations.filter(({ status }) => status === "UPCOMING" || status === "DUE");
  const overdue = lease.obligations.filter(({ status }) => status === "OVERDUE");
  const nextObligation = [...overdue, ...upcoming][0];
  const outstandingAmountMinor = nextObligation
    ? String(BigInt(nextObligation.amountMinor) - BigInt(nextObligation.collectedAmountMinor))
    : undefined;

  return <div className="grid gap-6">
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-4 sm:flex-row">
        <div><p className="text-sm font-semibold text-emerald-700">CURRENT LEASE RECORD</p><h1 className="mt-1 text-3xl font-semibold">{lease.referenceNumber}</h1><p className="mt-1 text-slate-600">{lease.property.name}{lease.unit ? ` · ${lease.unit.name}` : ""}</p></div>
        <div className="flex flex-wrap items-start gap-2"><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">{lease.status}</span><Link className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white" href={`/leases/${lease.id}/execution`}>Execution & move-in</Link><Link className="rounded-lg border px-4 py-2 text-sm font-semibold" href={`/leases/${lease.id}/move-out`}>Move-out</Link><Link className="rounded-lg border px-4 py-2 text-sm font-semibold" href="/leases">Back to leases</Link></div>
      </div>
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-slate-500">Term</dt><dd className="mt-1 font-medium">{date(lease.startDate)} – {date(lease.endDate)}</dd></div>
        <div><dt className="text-slate-500">Rent</dt><dd className="mt-1 font-medium">{money(lease.rentAmountMinor, lease.currencyCode)} · {lease.rentFrequency.toLowerCase()}</dd></div>
        <div><dt className="text-slate-500">Deposit</dt><dd className="mt-1 font-medium">{lease.depositAmountMinor ? money(lease.depositAmountMinor, lease.currencyCode) : "None"}</dd></div>
        <div><dt className="text-slate-500">Move status</dt><dd className="mt-1 font-medium">{lease.moveStatus.replaceAll("_", " ")}</dd></div>
      </dl>
      <div className="mt-6"><h2 className="font-semibold">Tenants</h2><div className="mt-2 flex flex-wrap gap-2">{lease.parties.map((party) => <Link className="rounded-lg border px-3 py-2 text-sm hover:border-emerald-500" href={`/tenants/${party.tenantOrganisation.id}`} key={party.id}>{party.tenantOrganisation.tenant.preferredName || party.tenantOrganisation.tenant.legalName}{party.isPrimary ? " · Primary" : ""}</Link>)}</div></div>
      {lease.notes && <p className="mt-6 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">{lease.notes}</p>}
    </section>

    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-xl font-semibold">Renewal</h2><p className="mt-1 text-sm text-slate-500">Workflow status: {lease.renewalWorkflowStatus.replaceAll("_", " ")}</p></div><div className="flex flex-wrap gap-2">{renewalActions[lease.renewalWorkflowStatus].map((action) => <button className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={renewing} key={action.status} onClick={() => transitionRenewal(action.status)}>{action.label}</button>)}</div></div>
      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    </section>

    <section className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Lease history</h2>{lease.history.length ? <ol className="mt-4 grid gap-3">{lease.history.map((entry, index) => <li className={`rounded-xl border p-4 ${index === 0 ? "border-emerald-400 bg-emerald-50" : ""}`} key={entry.id}><div className="flex justify-between gap-2"><p className="font-semibold">Version {entry.version}{index === 0 ? " · Current snapshot" : ""}</p><span className="text-xs font-semibold">{entry.status}</span></div><p className="mt-1 text-sm text-slate-600">{date(entry.startDate)} – {date(entry.endDate)} · {money(entry.rentAmountMinor, lease.currencyCode)}</p><p className="mt-1 text-xs text-slate-500">Recorded {date(entry.createdAt)}</p></li>)}</ol> : <p className="mt-4 text-slate-500">No historical snapshots.</p>}</div>
      <div className="rounded-2xl border bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Amendment history</h2>{lease.amendments.length ? <ol className="mt-4 grid gap-3">{lease.amendments.map((amendment) => <li className="rounded-xl border p-4" key={amendment.id}><p className="font-semibold">Amendment {amendment.sequence}: {amendment.summary}</p><p className="mt-1 text-xs text-slate-500">{date(amendment.createdAt)}</p><pre className="mt-3 overflow-x-auto rounded bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(amendment.changes, null, 2)}</pre></li>)}</ol> : <p className="mt-4 rounded-xl border border-dashed p-6 text-center text-slate-500">No amendments recorded.</p>}</div>
    </section>

    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">Rent schedule</h2>
      {!lease.obligations.length ? <p className="mt-4 rounded-xl border border-dashed p-6 text-center text-slate-500">No rent obligations have been generated.</p> : <div className="mt-4 grid gap-6 lg:grid-cols-2"><ObligationList title="Upcoming and due" items={upcoming} /><ObligationList title="Overdue" items={overdue} /></div>}
    </section>

    {lease.parties[0] && <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <MobileMoneyCheckout
        currencyCode={lease.currencyCode}
        defaultAmountMinor={outstandingAmountMinor}
        leaseId={lease.id}
        tenantOrganisationId={(lease.parties.find((party) => party.isPrimary) ?? lease.parties[0]).tenantOrganisation.id}
      />
    </section>}

    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-xl font-semibold">Payment history</h2><p className="mt-1 text-sm text-slate-500">Confirmed rent payments and receipts for this lease.</p></div><Link className="self-start rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white" href="/payments/new">Record payment</Link></div>
      <ScopedPaymentHistory scope="leases" id={lease.id} />
    </section>

    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">Reminder and notification history</h2>
      {notifications.length ? <div className="mt-4 overflow-x-auto"><table className="w-full min-w-xl text-left text-sm"><thead className="border-b text-slate-500"><tr><th className="py-3">Event</th><th>Channel</th><th>Status</th><th>Created</th><th>Read</th></tr></thead><tbody className="divide-y">{notifications.map((notification) => <tr key={notification.id}><td className="py-3 font-medium">{notification.eventType.replaceAll("_", " ")}</td><td>{notification.channel}</td><td>{notification.status}</td><td>{date(notification.createdAt)}</td><td>{notification.readAt ? date(notification.readAt) : "Unread"}</td></tr>)}</tbody></table></div> : <p className="mt-4 rounded-xl border border-dashed p-6 text-center text-slate-500">No reminders or notifications for this lease.</p>}
    </section>
  </div>;
}

function ObligationList({ title, items }: { title: string; items: LeaseDetailData["obligations"] }) {
  return <div><h3 className="font-semibold">{title} <span className="text-slate-500">({items.length})</span></h3>{items.length ? <div className="mt-3 divide-y rounded-xl border">{items.map((item) => <div className="flex items-center justify-between gap-4 p-4" key={item.id}><div><p className="font-medium">{money(item.amountMinor, item.currencyCode)}</p><p className="text-xs text-slate-500">{date(item.periodStart)} – {date(item.periodEnd)}</p><p className="mt-1 text-xs font-semibold text-emerald-700">{item.collectionState.replaceAll("_", " ")} · {money(item.collectedAmountMinor, item.currencyCode)} collected</p></div><div className="text-right"><p className="text-sm font-semibold">{item.status}</p><p className="text-xs text-slate-500">Due {date(item.dueDate)}</p></div></div>)}</div> : <p className="mt-3 rounded-xl border border-dashed p-5 text-sm text-slate-500">No {title.toLowerCase()} obligations.</p>}</div>;
}
