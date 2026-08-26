"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Request = { id: string; title: string; category: string; priority: string; status: string; createdAt: string; property: { name: string }; unit: { name: string } | null; _count: { workOrders: number; attachments: number } };

export function ScopedMaintenanceHistory({ scope, id }: { scope: "tenants" | "properties"; id: string }) {
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) {
      const timer = setTimeout(() => setError("Choose an organisation to view maintenance history."), 0);
      return () => clearTimeout(timer);
    }
    fetch(`/api/maintenance/${scope}/${id}/history`, { headers: { "x-organisation-id": organisationId } }).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error?.message ?? "Unable to load maintenance history.");
      setRequests(await response.json());
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load maintenance history."));
  }, [id, scope]);
  if (error) return <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>;
  if (!requests) return <p className="mt-4 text-sm text-slate-500">Loading maintenance history...</p>;
  return requests.length ? <div className="mt-4 grid gap-3">{requests.map((request) => <Link className="grid gap-2 rounded-xl border p-4 transition hover:border-emerald-500 sm:grid-cols-[1fr_auto]" href={`/maintenance/${request.id}`} key={request.id}><div><p className="font-semibold">{request.title}</p><p className="text-sm text-slate-600">{request.property.name}{request.unit ? ` · ${request.unit.name}` : ""} · {request.category}</p><p className="mt-1 text-xs text-slate-500">{new Intl.DateTimeFormat("en-GH", { dateStyle: "medium" }).format(new Date(request.createdAt))} · {request._count.workOrders} work orders</p></div><div className="flex items-start gap-2"><span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">{request.priority}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{request.status}</span></div></Link>)}</div> : <p className="mt-4 rounded-xl border border-dashed p-6 text-center text-slate-500">No maintenance history.</p>;
}
