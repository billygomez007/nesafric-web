"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type Analytics = {
  totalOrganisations: number;
  recentSignups30d: number;
  statusCounts: Record<string, number>;
  planCounts: Array<{ planKey: string; planName: string; count: number }>;
  mrrByCurrency: Record<string, string>;
  arrByCurrency: Record<string, string>;
  trialsStarted: number;
  trialsConverted: number;
  cancellations30d: number;
};
type Health = { jobsByStatus: Record<string, number>; notificationFailureCount: number; billingWebhookIncidents: unknown[]; failedJobs: unknown[] };

function money(amountMinor: string, currency: string) {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency }).format(Number(amountMinor) / 100);
}

function OverviewContent() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/platform-admin/analytics").then(async (response) => { const body = await response.json(); if (response.ok) setAnalytics(body); else setError(body.error?.message ?? "Unable to load analytics."); });
    fetch("/api/platform-admin/health").then(async (response) => { if (response.ok) setHealth(await response.json()); });
  }, []);

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>;
  if (!analytics) return <p className="text-slate-600">Loading commercial analytics…</p>;

  const currencies = [...new Set([...Object.keys(analytics.mrrByCurrency), ...Object.keys(analytics.arrByCurrency)])];

  return <div className="grid gap-6">
    <section className="grid gap-4 md:grid-cols-4">
      <div className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Organisations</p><p className="mt-2 text-3xl font-semibold">{analytics.totalOrganisations}</p></div>
      <div className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">New (30d)</p><p className="mt-2 text-3xl font-semibold">{analytics.recentSignups30d}</p></div>
      <div className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Trial → active</p><p className="mt-2 text-3xl font-semibold">{analytics.trialsConverted} / {analytics.trialsStarted}</p></div>
      <div className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Cancellations (30d)</p><p className="mt-2 text-3xl font-semibold">{analytics.cancellations30d}</p></div>
    </section>
    <section className="grid gap-4 md:grid-cols-2">
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Recurring revenue</h2>
        {currencies.length ? <dl className="mt-3 grid gap-1 text-sm">{currencies.map((currency) => <div key={currency}><dt className="inline font-semibold">{currency}:</dt> <dd className="inline">MRR {money(analytics.mrrByCurrency[currency] ?? "0", currency)} · ARR {money(analytics.arrByCurrency[currency] ?? "0", currency)}</dd></div>)}</dl> : <p className="mt-2 text-sm text-slate-600">No paying subscriptions yet.</p>}
      </div>
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Subscriptions by status</h2>
        <dl className="mt-3 grid grid-cols-2 gap-1 text-sm">{Object.entries(analytics.statusCounts).map(([status, count]) => <div key={status}><dt className="inline font-semibold">{status}:</dt> <dd className="inline"> {count}</dd></div>)}</dl>
      </div>
    </section>
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Plan distribution</h2>
      <dl className="mt-3 grid gap-1 text-sm md:grid-cols-3">{analytics.planCounts.map((entry) => <div key={entry.planKey}><dt className="inline font-semibold">{entry.planName}:</dt> <dd className="inline"> {entry.count}</dd></div>)}</dl>
    </section>
    {health && <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Platform health</h2>
      <dl className="mt-3 grid gap-1 text-sm md:grid-cols-3">
        {Object.entries(health.jobsByStatus).map(([status, count]) => <div key={status}><dt className="inline font-semibold">Jobs {status}:</dt> <dd className="inline"> {count}</dd></div>)}
        <div><dt className="inline font-semibold">Notification failures:</dt> <dd className="inline"> {health.notificationFailureCount}</dd></div>
        <div><dt className="inline font-semibold">Billing webhook incidents:</dt> <dd className="inline"> {health.billingWebhookIncidents.length}</dd></div>
      </dl>
      <Link className="mt-3 inline-block text-sm font-semibold text-emerald-700" href="/platform-admin/health">View details →</Link>
    </section>}
  </div>;
}

export default function PlatformAdminOverviewPage() {
  return <PlatformAdminShell><OverviewContent /></PlatformAdminShell>;
}
