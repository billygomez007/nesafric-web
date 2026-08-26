"use client";

import { useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type Plan = {
  id: string; key: string; name: string; description: string | null; isActive: boolean; isPublic: boolean;
  prices: Array<{ id: string; currencyCode: string; billingCycle: string; amountMinor: string; isActive: boolean }>;
  entitlements: Array<{ id: string; featureKey: string; kind: string; booleanValue: boolean | null; limitValue: string | null; isUnlimited: boolean }>;
};

function PlansContent() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/platform-admin/plans").then(async (response) => {
      const body = await response.json();
      if (response.ok) setPlans(body as Plan[]);
      else setError(body.error?.message ?? "Unable to load plans.");
    });
  }, []);

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>;
  if (!plans) return <p className="text-slate-600">Loading…</p>;

  return <div className="grid gap-4">
    <p className="text-sm text-slate-600">Configurable plans, prices, and entitlements (item 1 + item 2). Editing a plan here changes what every subscribed organisation is entitled to going forward; existing usage/records are never deleted.</p>
    {plans.map((plan) => <section className="rounded-xl border bg-white p-5 shadow-sm" key={plan.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{plan.name} <span className="text-xs font-normal text-slate-500">({plan.key})</span></h2>
        <span className="text-xs text-slate-500">{plan.isActive ? "active" : "inactive"} · {plan.isPublic ? "public" : "internal"}</span>
      </div>
      <p className="mt-1 text-sm text-slate-600">{plan.description}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">Prices</h3>
          <ul className="mt-1 grid gap-1 text-sm">{plan.prices.map((price) => <li key={price.id}>{price.currencyCode} {(Number(price.amountMinor) / 100).toFixed(2)} / {price.billingCycle.toLowerCase()}</li>)}</ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Entitlements</h3>
          <ul className="mt-1 grid gap-1 text-sm">{plan.entitlements.map((entitlement) => <li key={entitlement.id}>{entitlement.featureKey}: {entitlement.isUnlimited ? "unlimited" : entitlement.kind === "BOOLEAN" ? String(entitlement.booleanValue) : entitlement.limitValue}</li>)}</ul>
        </div>
      </div>
    </section>)}
  </div>;
}

export default function PlatformAdminPlansPage() {
  return <PlatformAdminShell><PlansContent /></PlatformAdminShell>;
}
