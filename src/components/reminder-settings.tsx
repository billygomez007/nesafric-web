"use client";

import { FormEvent, useEffect, useState } from "react";

const channels = ["IN_APP", "EMAIL", "SMS", "WHATSAPP"] as const;
type Channel = typeof channels[number];
type Policy = { id: string; daysOffset: number; channels: Channel[]; enabled: boolean };

function selectedChannels(form: FormData) {
  return channels.filter((channel) => form.get(channel) === "on");
}

export function ReminderSettings() {
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) throw new Error("Choose an organisation to manage reminder settings.");
    const response = await fetch("/api/reminder-policies", { headers: { "x-organisation-id": organisationId } });
    if (!response.ok) throw new Error((await response.json()).error?.message ?? "Unable to load reminder policies.");
    setPolicies(await response.json());
  }

  useEffect(() => {
    const timer = setTimeout(() => void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load reminder policies.")), 0);
    return () => clearTimeout(timer);
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Choose an organisation to manage reminder settings.");
    const form = new FormData(event.currentTarget);
    setError("");
    setSuccess("");
    const response = await fetch("/api/reminder-policies", {
      method: "POST",
      headers: { "content-type": "application/json", "x-organisation-id": organisationId },
      body: JSON.stringify({ daysOffset: form.get("daysOffset"), channels: selectedChannels(form), enabled: true }),
    });
    if (!response.ok) return setError((await response.json()).error?.message ?? "Unable to create reminder policy.");
    event.currentTarget.reset();
    setSuccess("Reminder threshold created.");
    await load();
  }

  if (error && !policies) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</div>;
  if (!policies) return <div className="rounded-xl border bg-white p-6 text-slate-600">Loading reminder settings...</div>;

  return <div className="grid gap-6">
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">New lease-expiry threshold</h2>
      <p className="mt-1 text-sm text-slate-600">Choose how many days before expiry tenants should be notified.</p>
      <form className="mt-5 grid gap-4 lg:grid-cols-[180px_1fr_auto] lg:items-end" onSubmit={create}>
        <label className="text-sm font-medium">Days before expiry<input className="mt-1 w-full rounded-lg border p-3" min="0" max="3650" name="daysOffset" required type="number" /></label>
        <fieldset><legend className="text-sm font-medium">Channels</legend><div className="mt-2 flex flex-wrap gap-3">{channels.map((channel) => <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" key={channel}><input name={channel} type="checkbox" defaultChecked={channel === "IN_APP"} />{channel.replace("_", "-")}</label>)}</div></fieldset>
        <button className="rounded-lg bg-slate-950 px-5 py-3 font-semibold text-white">Add threshold</button>
      </form>
      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {success && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}
    </section>

    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center"><div><h2 className="text-xl font-semibold">Configured policies</h2><p className="mt-1 text-sm text-slate-600">{policies.filter(({ enabled }) => enabled).length} active of {policies.length} total</p></div></div>
      {policies.length ? <div className="mt-5 grid gap-4">{policies.map((policy) => <PolicyEditor key={policy.id} policy={policy} onSaved={async () => { setSuccess("Reminder policy updated."); setError(""); await load(); }} onError={setError} />)}</div> : <p className="mt-5 rounded-xl border border-dashed p-8 text-center text-slate-500">No reminder policies yet. Add the first threshold above.</p>}
    </section>
  </div>;
}

function PolicyEditor({ policy, onSaved, onError }: { policy: Policy; onSaved: () => Promise<void>; onError: (message: string) => void }) {
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return onError("Choose an organisation to manage reminder settings.");
    const form = new FormData(event.currentTarget);
    setSaving(true);
    const response = await fetch(`/api/reminder-policies/${policy.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-organisation-id": organisationId },
      body: JSON.stringify({ daysOffset: form.get("daysOffset"), channels: selectedChannels(form), enabled: form.get("enabled") === "on" }),
    });
    if (!response.ok) onError((await response.json()).error?.message ?? "Unable to update reminder policy.");
    else await onSaved();
    setSaving(false);
  }
  return <form className="grid gap-4 rounded-xl border p-4 lg:grid-cols-[150px_1fr_auto_auto] lg:items-end" onSubmit={save}>
    <label className="text-sm font-medium">Days before expiry<input className="mt-1 w-full rounded-lg border p-2.5" defaultValue={policy.daysOffset} min="0" max="3650" name="daysOffset" required type="number" /></label>
    <fieldset><legend className="text-sm font-medium">Channels</legend><div className="mt-2 flex flex-wrap gap-2">{channels.map((channel) => <label className="flex items-center gap-2 text-sm" key={channel}><input defaultChecked={policy.channels.includes(channel)} name={channel} type="checkbox" />{channel.replace("_", "-")}</label>)}</div></fieldset>
    <label className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium"><input defaultChecked={policy.enabled} name="enabled" type="checkbox" />Active</label>
    <button className="rounded-lg border border-slate-900 px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-500" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
  </form>;
}
