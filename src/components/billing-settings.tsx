"use client";

import { useCallback, useEffect, useState } from "react";
import { cheapestPlanWithFeature } from "@/modules/subscriptions/plan-catalog";

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
  source: "override" | "plan" | "default" | "marketplace";
};

type PlanSummary = {
  key: "essential" | "growth" | "enterprise";
  name: string;
  tagline: string;
  recommended: boolean;
  monthlyPriceMinor: string;
  priceLabel: string;
  currencyCode: string;
  units: number;
  staff: number;
  branches: number;
  aiRepliesMonthly: number;
  messagesMonthly: number;
  highlights: string[];
  support: string;
};

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

type Status = "NOT_ACTIVATED" | "TRIALING" | "ACTIVE" | "PAST_DUE" | "GRACE_PERIOD" | "SUSPENDED" | "CANCELLED" | "EXPIRED" | "PAYMENT_PENDING";

type BillingSnapshot = {
  status: Status;
  entitled: boolean;
  planKey: string | null;
  planName: string | null;
  currencyCode: string | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  gracePeriodEndsAt: string | null;
  features: Feature[];
  invoices: Invoice[];
  plans: PlanSummary[];
  units: { current: number; limit: number | null };
  pendingCheckout: { id: string; checkoutUrl: string | null; expiresAt: string; plan: { key: string; name: string } } | null;
  trialGrant: { startedAt: string; endsAt: string } | null;
  selectedPlan: { key: string; name: string } | null;
  billingRules: { trialDays: number; pastDueDays: number; gracePeriodDays: number };
  paymentsAvailable: boolean;
};

type CheckoutStatus = { id: string; status: "PENDING" | "PAID" | "FAILED" | "EXPIRED"; plan: { name: string }; failureReason: string | null };

const STATUS_COPY: Record<Status, { label: string; tone: string; description: string }> = {
  NOT_ACTIVATED: { label: "Not started", tone: "bg-white/15 text-white", description: "Property management is not active yet. Listing and searching on the marketplace are always free." },
  TRIALING: { label: "Free trial", tone: "bg-gold/20 text-white", description: "Your free trial includes property management. Nothing is charged automatically." },
  ACTIVE: { label: "Active", tone: "bg-teal/20 text-white", description: "Your plan is active." },
  PAST_DUE: { label: "Renewal due", tone: "bg-gold/20 text-white", description: "Your renewal payment is due. Everything keeps working while you pay." },
  GRACE_PERIOD: { label: "Grace period", tone: "bg-gold/20 text-white", description: "Your renewal payment is overdue. Pay before the grace period ends to avoid a pause." },
  PAYMENT_PENDING: { label: "Confirming payment", tone: "bg-white/15 text-white", description: "We are waiting for the payment provider to confirm your payment." },
  EXPIRED: { label: "Paused", tone: "bg-red-100 text-red-900", description: "Management features are paused. Your data is kept and you can still view and export it. Choose a plan to continue." },
  CANCELLED: { label: "Cancelled", tone: "bg-white/15 text-white", description: "This plan is cancelled and will not renew. Your data is kept." },
  SUSPENDED: { label: "Suspended", tone: "bg-red-100 text-red-900", description: "Management features are suspended. Contact NesAfric support. Your data is kept." },
};

const HIDDEN_FEATURE = (key: string) => key.includes("voice") || key.startsWith("service_provider.") || key === "listings.max" || key === "properties.max" || key === "propertyos.predictive_maintenance" || key === "propertyos.portfolio_intelligence";

const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
const formatDate = (value: string) => dateFormatter.format(new Date(value));
const money = (amountMinor: string, currencyCode: string) => new Intl.NumberFormat("en-GH", { style: "currency", currency: currencyCode, maximumFractionDigits: 2 }).format(Number(amountMinor) / 100);
const humanize = (status: string) => status.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());

function featureValue(feature: Feature) {
  if (feature.kind === "BOOLEAN") return feature.booleanValue ? "Included" : "Not included";
  if (feature.limit === 0) return "Not included";
  return `${(feature.current ?? 0).toLocaleString()} of ${(feature.limit ?? 0).toLocaleString()} ${feature.unit ?? "used"}`;
}

