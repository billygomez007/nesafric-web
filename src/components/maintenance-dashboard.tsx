"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Metrics = { total: number; open: number; byStatus: Record<string, number>; openByPriority: Record<string, number>; estimateAmountMinor: string; actualCostAmountMinor: string };
type Request = { id: string; title: string; category: string; priority: string; status: string; createdAt: string; property: { name: string }; unit: { name: string } | null; tenantOrganisation: { tenant: { legalName: string; preferredName: string | null } } | null; _count: { workOrders: number; attachments: number } };

export function MaintenanceDashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) {
      const timer = setTimeout(() => setError("Choose an organisation to view maintenance."), 0);
      return () => clearTimeout(timer);
    }
    Promise.all([
      fetch("/api/maintenance/dashboard", { headers: { "x-organisation-id": organisationId } }),
      fetch("/api/maintenance/requests", { headers: { "x-organisation-id": organisationId } }),
    ]).then(async ([metricResponse, requestResponse]) => {
      if (!metricResponse.ok || !requestResponse.ok) {
        const failed = !metricResponse.ok ? metricResponse : requestResponse;
        throw new Error((await failed.json()).error?.message ?? "Unable to load maintenance.");
      }
      setMetrics(await metricResponse.json());
      setRequests(await requestResponse.json());
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load maintenance."));
  }, []);
  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</p>;
  if (!metrics || !requests) return <p className="rounded-xl border bg-white p-6 text-slate-600">Loading maintenance dashboard...</p>;
  return <div className="grid gap-6">
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[["Open requests", metrics.open], ["Emergency", metrics.openByPriority.EMERGENCY ?? 0], ["In progress", metrics.byStatus.IN_PROGRESS ?? 0], ["Completed", metrics.byStatus.COMPLETED ?? 0]].map(([label, value]) => <div className="rounded-2xl border bg-white p-5 shadow-sm" key={label}><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>)}</section>
    <section className="rounded-2xl border bg-white p-6 shadow-sm"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-xl font-semibold">Maintenance requests</h2><p className="mt-1 text-sm text-slate-500">{metrics.total} total requests</p></div><Link className="self-start rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white" href="/maintenance/new">Report issue</Link></div>{requests.length ? <div className="mt-5 grid gap-3">{requests.map((request) => <Link className="grid gap-3 rounded-xl border p-4 transition hover:border-emerald-500 sm:grid-cols-[1fr_auto]" href={`/maintenance/${request.id}`} key={request.id}><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{request.title}</p><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{request.category}</span></div><p className="mt-1 text-sm text-slate-600">{request.property.name}{request.unit ? ` · ${request.unit.name}` : ""}{request.tenantOrganisation ? ` · ${request.tenantOrganisation.tenant.preferredName || request.tenantOrganisation.tenant.legalName}` : ""}</p><p className="mt-2 text-xs text-slate-500">{new Intl.DateTimeFormat("en-GH", { dateStyle: "medium" }).format(new Date(request.createdAt))} · {request._count.workOrders} work orders · {request._count.attachments} attachments</p></div><div className="flex items-start gap-2"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${request.priority === "EMERGENCY" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{request.priority}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{request.status}</span></div></Link>)}</div> : <p className="mt-5 rounded-xl border border-dashed p-8 text-center text-slate-500">No maintenance requests have been reported.</p>}</section>
  </div>;
}
