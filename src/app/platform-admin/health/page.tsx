"use client";

import { useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type Health = {
  jobsByStatus: Record<string, number>;
  failedJobs: Array<{ id: string; organisationId: string | null; type: string; attempts: number; maxAttempts: number; lastError: string | null; runAt: string }>;
  notificationFailureCount: number;
  billingWebhookIncidents: Array<{ id: string; providerKey: string; eventType: string; status: string; failureReason: string | null; receivedAt: string }>;
  recentAccountEmailJobs: Array<{ id: string; type: string; status: string; attempts: number; maxAttempts: number; lastError: string | null; idempotencyKey: string; createdAt: string; completedAt: string | null; payload: { template?: string } }>;
  email: { provider: "RESEND" | "TEST"; configured: boolean; recentFailureCount: number };
};

function HealthContent() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draining, setDraining] = useState(false);

  function load() {
    fetch("/api/platform-admin/health").then(async (response) => { const body = await response.json(); if (response.ok) setHealth(body); else setError(body.error?.message ?? "Unable to load health."); });
  }

  useEffect(load, []);

  async function drainNow() {
    setDraining(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/platform-admin/jobs/run", { method: "POST" });
      const body = await response.json();
      if (!response.ok) return setError(body.error?.message ?? "Unable to run due jobs.");
      setNotice(`Drained ${body.claimed} due job(s): ${body.succeeded} succeeded, ${body.failed} failed.`);
      load();
    } finally {
      setDraining(false);
    }
  }

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>;
  if (!health) return <p className="text-slate-600">Loading…</p>;

  return <div className="grid gap-6">
    {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Background jobs</h2>
        <button className="rounded-lg bg-navy px-3.5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={draining} onClick={() => void drainNow()} type="button">
          {draining ? "Running…" : "Run due jobs now"}
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">Normally an external scheduler drains this queue automatically. Use this if that scheduler is unavailable.</p>
      <dl className="mt-3 grid grid-cols-2 gap-1 text-sm md:grid-cols-4">{Object.entries(health.jobsByStatus).map(([status, count]) => <div key={status}><dt className="inline font-semibold">{status}:</dt> <dd className="inline"> {count}</dd></div>)}</dl>
    </section>
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Email</h2>
      <dl className="mt-3 grid gap-1 text-sm">
        <div><dt className="inline font-semibold">Provider:</dt> <dd className="inline"> {health.email.provider}</dd></div>
        <div><dt className="inline font-semibold">Configuration:</dt> <dd className="inline"> {health.email.configured ? "CONFIGURED" : "TEST_MODE (no external send occurs)"}</dd></div>
        <div><dt className="inline font-semibold">Recent email job failures:</dt> <dd className="inline"> {health.email.recentFailureCount}</dd></div>
      </dl>
    </section>
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Recent account emails (welcome, onboarding, verification, notifications)</h2>
      {health.recentAccountEmailJobs.length ? <ul className="mt-3 grid gap-1 text-sm">{health.recentAccountEmailJobs.map((job) => (
        <li key={job.id}>
          <span className="font-semibold">{job.payload.template ?? job.type}</span> — {job.status} ({job.attempts}/{job.maxAttempts} attempts){job.lastError ? ` — ${job.lastError}` : ""}
          <span className="ml-1 text-xs text-slate-500">id={job.id} · key={job.idempotencyKey}</span>
        </li>
      ))}</ul> : <p className="mt-2 text-sm text-slate-600">No account emails yet.</p>}
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