function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function BillingSettings() {
  const [organisationId, setOrganisationId] = useState("");
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [checkout, setCheckout] = useState<CheckoutStatus | null>(null);
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

  // Returning from the payment page: show the checkout's status and poll it until the provider
  // confirms. Only the provider's webhook activates the plan; this page just reports it.
  useEffect(() => {
    if (!organisationId) return;
    const checkoutId = new URLSearchParams(window.location.search).get("checkout");
    if (!checkoutId) return;
    let attempts = 0;
    let stopped = false;
    const poll = async () => {
      const response = await fetch(`/api/organisations/${organisationId}/billing/checkout?id=${encodeURIComponent(checkoutId)}`, { headers: { "x-organisation-id": organisationId } });
      if (!response.ok || stopped) return;
      const body = (await response.json()) as CheckoutStatus;
      setCheckout(body);
      if (body.status === "PENDING" && attempts < 20) {
        attempts += 1;
        window.setTimeout(() => void poll(), 3000);
      } else {
        void load(organisationId);
      }
    };
    void poll();
    return () => { stopped = true; };
  }, [organisationId, load]);

  async function post(path: string, body?: unknown) {
    const response = await fetch(`/api/organisations/${organisationId}/billing/${path}`, {
      method: "POST",
      headers: { "x-organisation-id": organisationId, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? "Something went wrong. Please try again.");
    return result;
  }

  async function run(action: () => Promise<string | void>) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const message = await action();
      if (message) setNotice(message);
      await load(organisationId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const startTrial = () => run(async () => {
    const result = await post("activate");
    return result.status === "TRIALING" ? `Your free trial has started and runs until ${formatDate(result.trialEndsAt)}.` : "Your free trial was already used. Choose a plan to continue.";
  });

  const selectPlan = (plan: PlanSummary) => run(async () => {
    const result = await post("plan", { planKey: plan.key });
    return result.effect === "SCHEDULED" ? `${plan.name} starts at your next renewal. Nothing is deleted.` : `${plan.name} selected. It starts when its payment is confirmed.`;
  });

  const pay = (plan: PlanSummary) => run(async () => {
    const result = await post("checkout", { planKey: plan.key, idempotencyKey: newIdempotencyKey() });
    if (result.checkoutUrl) window.location.assign(result.checkoutUrl);
    return "Opening the secure payment page…";
  });

  const cancel = (immediate: boolean) => {
    if (!window.confirm(immediate ? "Cancel now? Management features stop now. Your data is kept." : "Cancel at the end of the current period? Your data is kept.")) return;
    void run(async () => {
      await post("cancel", { immediate });
      return immediate ? "Your plan is cancelled. Your data is kept." : "Your plan will not renew.";
    });
  };

  const reactivate = () => run(async () => {
    await post("reactivate");
    return "Your plan will renew as normal.";
  });

  if (!snapshot) {
    return <section className="rounded-2xl border border-hairline bg-white p-6 shadow-card"><p className="text-sm text-muted">{error || "Loading billing information…"}</p></section>;
  }

  const status = STATUS_COPY[snapshot.status] ?? STATUS_COPY.EXPIRED;
  const onPaidPlan = ["ACTIVE", "PAST_DUE", "GRACE_PERIOD"].includes(snapshot.status);
  const currentPlan = snapshot.plans.find((plan) => plan.key === snapshot.planKey) ?? null;
  const limitFeatures = snapshot.features.filter((feature) => feature.kind === "LIMIT" && !HIDDEN_FEATURE(feature.featureKey) && snapshot.entitled);
  const capabilityFeatures = snapshot.features.filter((feature) => feature.kind === "BOOLEAN" && !HIDDEN_FEATURE(feature.featureKey));

  return (
    <div className="grid gap-6">
      {(error || notice) && (
        <div className={`rounded-xl border p-4 text-sm ${error ? "border-red-200 bg-red-50 text-red-900" : "border-teal/20 bg-teal/10 text-teal"}`} role={error ? "alert" : "status"}>{error || notice}</div>
      )}
      {checkout && (
        <div className={`rounded-xl border p-4 text-sm ${checkout.status === "PAID" ? "border-teal/20 bg-teal/10 text-teal" : checkout.status === "PENDING" ? "border-hairline bg-warm-white text-forest" : "border-red-200 bg-red-50 text-red-900"}`} role="status">
          {checkout.status === "PAID" && `Payment confirmed. ${checkout.plan.name} is active.`}
          {checkout.status === "PENDING" && "Waiting for the payment provider to confirm your payment. This page updates on its own."}
          {(checkout.status === "FAILED" || checkout.status === "EXPIRED") && `Your payment was not completed${checkout.failureReason ? `: ${checkout.failureReason}` : "."} Nothing was charged. You can try again below.`}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-forest bg-forest text-white shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-8">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-soft">Property management plan</p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{snapshot.status === "NOT_ACTIVATED" ? "Not started" : snapshot.status === "TRIALING" ? "Free trial" : snapshot.planName}</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/75">{status.description}</p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${status.tone}`}>{status.label}</span>
        </div>
        <dl className="grid border-t border-white/10 sm:grid-cols-3">
          <div className="border-b border-white/10 p-5 sm:border-b-0 sm:border-r">
            <dt className="text-xs text-white/60">Managed units</dt>
            <dd className="mt-2 text-xl font-semibold">{snapshot.units.limit === null || !snapshot.entitled ? `${snapshot.units.current} units` : `${snapshot.units.current} of ${snapshot.units.limit} units used`}</dd>
            {snapshot.units.limit !== null && snapshot.units.current >= snapshot.units.limit && snapshot.entitled && <dd className="mt-1 text-xs text-gold-soft">At capacity — upgrade to add more units.</dd>}
          </div>
          <div className="border-b border-white/10 p-5 sm:border-b-0 sm:border-r">
            <dt className="text-xs text-white/60">{snapshot.status === "TRIALING" ? "Trial ends" : snapshot.cancelAtPeriodEnd ? "Ends on" : onPaidPlan ? "Renews on" : "Free trial"}</dt>
            <dd className="mt-2 text-sm font-semibold">
              {snapshot.status === "TRIALING" && snapshot.trialEndsAt ? formatDate(snapshot.trialEndsAt)
                : onPaidPlan && snapshot.currentPeriodEnd ? formatDate(snapshot.currentPeriodEnd)
                  : snapshot.trialGrant ? `Used (${formatDate(snapshot.trialGrant.startedAt)} – ${formatDate(snapshot.trialGrant.endsAt)})`
                    : `${snapshot.billingRules.trialDays} days free when you start`}
            </dd>
            {snapshot.status === "GRACE_PERIOD" && snapshot.gracePeriodEndsAt && <dd className="mt-1 text-xs text-gold-soft">Grace period ends {formatDate(snapshot.gracePeriodEndsAt)}</dd>}
          </div>
          <div className="p-5">
            <dt className="text-xs text-white/60">Next plan</dt>
            <dd className="mt-2 text-sm font-semibold">{snapshot.selectedPlan ? snapshot.selectedPlan.name : onPaidPlan && currentPlan ? `${currentPlan.name} · ${currentPlan.priceLabel}` : "Not chosen yet"}</dd>
            {snapshot.pendingCheckout && <dd className="mt-1 text-xs text-white/70">Payment for {snapshot.pendingCheckout.plan.name} is waiting for confirmation.</dd>}
          </div>
        </dl>
        <div className="flex flex-wrap gap-3 border-t border-white/10 p-5">
          {snapshot.status === "NOT_ACTIVATED" && <button className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-forest hover:bg-cream disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted" disabled={busy} onClick={() => void startTrial()} type="button">Start {snapshot.billingRules.trialDays}-day free trial</button>}
          {snapshot.cancelAtPeriodEnd && <button className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-forest hover:bg-cream disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted" disabled={busy} onClick={() => void reactivate()} type="button">Keep my plan</button>}
          {!snapshot.cancelAtPeriodEnd && (onPaidPlan || snapshot.status === "TRIALING") && <button className="rounded-xl border border-white/30 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted" disabled={busy} onClick={() => cancel(false)} type="button">{snapshot.status === "TRIALING" ? "Cancel trial at its end" : "Cancel at period end"}</button>}
        </div>
      </section>

      <section aria-labelledby="plans-heading">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Plans</p>
          <h2 className="mt-2 text-2xl font-semibold text-forest" id="plans-heading">Choose your plan</h2>
          <p className="mt-1 text-sm text-muted">Only property management is billed. Listing and searching on the marketplace stay free. Prices in Ghana cedis, billed monthly.</p>
          {!snapshot.paymentsAvailable && <p className="mt-2 rounded-xl border border-gold/30 bg-gold/10 p-3 text-sm text-ink">Online payment is not available yet. Contact NesAfric support to activate a paid plan.</p>}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {snapshot.plans.map((plan) => {
            const current = onPaidPlan && plan.key === snapshot.planKey;
            const overCapacity = snapshot.units.current > plan.units;
            const cheaperThanCurrent = onPaidPlan && currentPlan ? Number(plan.monthlyPriceMinor) < Number(currentPlan.monthlyPriceMinor) : false;
            const canPay = snapshot.paymentsAvailable && snapshot.status !== "SUSPENDED" && !snapshot.pendingCheckout && !(cheaperThanCurrent && snapshot.status === "ACTIVE");
            return (
              <article className={`flex flex-col rounded-2xl border bg-white p-5 shadow-card ${plan.recommended ? "border-teal ring-1 ring-teal/30" : "border-hairline"}`} key={plan.key}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-lg font-semibold text-forest">{plan.name}</h3>
                  {current ? <span className="rounded-full bg-teal/10 px-2.5 py-1 text-xs font-semibold text-teal">Current</span> : plan.recommended && <span className="rounded-full bg-gold/15 px-2.5 py-1 text-xs font-semibold text-ink">Recommended</span>}
                </div>
                <p className="mt-1 text-sm text-muted">{plan.tagline}</p>
                <p className="mt-4 text-2xl font-semibold text-forest">{plan.priceLabel}</p>
                <ul className="mt-4 space-y-1.5 text-sm text-forest">
                  <li>Up to {plan.units} managed units</li>
                  <li>{plan.staff === 1 ? "1 admin user" : `Up to ${plan.staff} staff users`}</li>
                  <li>{plan.branches === 1 ? "1 branch" : `Up to ${plan.branches} branches`}</li>
                  <li>{plan.aiRepliesMonthly.toLocaleString()} AI tenant replies a month</li>
                  <li>{plan.messagesMonthly.toLocaleString()} outbound messages a month</li>
                </ul>
                <ul className="mt-4 space-y-1.5 border-t border-hairline pt-4 text-sm text-muted">
                  {plan.highlights.map((line) => <li key={line}>{line}</li>)}
                  <li>{plan.support}</li>
                </ul>
                {overCapacity && <p className="mt-3 rounded-lg bg-gold/10 p-2 text-xs text-ink">You manage {snapshot.units.current} units; this plan allows {plan.units}. Nothing is deleted, but you cannot add units until you are within the limit.</p>}
                <div className="mt-auto grid gap-2 pt-5">
                  {!current && canPay && <button className="w-full rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted" disabled={busy} onClick={() => void pay(plan)} type="button">{onPaidPlan ? `Upgrade to ${plan.name}` : snapshot.status === "TRIALING" ? `Pay for ${plan.name} now` : `Pay and activate ${plan.name}`}</button>}
                  {current && ["PAST_DUE", "GRACE_PERIOD"].includes(snapshot.status) && canPay && <button className="w-full rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted" disabled={busy} onClick={() => void pay(plan)} type="button">Pay renewal</button>}
                  {!current && snapshot.status !== "NOT_ACTIVATED" && snapshot.status !== "SUSPENDED" && (!onPaidPlan || cheaperThanCurrent) && snapshot.selectedPlan?.key !== plan.key && <button className="w-full rounded-xl border border-hairline px-4 py-2.5 text-sm font-semibold text-forest hover:bg-warm-white disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted" disabled={busy} onClick={() => void selectPlan(plan)} type="button">{cheaperThanCurrent ? "Switch at next renewal" : "Choose this plan"}</button>}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {snapshot.entitled && (
        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Usage</p>
            <h2 className="mt-2 text-xl font-semibold text-forest">Usage this period</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {limitFeatures.map((feature) => {
                const progress = feature.limit && feature.limit > 0 ? Math.min(100, ((feature.current ?? 0) / feature.limit) * 100) : 0;
                return (
                  <div className="rounded-xl border border-hairline bg-warm-white p-4" key={feature.featureKey}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-forest">{feature.label}</p>
                      {feature.reached ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-800">At limit</span> : feature.approaching && <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[11px] font-semibold text-ink">Near limit</span>}
                    </div>
                    <p className="mt-2 text-sm font-semibold text-forest">{featureValue(feature)}</p>
                    {progress > 0 && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cream"><div className={`h-full rounded-full ${feature.reached ? "bg-gold" : "bg-teal"}`} style={{ width: `${progress}%` }} /></div>}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Features</p>
            <h2 className="mt-2 text-xl font-semibold text-forest">What your plan includes</h2>
            <div className="mt-5 space-y-3">
              {capabilityFeatures.map((feature) => {
                const unlock = feature.booleanValue ? null : cheapestPlanWithFeature(feature.featureKey);
                return (
                  <div className="flex items-start justify-between gap-3 rounded-xl border border-hairline p-3" key={feature.featureKey}>
                    <div><p className="text-sm font-semibold text-forest">{feature.label}</p>{unlock && <p className="mt-1 text-xs text-muted">Available on {unlock.name}</p>}</div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${feature.booleanValue ? "bg-teal/10 text-teal" : "bg-surface text-muted"}`}>{feature.booleanValue ? "Included" : "Not included"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-hairline bg-white p-5 shadow-card sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Billing history</p>
        <h2 className="mt-2 text-xl font-semibold text-forest">Payments</h2>
        {snapshot.invoices.length ? (
          <ul className="mt-5 divide-y divide-hairline">
            {snapshot.invoices.map((invoice) => (
              <li className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm" key={invoice.id}>
                <span className="text-forest">{formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}</span>
                <span className="font-semibold text-forest">{money(invoice.amountMinor, invoice.currencyCode)}</span>
                <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-muted">{humanize(invoice.status)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-5 rounded-xl border border-dashed border-hairline bg-warm-white p-5 text-sm text-muted">No payments yet.</p>}
      </section>
    </div>
  );
}
