"use client";

import { useCallback, useEffect, useState } from "react";

type Feature = {
  featureKey: string;
  label: string;
  description: string;
  unit: string | null;
  kind: "BOOLEAN" | "LIMIT";
  booleanValue: boolean | null;
  limit: number | null;
  isUnlimited: boolean;
  current: number | null;
  approaching: boolean;
  reached: boolean;
  source: "override" | "plan" | "default";
};

type PlanPrice = { currencyCode: string; billingCycle: "MONTHLY" | "ANNUAL"; amountMinor: string };
type AvailablePlan = { id: string; key: string; name: string; description: string | null; prices: PlanPrice[] };
type Invoice = { id: string; periodStart: string; periodEnd: string; amountMinor: string; currencyCode: string; status: string; paidAt: string | null; failureReason: string | null };

type BillingSnapshot = {
  subscriptionId: string;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "GRACE_PERIOD" | "SUSPENDED" | "CANCELLED";
  planKey: string;
  planName: string;
  billingCycle: "MONTHLY" | "ANNUAL";
  currencyCode: string;
  trialEndsAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  features: Feature[];
  invoices: Invoice[];
  availablePlans: AvailablePlan[];
};

const STATUS_STYLES: Record<BillingSnapshot["status"], string> = {
  TRIALING: "bg-blue-100 text-blue-800",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  PAST_DUE: "bg-amber-100 text-amber-800",
  GRACE_PERIOD: "bg-orange-100 text-orange-800",
  SUSPENDED: "bg-red-100 text-red-800",
  CANCELLED: "bg-slate-200 text-slate-700",
};

function money(amountMinor: string, currencyCode: string) {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency: currencyCode }).format(Number(amountMinor) / 100);
}

