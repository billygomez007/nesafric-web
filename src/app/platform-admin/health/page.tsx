"use client";

import { useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type Health = {
  jobsByStatus: Record<string, number>;
  failedJobs: Array<{ id: string; organisationId: string | null; type: string; attempts: number; maxAttempts: number; lastError: string | null; runAt: string }>;
  notificationFailureCount: number;
  billingWebhookIncidents: Array<{ id: string; providerKey: string; eventType: string; status: string; failureReason: string | null; receivedAt: string }>;
};

function HealthContent() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/platform-admin/health").then(async (response) => { const body = await response.json(); if (response.ok) setHealth(body); else setError(body.error?.message ?? "Unable to load health."); });
  }, []);

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>;
  if (!health) return <p className="text-slate-600">Loading…</p>;

  return <div className="grid gap-6">
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Background jobs</h2>
      <dl className="mt-3 grid grid-cols-2 gap-1 text-sm md:grid-cols-4">{Object.entries(health.jobsByStatus).map(([status, count]) => <div key={status}><dt className="inline font-semibold">{status}:</dt> <dd className="inline"> {count}</dd></div>)}</dl>
    </section>
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Recent failed jobs</h2>
      {health.failedJobs.length ? <ul className="mt-3 grid gap-1 text-sm">{health.failedJobs.map((job) => <li key={job.id}>{job.type} ({job.attempts}/{job.maxAttempts} attempts) — {job.lastError ?? "no error recorded"}</li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No failed jobs.</p>}
    </section>
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Notifications</h2>
      <p className="mt-2 text-sm">{health.notificationFailureCount} failed deliveries.</p>
    </section>
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Billing webhook incidents</h2>
      {health.billingWebhookIncidents.length ? <ul className="mt-3 grid gap-1 text-sm">{health.billingWebhookIncidents.map((incident) => <li key={incident.id}>{incident.providerKey} — {incident.eventType} — {incident.status}{incident.failureReason ? `: ${incident.failureReason}` : ""}</li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No incidents.</p>}
    </section>
  </div>;
}

export default function PlatformAdminHealthPage() {
  return <PlatformAdminShell><HealthContent /></PlatformAdminShell>;
}
