"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
type Invoice = {
  id: string;
  periodStart: string;
  periodEnd: string;
  amountMinor: string;
  currencyCode: string;
  status: string;
  paidAt: string | null;
  failureReason: string | null;
};

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

type Conflict = { label: string; current: number; newLimit: number };

const STATUS_COPY: Record<BillingSnapshot["status"], { label: string; tone: string; description: string }> = {
  TRIALING: { label: "Trial", tone: "bg-gold/10 text-ink", description: "Your workspace is within its trial period." },
  ACTIVE: { label: "Active", tone: "bg-teal/10 text-teal", description: "Your subscription is active and your workspace is fully operational." },
  PAST_DUE: { label: "Payment attention", tone: "bg-gold/10 text-ink", description: "A billing payment needs attention. Your workspace remains available during the current grace window." },
  GRACE_PERIOD: { label: "Grace period", tone: "bg-gold/10 text-ink", description: "Your subscription is in its grace period." },
  SUSPENDED: { label: "Suspended", tone: "bg-red-50 text-red-800", description: "Billing access is suspended. Existing data remains protected." },
  CANCELLED: { label: "Cancelled", tone: "bg-surface text-muted", description: "This subscription is cancelled and read-only restrictions may apply." },
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

function money(amountMinor: string, currencyCode: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode, maximumFractionDigits: 2 }).format(Number(amountMinor) / 100);
}

function intervalLabel(cycle: BillingSnapshot["billingCycle"]) {
  return cycle === "ANNUAL" ? "year" : "month";
}

