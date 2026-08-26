"use client";

import { useCallback, useEffect, useState } from "react";

type Detail = {
  organisation: { id: string; name: string; type: string; countryCode: string; defaultCurrencyCode: string; subscription: { id: string; status: string; billingCycle: string; currencyCode: string; trialEndsAt: string | null; currentPeriodEnd: string; cancelAtPeriodEnd: boolean; billingCustomerRef: string | null; billingSubscriptionRef: string | null; billingProviderKey: string; plan: { key: string; name: string } } | null; _count: { members: number; properties: number } };
  invoices: Array<{ id: string; periodStart: string; periodEnd: string; amountMinor: string; currencyCode: string; status: string }>;
  overrides: Array<{ id: string; featureKey: string; kind: string; booleanValue: boolean | null; limitValue: string | null; isUnlimited: boolean; reason: string; expiresAt: string | null; revokedAt: string | null }>;
  statusHistory: Array<{ id: string; fromStatus: string | null; toStatus: string; reason: string; createdAt: string }>;
  supportSessions: Array<{ id: string; reason: string; startedAt: string; expiresAt: string; endedAt: string | null; revokedAt: string | null }>;
  entitlements: { features: Array<{ featureKey: string; label: string; kind: string; booleanValue: boolean | null; limit: number | null; isUnlimited: boolean; current: number | null; reached: boolean; source: string }> };
};

export function PlatformAdminOrganisationDetail({ organisationId }: { organisationId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [needsSupportSession, setNeedsSupportSession] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/platform-admin/organisations/${organisationId}`);
    const body = await response.json();
    if (response.status === 403 && body.error?.code === "SUPPORT_SESSION_REQUIRED") { setNeedsSupportSession(true); return; }
    if (!response.ok) return setError(body.error?.message ?? "Unable to load organisation.");
    setNeedsSupportSession(false);
    setDetail(body as Detail);
  }, [organisationId]);

  useEffect(() => { void load(); }, [load]);

  async function startSupportSession() {
    setError("");
    const response = await fetch(`/api/platform-admin/organisations/${organisationId}/support-sessions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason, durationMinutes: 60 }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to start a support session.");
    await load();
  }

  async function action(path: string, payload: Record<string, unknown>) {
    setError(""); setNotice("");
    const response = await fetch(`/api/platform-admin/organisations/${organisationId}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Action failed.");
    setNotice("Done.");
    await load();
  }

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>;
  if (needsSupportSession) return <div className="rounded-xl border bg-white p-5 shadow-sm">
    <h2 className="font-semibold">Support session required</h2>
    <p className="mt-1 text-sm text-slate-600">Viewing this organisation&apos;s details requires an active, reasoned, time-bound support session. The organisation can see this access in its own billing settings.</p>
    <textarea className="mt-3 w-full rounded border p-2 text-sm" onChange={(event) => setReason(event.target.value)} placeholder="Reason for accessing this organisation's data" value={reason} />
    <button className="mt-2 rounded bg-slate-950 px-4 py-2 text-sm font-semibold text-white" disabled={!reason.trim()} onClick={() => void startSupportSession()}>Start 60-minute support session</button>
  </div>;
  if (!detail) return <p className="text-slate-600">Loading…</p>;

  const subscription = detail.organisation.subscription;

  return <div className="grid gap-6">
    {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h1 className="text-xl font-semibold">{detail.organisation.name}</h1>
      <p className="text-sm text-slate-500">{detail.organisation.countryCode} · {detail.organisation.type} · {detail.organisation._count.members} members · {detail.organisation._count.properties} properties</p>
      {subscription && <dl className="mt-3 grid gap-1 text-sm md:grid-cols-2">
        <div><dt className="inline font-semibold">Plan:</dt> <dd className="inline"> {subscription.plan.name} ({subscription.billingCycle})</dd></div>
        <div><dt className="inline font-semibold">Status:</dt> <dd className="inline"> {subscription.status}</dd></div>
        <div><dt className="inline font-semibold">Billing provider:</dt> <dd className="inline"> {subscription.billingProviderKey}</dd></div>
        <div><dt className="inline font-semibold">Current period ends:</dt> <dd className="inline"> {new Date(subscription.currentPeriodEnd).toLocaleDateString()}</dd></div>
      </dl>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="rounded border px-3 py-1.5 text-sm font-semibold" onClick={() => void action("/suspend", { reason: "Suspended by platform operator" })}>Suspend</button>
        <button className="rounded border px-3 py-1.5 text-sm font-semibold" onClick={() => void action("/resume", { reason: "Resumed by platform operator" })}>Resume</button>
        <button className="rounded border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700" onClick={() => void action("/cancel", { reason: "Cancelled by platform operator" })}>Cancel</button>
      </div>
    </section>

    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Entitlements &amp; usage</h2>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {detail.entitlements.features.map((feature) => <div className="rounded border p-3 text-sm" key={feature.featureKey}>
          <p className="font-semibold">{feature.label} <span className="ml-1 text-xs font-normal text-slate-500">({feature.source})</span></p>
          {feature.kind === "BOOLEAN" ? <p>{feature.booleanValue ? "Enabled" : "Disabled"}</p> : <p>{feature.current ?? 0} / {feature.isUnlimited ? "Unlimited" : feature.limit}{feature.reached ? " — reached" : ""}</p>}
        </div>)}
      </div>
    </section>

    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Entitlement overrides</h2>
      {detail.overrides.length ? <ul className="mt-3 grid gap-2 text-sm">{detail.overrides.map((override) => <li className="rounded border p-2" key={override.id}>
        <span className="font-semibold">{override.featureKey}</span> — {override.isUnlimited ? "unlimited" : override.kind === "BOOLEAN" ? String(override.booleanValue) : override.limitValue} ({override.reason}){override.revokedAt && " — revoked"}
      </li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No overrides.</p>}
    </section>

    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Invoices</h2>
      {detail.invoices.length ? <ul className="mt-3 divide-y text-sm">{detail.invoices.map((invoice) => <li className="flex justify-between py-2" key={invoice.id}><span>{new Date(invoice.periodStart).toLocaleDateString()} – {new Date(invoice.periodEnd).toLocaleDateString()}</span><span>{invoice.currencyCode} {(Number(invoice.amountMinor) / 100).toFixed(2)} — {invoice.status}</span></li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No invoices yet.</p>}
    </section>

    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Status history</h2>
      <ul className="mt-3 grid gap-1 text-sm">{detail.statusHistory.map((entry) => <li key={entry.id}>{new Date(entry.createdAt).toLocaleString()} — {entry.fromStatus ?? "—"} → {entry.toStatus}: {entry.reason}</li>)}</ul>
    </section>

    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Support sessions (visible to the organisation)</h2>
      <ul className="mt-3 grid gap-1 text-sm">{detail.supportSessions.map((session) => <li key={session.id}>{new Date(session.startedAt).toLocaleString()} — {session.reason} (expires {new Date(session.expiresAt).toLocaleString()}{session.endedAt ? ", ended" : ""})</li>)}</ul>
    </section>
  </div>;
}
