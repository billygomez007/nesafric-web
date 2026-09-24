"use client";

import { useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type Plan = {
  id: string; key: string; name: string; description: string | null; isActive: boolean; isPublic: boolean;
  prices: Array<{ id: string; currencyCode: string; billingCycle: string; amountMinor: string; isActive: boolean }>;
  entitlements: Array<{ id: string; featureKey: string; kind: string; booleanValue: boolean | null; limitValue: string | null; isUnlimited: boolean }>;
};

const ENTITLEMENT_LABELS: Record<string, string> = {
  "properties.max": "Properties",
  "units.max": "Units",
  "team.members.max": "Team members",
  "listings.max": "Listings",
  "documents.monthly_max": "Documents per month",
  "messages.monthly_max": "Messages per month",
  "integrations.operations.monthly_max": "Integration operations per month",
  "integrations.enabled": "Integrations",
  "automation.enabled": "Automation",
  "reporting.advanced": "Advanced reporting",
  "propertyos.ai.property_manager": "AI Property Manager",
  "propertyos.ai.receptionist.text": "AI Receptionist — Text",
  "propertyos.ai.receptionist.voice": "AI Receptionist — Voice",
  "propertyos.maintenance.ai_classification": "Maintenance AI classification",
  "propertyos.maintenance.ai_dispatch": "Maintenance AI dispatch",
  "propertyos.maintenance.voice_dispatch": "Maintenance voice dispatch",
  "propertyos.predictive_maintenance": "Predictive maintenance",
  "propertyos.portfolio_intelligence": "Portfolio intelligence",
  "propertyos.voice.outbound_enabled": "Outbound voice",
  "propertyos.voice.call_volume_max": "Voice calls",
  "propertyos.voice.recording_enabled": "Voice recording",
  "propertyos.voice.inbound_minutes_monthly_max": "Inbound voice minutes",
  "propertyos.voice.outbound_minutes_monthly_max": "Outbound voice minutes",
  "propertyos.voice.human_transfer_enabled": "Human transfer",
  "propertyos.voice.concurrent_calls_max": "Concurrent voice calls",
};

function entitlementLabel(key: string) {
  return (
    ENTITLEMENT_LABELS[key] ??
    key.replaceAll(".", " ").replaceAll("_", " ")
  );
}

function entitlementValue(entitlement: Plan["entitlements"][number]) {
  if (entitlement.isUnlimited) return "Unlimited";
  if (entitlement.kind === "BOOLEAN") {
    return entitlement.booleanValue ? "Included" : "Not included";
  }
  return entitlement.limitValue ?? "—";
}

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
  if (!plans) return <p className="text-muted">Loading…</p>;

  return <div className="grid gap-4">
    <div>
      <h2 className="text-xl font-semibold text-forest">Plans & entitlements</h2>
      <p className="mt-1 text-sm text-muted">
        Review platform pricing and customer entitlements. Plan changes affect subscribed organisations going forward and never delete existing customer records.
      </p>
    </div>
    {plans.map((plan) => <section className="rounded-xl border bg-white p-5 shadow-card" key={plan.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{plan.name} <span className="text-xs font-normal text-muted">({plan.key})</span></h2>
        <span className="text-xs text-muted">{plan.isActive ? "active" : "inactive"} · {plan.isPublic ? "public" : "internal"}</span>
      </div>
      <p className="mt-1 text-sm text-muted">{plan.description}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">Prices</h3>
          <ul className="mt-1 grid gap-1 text-sm">{plan.prices.map((price) => <li key={price.id}>{price.currencyCode} {(Number(price.amountMinor) / 100).toFixed(2)} / {price.billingCycle.toLowerCase()}</li>)}</ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Entitlements</h3>
          <div className="mt-2 grid gap-1">
            {plan.entitlements.map((entitlement) => (
              <div
                className="flex items-center justify-between gap-4 border-b border-hairline/60 py-1.5 text-sm last:border-0"
                key={entitlement.id}
              >
                <span className="text-muted">
                  {entitlementLabel(entitlement.featureKey)}
                </span>
                <span className="font-medium text-ink">
                  {entitlementValue(entitlement)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>)}
  </div>;
}

export default function PlatformAdminPlansPage() {
  return <PlatformAdminShell><PlansContent /></PlatformAdminShell>;
}
