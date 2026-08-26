"use client";

import { type FormEvent, useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type Flag = { id: string; key: string; description: string; isEnabled: boolean; rolloutPercentage: number; emergencyDisabled: boolean; organisationOverrides: Array<{ organisationId: string; enabled: boolean }> };

function FlagsContent() {
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ key: "", description: "", rolloutPercentage: 100 });

  async function load() {
    const response = await fetch("/api/platform-admin/feature-flags");
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to load feature flags.");
    setFlags(body as Flag[]);
  }

  useEffect(() => { void load(); }, []);

  async function createFlag(event: FormEvent) {
    event.preventDefault();
    setError(""); setNotice("");
    const response = await fetch("/api/platform-admin/feature-flags", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, isEnabled: false }) });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to create flag.");
    setNotice("Flag created."); setForm({ key: "", description: "", rolloutPercentage: 100 });
    await load();
  }

  async function toggle(flag: Flag, field: "isEnabled" | "emergencyDisabled") {
    setError(""); setNotice("");
    const response = await fetch(`/api/platform-admin/feature-flags/${flag.key}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ [field]: !flag[field] }) });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to update flag.");
    await load();
  }

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>;

  return <div className="grid gap-4">
    <p className="text-sm text-slate-600">Feature flags (item 10): global on/off, percentage-cohort rollout, per-organisation override, and an emergency kill switch — entirely separate from organisation RBAC/entitlements.</p>
    {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <form className="grid gap-2 rounded-xl border bg-white p-5 shadow-sm md:grid-cols-4" onSubmit={createFlag}>
      <input className="rounded border p-2 text-sm" onChange={(event) => setForm({ ...form, key: event.target.value })} placeholder="flag.key" required value={form.key} />
      <input className="rounded border p-2 text-sm md:col-span-2" onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Description" required value={form.description} />
      <button className="rounded bg-slate-950 px-3 py-2 text-sm font-semibold text-white" type="submit">Create flag</button>
    </form>
    {!flags ? <p className="text-slate-600">Loading…</p> : <div className="grid gap-3">
      {flags.map((flag) => <div className="rounded-xl border bg-white p-4 shadow-sm" key={flag.id}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><p className="font-semibold">{flag.key}</p><p className="text-sm text-slate-600">{flag.description}</p></div>
          <div className="flex gap-2">
            <button className={`rounded border px-3 py-1.5 text-xs font-semibold ${flag.isEnabled ? "bg-emerald-50 text-emerald-800" : ""}`} onClick={() => void toggle(flag, "isEnabled")}>{flag.isEnabled ? "Enabled" : "Disabled"}</button>
            <button className={`rounded border px-3 py-1.5 text-xs font-semibold ${flag.emergencyDisabled ? "bg-red-50 text-red-800" : ""}`} onClick={() => void toggle(flag, "emergencyDisabled")}>{flag.emergencyDisabled ? "Emergency-disabled" : "Kill switch off"}</button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">Rollout: {flag.rolloutPercentage}% · {flag.organisationOverrides.length} organisation override(s)</p>
      </div>)}
    </div>}
  </div>;
}

export default function PlatformAdminFlagsPage() {
  return <PlatformAdminShell><FlagsContent /></PlatformAdminShell>;
}
