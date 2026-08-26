"use client";

import { useCallback, useEffect, useState } from "react";

type IntegrationEntry = {
  type: string;
  provider: string;
  displayName: string;
  enabled: boolean;
  status: "NOT_CONFIGURED" | "CONNECTED" | "DEGRADED" | "ERROR";
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
};

const STATUS_STYLES: Record<IntegrationEntry["status"], string> = {
  CONNECTED: "bg-emerald-100 text-emerald-800",
  NOT_CONFIGURED: "bg-slate-100 text-slate-600",
  DEGRADED: "bg-amber-100 text-amber-800",
  ERROR: "bg-red-100 text-red-800",
};

const PHASE19_TYPES = new Set(["STORAGE", "ESIGNATURE", "GEOCODING", "CALENDAR", "MALWARE_SCAN"]);

/** Organisation integration settings (item 7 + item 8): connected/not configured/degraded/error, never a secret. */
export function IntegrationSettings() {
  const [organisationId, setOrganisationId] = useState("");
  const [entries, setEntries] = useState<IntegrationEntry[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (orgId: string) => {
    const response = await fetch(`/api/organisations/${orgId}/integrations`, { headers: { "x-organisation-id": orgId } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "Unable to load integration status.");
    setEntries(body as IntegrationEntry[]);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const orgId = localStorage.getItem("propertyos.activeOrganisationId") ?? "";
      setOrganisationId(orgId);
      if (!orgId) return setError("Choose an organisation.");
      void load(orgId).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load integration status."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function toggle(entry: IntegrationEntry) {
    if (!PHASE19_TYPES.has(entry.type)) return; // communication/payment readiness is read-only here; configured via their own settings.
    setError(""); setNotice("");
    const response = await fetch(`/api/organisations/${organisationId}/integrations/${entry.type}`, {
      method: "PUT",
      headers: { "x-organisation-id": organisationId, "content-type": "application/json" },
      body: JSON.stringify({ enabled: !entry.enabled }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to update integration.");
    setNotice(`${entry.displayName} ${!entry.enabled ? "enabled" : "disabled"}.`);
    await load(organisationId);
  }

  if (!entries) return <p className="rounded-xl border bg-white p-6">{error || "Loading integration status..."}</p>;
  return <div className="grid gap-6">
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold">Integrations</h1>
      <p className="mt-1 text-sm text-slate-600">Storage, e-signature, geocoding, calendar sync, malware scanning, communication channels, and payment providers — connection health without ever exposing a secret or credential.</p>
    </section>
    {(error || notice) && <p className={`rounded-lg p-3 text-sm ${error ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{error || notice}</p>}
    <section className="grid gap-4 md:grid-cols-2">
      {entries.map((entry) => <div className="rounded-2xl border bg-white p-5 shadow-sm" key={entry.type}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">{entry.displayName}</h2>
            <p className="text-xs text-slate-500">{entry.provider}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[entry.status]}`}>{entry.status.replaceAll("_", " ")}</span>
        </div>
        <dl className="mt-3 grid gap-1 text-xs text-slate-500">
          {entry.lastSuccessAt && <div><dt className="inline font-semibold">Last success:</dt> <dd className="inline">{new Date(entry.lastSuccessAt).toLocaleString()}</dd></div>}
          {entry.lastFailureAt && <div><dt className="inline font-semibold">Last failure:</dt> <dd className="inline">{new Date(entry.lastFailureAt).toLocaleString()}{entry.lastFailureReason ? ` — ${entry.lastFailureReason}` : ""}</dd></div>}
        </dl>
        {PHASE19_TYPES.has(entry.type) && <button className="mt-3 rounded-lg border px-4 py-2 text-sm font-semibold" onClick={() => void toggle(entry)}>{entry.enabled ? "Disable" : "Enable"}</button>}
      </div>)}
    </section>
  </div>;
}
