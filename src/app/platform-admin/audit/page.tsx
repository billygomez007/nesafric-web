"use client";

import { useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type AuditEntry = { id: string; action: string; entityType: string; entityId: string; organisationId: string | null; createdAt: string; metadata: unknown };

function AuditContent() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/platform-admin/audit").then(async (response) => { const body = await response.json(); if (response.ok) setEntries(body); else setError(body.error?.message ?? "Unable to load the platform audit log."); });
  }, []);

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>;
  if (!entries) return <p className="text-slate-600">Loading…</p>;

  return <section className="rounded-xl border bg-white p-5 shadow-sm">
    <h2 className="font-semibold">Platform audit log</h2>
    <p className="mt-1 text-sm text-slate-600">Every platform-principal action — organisation views, plan/entitlement/flag changes, support sessions — fully separate from any organisation&apos;s own audit history.</p>
    {entries.length ? <ul className="mt-3 divide-y text-sm">{entries.map((entry) => <li className="py-2" key={entry.id}>{new Date(entry.createdAt).toLocaleString()} — <span className="font-semibold">{entry.action}</span> ({entry.entityType}:{entry.entityId}){entry.organisationId ? ` — org ${entry.organisationId}` : ""}</li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No platform audit events yet.</p>}
  </section>;
}

export default function PlatformAdminAuditPage() {
  return <PlatformAdminShell><AuditContent /></PlatformAdminShell>;
}
