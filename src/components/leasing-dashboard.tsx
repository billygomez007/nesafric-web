"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Lead = { id: string; name: string; email: string | null; phone: string | null; status: string; lastActivityAt: string; listing: { title: string }; assignee: { user: { displayName: string } } | null };
type Application = { id: string; status: string; lastActivityAt: string; applicant: { legalName: string }; listing: { title: string }; assignee: { user: { displayName: string } } | null };
type Viewing = { id: string; status: string; confirmedStartsAt: string | null; preferredTimes: { startsAt: string; endsAt: string }[]; listing: { title: string }; lead: { name: string }; assignee: { user: { displayName: string } } | null };
type Dashboard = { counts: { leads: Record<string, number>; viewings: Record<string, number>; applications: Record<string, number> }; recentLeads: Lead[]; recentApplications: Application[] };

export function LeasingDashboard() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [viewings, setViewings] = useState<Viewing[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) throw new Error("Choose an organisation to open the leasing CRM.");
    const headers = { "x-organisation-id": organisationId };
    const [dashboardResponse, viewingResponse] = await Promise.all([fetch("/api/crm/dashboard", { headers }), fetch("/api/viewing-requests?pageSize=100", { headers })]);
    if (!dashboardResponse.ok) throw new Error((await dashboardResponse.json()).error?.message ?? "Unable to load leasing CRM.");
    setDashboard(await dashboardResponse.json());
    if (viewingResponse.ok) setViewings((await viewingResponse.json()).items);
  }, []);
  useEffect(() => { const timer = setTimeout(() => void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load leasing CRM.")), 0); return () => clearTimeout(timer); }, [load]);
  if (error) return <p className="rounded-xl bg-red-50 p-6 text-red-800">{error}</p>;
  if (!dashboard) return <p className="rounded-xl border bg-white p-6 text-slate-500">Loading leasing pipeline...</p>;
  const total = (values: Record<string, number>) => Object.values(values).reduce((sum, value) => sum + value, 0);
  return <div className="grid gap-6"><section className="grid gap-4 sm:grid-cols-3"><Metric label="Active prospects" value={total(dashboard.counts.leads) - (dashboard.counts.leads.CLOSED ?? 0) - (dashboard.counts.leads.LOST ?? 0)} /><Metric label="Upcoming viewings" value={(dashboard.counts.viewings.REQUESTED ?? 0) + (dashboard.counts.viewings.CONFIRMED ?? 0) + (dashboard.counts.viewings.RESCHEDULED ?? 0)} /><Metric label="Applications in review" value={(dashboard.counts.applications.SUBMITTED ?? 0) + (dashboard.counts.applications.UNDER_REVIEW ?? 0) + (dashboard.counts.applications.MORE_INFORMATION_REQUIRED ?? 0)} /></section><section className="grid gap-6 xl:grid-cols-2"><Pipeline title="Prospect pipeline" counts={dashboard.counts.leads} /><Pipeline title="Application pipeline" counts={dashboard.counts.applications} /></section><section className="grid gap-6 xl:grid-cols-2"><Panel title="Recent prospects">{dashboard.recentLeads.length ? dashboard.recentLeads.map((lead) => <Link className="block rounded-xl border p-4 hover:border-emerald-500" href={`/leasing/leads/${lead.id}`} key={lead.id}><div className="flex justify-between gap-3"><div><p className="font-semibold">{lead.name}</p><p className="text-sm text-slate-500">{lead.listing.title} · {lead.email || lead.phone}</p></div><Badge value={lead.status} /></div><p className="mt-2 text-xs text-slate-500">{lead.assignee?.user.displayName ?? "Unassigned"} · {date(lead.lastActivityAt)}</p></Link>) : <Empty text="No marketplace prospects." />}</Panel><Panel title="Recent applications">{dashboard.recentApplications.length ? dashboard.recentApplications.map((application) => <Link className="block rounded-xl border p-4 hover:border-emerald-500" href={`/leasing/applications/${application.id}`} key={application.id}><div className="flex justify-between gap-3"><div><p className="font-semibold">{application.applicant.legalName}</p><p className="text-sm text-slate-500">{application.listing.title}</p></div><Badge value={application.status} /></div><p className="mt-2 text-xs text-slate-500">{application.assignee?.user.displayName ?? "Unassigned"} · {date(application.lastActivityAt)}</p></Link>) : <Empty text="No rental applications." />}</Panel></section><Panel title="Viewing schedule">{viewings.length ? <div className="grid gap-3 md:grid-cols-2">{viewings.map((viewing) => <Link className="rounded-xl border p-4 hover:border-emerald-500" href={`/leasing/viewings/${viewing.id}`} key={viewing.id}><div className="flex justify-between gap-3"><p className="font-semibold">{viewing.lead.name}</p><Badge value={viewing.status} /></div><p className="mt-1 text-sm text-slate-500">{viewing.listing.title}</p><p className="mt-3 text-sm">{viewing.confirmedStartsAt ? dateTime(viewing.confirmedStartsAt) : viewing.preferredTimes[0] ? `Preferred ${dateTime(viewing.preferredTimes[0].startsAt)}` : "Time not selected"}</p><p className="mt-1 text-xs text-slate-500">{viewing.assignee?.user.displayName ?? "Unassigned"}</p></Link>)}</div> : <Empty text="No viewing requests." />}</Panel></div>;
}
function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>; }
function Pipeline({ title, counts }: { title: string; counts: Record<string, number> }) { return <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">{title}</h2><div className="mt-4 flex flex-wrap gap-2">{Object.entries(counts).map(([status, count]) => <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold" key={status}>{status.replaceAll("_", " ")} · {count}</span>)}</div></section>; }
function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="text-xl font-semibold">{title}</h2><div className="mt-4 grid gap-3">{children}</div></section>; }
function Badge({ value }: { value: string }) { return <span className="self-start rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">{value.replaceAll("_", " ")}</span>; }
function Empty({ text }: { text: string }) { return <p className="rounded-xl border border-dashed p-8 text-center text-slate-500">{text}</p>; }
function date(value: string) { return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value)); }
function dateTime(value: string) { return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
