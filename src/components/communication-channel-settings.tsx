"use client";

import { useCallback, useEffect, useState } from "react";

type ChannelConfig = { id?: string; channel: string; enabled: boolean; providerKey: string | null; fromAddress: string | null };
const ALL_CHANNELS = ["EMAIL", "WHATSAPP", "SMS", "WEB_CHAT", "IN_APP"];
const headers = (organisationId: string, json = false) => ({ "x-organisation-id": organisationId, ...(json ? { "content-type": "application/json" } : {}) });

export function CommunicationChannelSettings() {
  const [organisationId, setOrganisationId] = useState("");
  const [configs, setConfigs] = useState<ChannelConfig[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (orgId: string) => {
    const response = await fetch(`/api/organisations/${orgId}/communication-channels`, { headers: headers(orgId) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "Unable to load channel settings.");
    const byChannel = new Map<string, ChannelConfig>((body as ChannelConfig[]).map((config) => [config.channel, config]));
    setConfigs(ALL_CHANNELS.map((channel) => byChannel.get(channel) ?? { channel, enabled: false, providerKey: null, fromAddress: null }));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const orgId = localStorage.getItem("propertyos.activeOrganisationId") ?? "";
      setOrganisationId(orgId);
      if (!orgId) return setError("Choose an organisation.");
      void load(orgId).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load channel settings."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(config: ChannelConfig, fromAddress: string, enabled: boolean) {
    setError(""); setNotice("");
    const response = await fetch(`/api/organisations/${organisationId}/communication-channels/${config.channel}`, {
      method: "PUT",
      headers: headers(organisationId, true),
      body: JSON.stringify({ enabled, fromAddress: fromAddress || undefined, config: {} }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to save channel settings.");
    setNotice(`${config.channel.replaceAll("_", " ")} settings saved.`);
    await load(organisationId);
  }

  if (!configs) return <p className="rounded-xl border bg-white p-6">{error || "Loading communication settings..."}</p>;
  return <div className="grid gap-6">
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold">Communication channels</h1>
      <p className="mt-1 text-sm text-slate-600">Enable or disable each channel for outbound conversation delivery. Disabled channels never send messages, even if the AI receptionist drafts a reply.</p>
    </section>
    {(error || notice) && <p className={`rounded-lg p-3 text-sm ${error ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{error || notice}</p>}
    <section className="grid gap-4 md:grid-cols-2">
      {configs.map((config) => <ChannelCard config={config} key={config.channel} onSave={save} />)}
    </section>
  </div>;
}

function ChannelCard({ config, onSave }: { config: ChannelConfig; onSave: (config: ChannelConfig, fromAddress: string, enabled: boolean) => void }) {
  const [fromAddress, setFromAddress] = useState(config.fromAddress ?? "");
  const [enabled, setEnabled] = useState(config.enabled);
  return <div className="rounded-2xl border bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between"><h2 className="font-semibold">{config.channel.replaceAll("_", " ")}</h2><label className="flex items-center gap-2 text-sm"><input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />Enabled</label></div>
    <input className="mt-3 w-full rounded-lg border p-3 text-sm" onChange={(event) => setFromAddress(event.target.value)} placeholder="From address / number" value={fromAddress} />
    <button className="mt-3 rounded-lg border px-4 py-2 text-sm font-semibold" onClick={() => onSave(config, fromAddress, enabled)}>Save</button>
  </div>;
}