export function BillingSettings() {
  const [organisationId, setOrganisationId] = useState("");
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (orgId: string) => {
    const response = await fetch("/api/organisations/" + orgId + "/billing", { headers: { "x-organisation-id": orgId } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "Unable to load billing information.");
    setSnapshot(body as BillingSnapshot);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const orgId = localStorage.getItem("propertyos.activeOrganisationId") ?? "";
      setOrganisationId(orgId);
      if (!orgId) return setError("Choose an organisation.");
      void load(orgId).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load billing information."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function changePlan(planKey: string) {
    setError(""); setNotice("");
    const response = await fetch("/api/organisations/" + organisationId + "/billing/plan", {
      method: "POST", headers: { "x-organisation-id": organisationId, "content-type": "application/json" }, body: JSON.stringify({ planKey }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to change plan.");
    const conflicts = (body.conflicts ?? []) as Array<{ label: string; current: number; newLimit: number }>;
    setNotice(conflicts.length
      ? `Plan changed. Note: ${conflicts.map((c) => `${c.label} (${c.current} in use, new limit ${c.newLimit})`).join(", ")} will block new creation until usage is reduced or you upgrade again. Nothing was deleted.`
      : "Plan changed.");
    await load(organisationId);
  }

  async function cancel(immediate: boolean) {
    setError(""); setNotice("");
    const response = await fetch("/api/organisations/" + organisationId + "/billing/cancel", {
      method: "POST", headers: { "x-organisation-id": organisationId, "content-type": "application/json" }, body: JSON.stringify({ immediate }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to cancel subscription.");
    setNotice(immediate ? "Subscription cancelled immediately." : "Cancellation scheduled for the end of the current billing period.");
    await load(organisationId);
  }

  async function reactivate() {
    setError(""); setNotice("");
    const response = await fetch("/api/organisations/" + organisationId + "/billing/reactivate", { method: "POST", headers: { "x-organisation-id": organisationId } });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to reverse the scheduled cancellation.");
    setNotice("Scheduled cancellation reversed.");
    await load(organisationId);
  }

  if (!snapshot) return <p className="rounded-xl border bg-white p-6">{error || "Loading billing information..."}</p>;

  return <div className="grid gap-6">
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Billing</h1>
          <p className="mt-1 text-sm text-slate-600">Current plan, usage, and invoices for this organisation. Platform-level controls are never available here.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[snapshot.status]}`}>{snapshot.status.replaceAll("_", " ")}</span>
      </div>
      <dl className="mt-4 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
        <div><dt className="inline font-semibold">Plan:</dt> <dd className="inline">{snapshot.planName} ({snapshot.billingCycle.toLowerCase()})</dd></div>
        <div><dt className="inline font-semibold">Currency:</dt> <dd className="inline">{snapshot.currencyCode}</dd></div>
        {snapshot.trialEndsAt && <div><dt className="inline font-semibold">Trial ends:</dt> <dd className="inline">{new Date(snapshot.trialEndsAt).toLocaleDateString()}</dd></div>}
        <div><dt className="inline font-semibold">Current period:</dt> <dd className="inline">{new Date(snapshot.currentPeriodStart).toLocaleDateString()} – {new Date(snapshot.currentPeriodEnd).toLocaleDateString()}</dd></div>
        {snapshot.cancelAtPeriodEnd && <div className="sm:col-span-2 text-amber-700"><dt className="inline font-semibold">Scheduled:</dt> <dd className="inline">Cancels at the end of the current period.</dd></div>}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {snapshot.cancelAtPeriodEnd
          ? <button className="rounded-lg border px-4 py-2 text-sm font-semibold" onClick={() => void reactivate()}>Reverse scheduled cancellation</button>
          : snapshot.status !== "CANCELLED" && <>
              <button className="rounded-lg border px-4 py-2 text-sm font-semibold" onClick={() => void cancel(false)}>Cancel at period end</button>
              <button className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700" onClick={() => void cancel(true)}>Cancel immediately</button>
            </>}
      </div>
    </section>

    {(error || notice) && <p className={`rounded-lg p-3 text-sm ${error ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{error || notice}</p>}

    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="font-semibold">Available plans</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {snapshot.availablePlans.map((plan) => {
          const price = plan.prices.find((entry) => entry.currencyCode === snapshot.currencyCode && entry.billingCycle === snapshot.billingCycle);
          return <div className={`rounded-xl border p-4 ${plan.key === snapshot.planKey ? "border-emerald-400 bg-emerald-50" : ""}`} key={plan.id}>
            <h3 className="font-semibold">{plan.name}</h3>
            <p className="mt-1 text-xs text-slate-500">{plan.description}</p>
            {price && <p className="mt-2 text-lg font-semibold">{money(price.amountMinor, price.currencyCode)}<span className="text-xs font-normal text-slate-500"> / {snapshot.billingCycle.toLowerCase()}</span></p>}
            {plan.key === snapshot.planKey
              ? <p className="mt-3 text-xs font-semibold text-emerald-700">Current plan</p>
              : <button className="mt-3 rounded-lg border px-3 py-1.5 text-sm font-semibold" onClick={() => void changePlan(plan.key)}>Switch to {plan.name}</button>}
          </div>;
        })}
      </div>
    </section>

    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="font-semibold">Usage &amp; limits</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {snapshot.features.map((feature) => <div className="rounded-xl border p-4" key={feature.featureKey}>
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">{feature.label}</p>
            {feature.reached && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Limit reached</span>}
            {!feature.reached && feature.approaching && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Approaching limit</span>}
          </div>
          <p className="mt-1 text-xs text-slate-500">{feature.description}</p>
          {feature.kind === "BOOLEAN"
            ? <p className="mt-2 text-sm">{feature.booleanValue ? "Enabled" : "Not included on this plan"}</p>
            : <p className="mt-2 text-sm">{feature.current ?? 0} / {feature.isUnlimited ? "Unlimited" : feature.limit} {feature.unit}</p>}
        </div>)}
      </div>
    </section>

    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="font-semibold">Invoices</h2>
      {snapshot.invoices.length
        ? <ul className="mt-3 divide-y">{snapshot.invoices.map((invoice) => <li className="flex justify-between py-2 text-sm" key={invoice.id}>
            <span>{new Date(invoice.periodStart).toLocaleDateString()} – {new Date(invoice.periodEnd).toLocaleDateString()}</span>
            <span className="flex items-center gap-3"><span>{money(invoice.amountMinor, invoice.currencyCode)}</span><span className="font-semibold">{invoice.status}</span></span>
          </li>)}</ul>
        : <p className="mt-2 text-sm text-slate-600">No invoices yet.</p>}
    </section>
  </div>;
}