function humanizeStatus(status: string) {
  return status.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

function isVoiceFeature(featureKey: string) {
  return featureKey.includes("voice");
}

function featureValue(feature: Feature) {
  if (feature.kind === "BOOLEAN") return feature.booleanValue ? "Included" : "Not included";
  if (!feature.isUnlimited && feature.limit === 0) return "Not included";
  if (feature.isUnlimited) return `${feature.current ?? 0} used · No configured limit`;
  return `${feature.current ?? 0} / ${feature.limit ?? 0} ${feature.unit ?? "used"}`;
}

export function BillingSettings() {
  const [organisationId, setOrganisationId] = useState("");
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (orgId: string) => {
    const response = await fetch(`/api/organisations/${orgId}/billing`, { headers: { "x-organisation-id": orgId } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "Unable to load billing information.");
    setSnapshot(body as BillingSnapshot);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const orgId = localStorage.getItem("propertyos.activeOrganisationId") ?? "";
      setOrganisationId(orgId);
      if (!orgId) {
        setError("Choose an organisation to view billing.");
        return;
      }
      void load(orgId).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load billing information."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const currentPrice = useMemo(() => {
    if (!snapshot) return null;
    return snapshot.availablePlans.find((plan) => plan.key === snapshot.planKey)?.prices.find(
      (price) => price.currencyCode === snapshot.currencyCode && price.billingCycle === snapshot.billingCycle,
    ) ?? null;
  }, [snapshot]);

  async function changePlan(plan: AvailablePlan) {
    if (!snapshot || plan.key === snapshot.planKey) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const previewResponse = await fetch(`/api/organisations/${organisationId}/billing/plan?planKey=${encodeURIComponent(plan.key)}`, {
        headers: { "x-organisation-id": organisationId },
      });
      const previewBody = await previewResponse.json();
      if (!previewResponse.ok) throw new Error(previewBody.error?.message ?? "Unable to preview this plan change.");
      const conflicts = (previewBody.conflicts ?? []) as Conflict[];
      const price = plan.prices.find((entry) => entry.currencyCode === snapshot.currencyCode && entry.billingCycle === snapshot.billingCycle);
      const priceCopy = price ? `${money(price.amountMinor, price.currencyCode)} / ${intervalLabel(snapshot.billingCycle)}` : "the configured rate";
      const conflictCopy = conflicts.length
        ? ` ${conflicts.map((conflict) => `${conflict.label}: ${conflict.current} in use, new limit ${conflict.newLimit}`).join("; ")}. Existing records will not be deleted.`
        : "";
      if (!window.confirm(`Switch to ${plan.name} at ${priceCopy}?${conflictCopy}`)) return;
      const response = await fetch(`/api/organisations/${organisationId}/billing/plan`, {
        method: "POST",
        headers: { "x-organisation-id": organisationId, "content-type": "application/json" },
        body: JSON.stringify({ planKey: plan.key }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Unable to change plan.");
      setNotice(conflicts.length ? `Plan changed to ${plan.name}. Existing records were preserved; new creation may be limited until usage is reduced.` : `Plan changed to ${plan.name}.`);
      await load(organisationId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to change plan.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(immediate: boolean) {
    if (!snapshot) return;
    const message = immediate
      ? "Cancel this subscription immediately? Existing records will not be deleted."
      : "Schedule cancellation at the end of the current billing period?";
    if (!window.confirm(message)) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const response = await fetch(`/api/organisations/${organisationId}/billing/cancel`, {
        method: "POST",
        headers: { "x-organisation-id": organisationId, "content-type": "application/json" },
        body: JSON.stringify({ immediate }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Unable to cancel subscription.");
      setNotice(immediate ? "Subscription cancelled immediately." : "Cancellation scheduled for the end of the current billing period.");
      await load(organisationId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to cancel subscription.");
    } finally {
      setBusy(false);
    }
  }

  async function reactivate() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const response = await fetch(`/api/organisations/${organisationId}/billing/reactivate`, { method: "POST", headers: { "x-organisation-id": organisationId } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Unable to reverse the scheduled cancellation.");
      setNotice("Scheduled cancellation reversed.");
      await load(organisationId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to reverse the scheduled cancellation.");
    } finally {
      setBusy(false);
    }
  }

  if (!snapshot) {
    return <section className="rounded-2xl border border-hairline bg-white p-6 shadow-card"><p className="text-sm text-muted">{error || "Loading billing information…"}</p></section>;
  }

  const status = STATUS_COPY[snapshot.status];
  const limitFeatures = snapshot.features.filter((feature) => feature.kind === "LIMIT");
  const capabilityFeatures = snapshot.features.filter((feature) => feature.kind === "BOOLEAN");

  return (
    <div className="grid gap-6">
      {(error || notice) && (
        <div className={`rounded-xl border p-4 text-sm ${error ? "border-red-200 bg-red-50 text-red-900" : "border-teal/20 bg-teal/10 text-teal"}`} role={error ? "alert" : "status"}>
          {error || notice}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-forest bg-forest text-white shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-6 p-6 sm:p-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-soft">Current plan</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">{snapshot.planName}</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/70">{status.description}</p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${status.tone}`}>{status.label}</span>
        </div>
        <div className="grid border-t border-white/10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="border-white/10 p-5 sm:border-r"><p className="text-xs text-white/55">Plan price</p><p className="mt-2 text-xl font-semibold">{currentPrice ? money(currentPrice.amountMinor, currentPrice.currencyCode) : "Configured rate"}</p><p className="mt-1 text-xs text-white/55">per {intervalLabel(snapshot.billingCycle)}</p></div>
          <div className="border-white/10 p-5 sm:border-r"><p className="text-xs text-white/55">Billing cycle</p><p className="mt-2 text-xl font-semibold">{snapshot.billingCycle === "ANNUAL" ? "Annual" : "Monthly"}</p><p className="mt-1 text-xs text-white/55">{snapshot.currencyCode}</p></div>
          <div className="border-white/10 p-5 sm:border-r"><p className="text-xs text-white/55">Current period</p><p className="mt-2 text-sm font-semibold">{formatDate(snapshot.currentPeriodStart)} – {formatDate(snapshot.currentPeriodEnd)}</p><p className="mt-1 text-xs text-white/55">Renewal window</p></div>
          <div className="p-5"><p className="text-xs text-white/55">{snapshot.trialEndsAt ? "Trial ends" : snapshot.cancelAtPeriodEnd ? "Ends on" : "Subscription"}</p><p className="mt-2 text-sm font-semibold">{snapshot.trialEndsAt ? formatDate(snapshot.trialEndsAt) : snapshot.cancelAtPeriodEnd ? formatDate(snapshot.currentPeriodEnd) : "No scheduled change"}</p><p className="mt-1 text-xs text-white/55">{snapshot.cancelAtPeriodEnd ? "Cancellation scheduled" : "Billing state is current"}</p></div>
        </div>
        <div className="flex flex-wrap gap-3 border-t border-white/10 p-5 sm:p-6">
          {snapshot.cancelAtPeriodEnd ? <button className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-forest transition hover:bg-cream disabled:opacity-60" disabled={busy} onClick={() => void reactivate()} type="button">Reverse scheduled cancellation</button> : snapshot.status !== "CANCELLED" && <><button className="rounded-xl border border-white/25 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60" disabled={busy} onClick={() => void cancel(false)} type="button">Cancel at period end</button><button className="rounded-xl border border-red-200/40 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500/20 disabled:opacity-60" disabled={busy} onClick={() => void cancel(true)} type="button">Cancel immediately</button></>}
        </div>
      </section>

      <section>
        <div className="mb-4"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Plans</p><h2 className="mt-2 text-2xl font-semibold text-forest">Change your plan</h2><p className="mt-1 text-sm text-muted">Plans and prices are configured for this PropertyOS organisation.</p></div>
        <div className="grid gap-4 lg:grid-cols-3">
          {snapshot.availablePlans.map((plan) => {
            const price = plan.prices.find((entry) => entry.currencyCode === snapshot.currencyCode && entry.billingCycle === snapshot.billingCycle);
            const current = plan.key === snapshot.planKey;
            return <article className={`rounded-2xl border bg-white p-5 shadow-card ${current ? "border-teal ring-1 ring-teal/20" : "border-hairline"}`} key={plan.id}>
              <div className="flex items-start justify-between gap-3"><h3 className="text-lg font-semibold text-forest">{plan.name}</h3>{current && <span className="rounded-full bg-teal/10 px-2.5 py-1 text-xs font-semibold text-teal">Current</span>}</div>
              <p className="mt-2 min-h-10 text-sm leading-6 text-muted">{plan.description || "Plan details are configured by NesAfric."}</p>
              <p className="mt-5 text-2xl font-semibold text-forest">{price ? money(price.amountMinor, price.currencyCode) : "Not configured"}{price && <span className="ml-1 text-xs font-normal text-muted">/ {intervalLabel(snapshot.billingCycle)}</span>}</p>
              {!current && <button className="mt-5 w-full rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald disabled:cursor-not-allowed disabled:opacity-60" disabled={busy || !price || snapshot.status === "CANCELLED"} onClick={() => void changePlan(plan)} type="button">Switch to {plan.name}</button>}
            </article>;
          })}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-hairline bg-white p-6 shadow-card"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Usage</p><h2 className="mt-2 text-xl font-semibold text-forest">Usage &amp; limits</h2></div><span className="text-xs text-muted">Current billing period</span></div><div className="mt-5 grid gap-3 sm:grid-cols-2">{limitFeatures.map((feature) => { const progress = feature.limit && feature.limit > 0 && !feature.isUnlimited ? Math.min(100, ((feature.current ?? 0) / feature.limit) * 100) : 0; return <div className="rounded-xl border border-hairline bg-warm-white p-4" key={feature.featureKey}><div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold text-forest">{feature.label}</p>{feature.reached ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-800">At limit</span> : feature.approaching && <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[11px] font-semibold text-ink">Near limit</span>}</div><p className="mt-1 text-xs leading-5 text-muted">{feature.description}</p><p className="mt-3 text-sm font-semibold text-forest">{featureValue(feature)}</p>{progress > 0 && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cream"><div className={`h-full rounded-full ${feature.reached ? "bg-gold" : "bg-teal"}`} style={{ width: `${progress}%` }} /></div>}</div>; })}</div></div>
        <div className="rounded-2xl border border-hairline bg-white p-6 shadow-card"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Included capabilities</p><h2 className="mt-2 text-xl font-semibold text-forest">What your plan includes</h2><div className="mt-5 space-y-3">{capabilityFeatures.map((feature) => <div className="flex items-start justify-between gap-3 rounded-xl border border-hairline p-3" key={feature.featureKey}><div><p className="text-sm font-semibold text-forest">{feature.label}</p><p className="mt-1 text-xs leading-5 text-muted">{isVoiceFeature(feature.featureKey) ? "Voice remains deferred until the supported product flow is available." : feature.description}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${feature.booleanValue ? "bg-teal/10 text-teal" : "bg-surface text-muted"}`}>{isVoiceFeature(feature.featureKey) ? "Deferred" : feature.booleanValue ? "Included" : "Not included"}</span></div>)}</div></div>
      </section>

      <section className="rounded-2xl border border-hairline bg-white p-6 shadow-card"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Billing history</p><h2 className="mt-2 text-xl font-semibold text-forest">Invoices</h2></div><p className="text-xs text-muted">Subscription invoices only</p></div>{snapshot.invoices.length ? <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-hairline text-xs uppercase tracking-[0.14em] text-muted"><tr><th className="pb-3 pr-4 font-semibold">Period</th><th className="pb-3 pr-4 font-semibold">Amount</th><th className="pb-3 pr-4 font-semibold">Status</th><th className="pb-3 font-semibold">Paid</th></tr></thead><tbody className="divide-y divide-hairline">{snapshot.invoices.map((invoice) => <tr key={invoice.id}><td className="py-4 pr-4 text-forest">{formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}</td><td className="py-4 pr-4 font-semibold text-forest">{money(invoice.amountMinor, invoice.currencyCode)}</td><td className="py-4 pr-4"><span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-muted">{humanizeStatus(invoice.status)}</span>{invoice.failureReason && <p className="mt-1 max-w-xs text-xs text-red-700">Payment needs attention</p>}</td><td className="py-4 text-muted">{invoice.paidAt ? formatDate(invoice.paidAt) : "—"}</td></tr>)}</tbody></table></div> : <div className="mt-5 rounded-xl border border-dashed border-hairline bg-warm-white p-5 text-sm text-muted">No subscription invoices yet.</div>}</section>
    </div>
  );
}
