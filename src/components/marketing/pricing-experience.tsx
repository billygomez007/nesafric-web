"use client";

import Link from "next/link";
import { useState } from "react";
import { PM_BILLING_RULES, PM_PLAN_KEYS, PM_PLANS } from "@/modules/subscriptions/plan-catalog";

type BillingCycle = "monthly" | "annual";

type Plan = {
  name: string;
  description: string;
  monthly: number;
  annual: number;
  /** Billed monthly only: the annual toggle shows the monthly price. */
  monthlyOnly?: boolean;
  pricePrefix?: string;
  badge?: string;
  featured?: boolean;
  cta: string;
  href: string;
  highlights: string[];
};

/** Property-management plans come from the same catalog the billing system enforces. */
const propertyPlans: Plan[] = PM_PLAN_KEYS.map((key) => PM_PLANS[key]).map((plan) => ({
  name: plan.name,
  description: plan.tagline,
  monthly: plan.monthlyPriceMinor / 100,
  annual: plan.monthlyPriceMinor / 100,
  monthlyOnly: true,
  pricePrefix: plan.priceIsFrom ? "From " : undefined,
  badge: plan.recommended ? "Recommended" : undefined,
  featured: plan.recommended,
  cta: `Start ${PM_BILLING_RULES.trialDays}-day free trial`,
  href: "/register",
  highlights: [
    `Up to ${plan.allowances.units} managed units`,
    plan.allowances.staff === 1 ? "1 admin user" : `Up to ${plan.allowances.staff} staff users`,
    plan.allowances.branches === 1 ? "1 branch" : `Up to ${plan.allowances.branches} branches`,
    `${plan.allowances.aiRepliesMonthly.toLocaleString("en-GH")} AI tenant replies a month`,
    ...plan.highlights,
    plan.support,
  ],
}));

const professionalPlans: Plan[] = [
  {
    name: "Marketplace Free",
    description: "For professionals joining NesAfric and building a marketplace presence.",
    monthly: 0,
    annual: 0,
    badge: "Ghana launch",
    cta: "Start Free",
    href: "/register",
    highlights: [
      "Up to 10 active listings",
      "Up to 3 team members",
      "Up to 2 developments",
      "Lead management and lead inbox",
      "Viewing coordination",
      "Professional marketplace profile",
      "No card required",
    ],
  },
  {
    name: "Marketplace Pro",
    description: "For an active individual agent or small team bringing more inventory online.",
    monthly: 150,
    annual: 1500,
    featured: true,
    badge: "For active agents",
    cta: "Choose Pro",
    href: "/register",
    highlights: [
      "Up to 50 active listings",
      "Up to 5 team members",
      "Up to 5 developments",
      "Promoted listings",
      "AI text receptionist",
      "AI listing assistant",
      "AI inventory search",
      "Lead management and viewing coordination",
    ],
  },
  {
    name: "Brokerage",
    description: "For a brokerage or real-estate company running a full sales and leasing team.",
    monthly: 600,
    annual: 6000,
    cta: "Choose Brokerage",
    href: "/register",
    highlights: [
      "Up to 300 active listings",
      "Up to 25 team members",
      "Up to 20 developments",
      "Promoted listings and featured profile",
      "Advanced analytics",
      "AI receptionist, sales agent and lead manager",
      "AI listing, inventory and viewing tools",
      "AI outbound follow-up and calling",
      "Voice features with team call capacity",
    ],
  },
  {
    name: "Marketplace Enterprise",
    description: "For major national or international real-estate companies and developers.",
    monthly: 1500,
    annual: 15000,
    cta: "Choose Enterprise",
    href: "/register",
    highlights: [
      "Unlimited active listings",
      "Unlimited team members",
      "Unlimited developments",
      "Featured profile and advanced analytics",
      "Full AI sales workforce",
      "Full AI receptionist and voice capabilities",
      "Unlimited voice usage entitlements",
      "Unlimited concurrent-call entitlement",
    ],
  },
];

const pmPlanList = PM_PLAN_KEYS.map((key) => PM_PLANS[key]);
const included = (featureKey: string) => pmPlanList.map((plan) => (plan.features.includes(featureKey) ? "Included" : "—"));
const propertyComparison = [
  ["Managed units", ...pmPlanList.map((plan) => String(plan.allowances.units))],
  ["Staff users", ...pmPlanList.map((plan) => String(plan.allowances.staff))],
  ["Branches", ...pmPlanList.map((plan) => String(plan.allowances.branches))],
  ["AI tenant replies / month", ...pmPlanList.map((plan) => plan.allowances.aiRepliesMonthly.toLocaleString("en-GH"))],
  ["Outbound messages / month", ...pmPlanList.map((plan) => plan.allowances.messagesMonthly.toLocaleString("en-GH"))],
  ["WhatsApp AI tenant assistant", ...included("pm.whatsapp_ai_assistant")],
  ["Maintenance capture, categorisation and dispatch", ...included("propertyos.maintenance.ai_dispatch")],
  ["Rent and tenancy reminders", ...included("pm.rent_reminders")],
  ["Role-based staff permissions", ...included("pm.staff_roles")],
  ["Routing and escalation rules", ...included("pm.escalation_rules")],
  ["Supervisor notifications", ...included("pm.supervisor_notifications")],
  ["Detailed reports", ...included("reporting.advanced")],
  ["Integrations", ...included("integrations.enabled")],
];

const professionalComparison = [
  ["Active listings", "10", "50", "300", "Unlimited"],
  ["Team members", "3", "5", "25", "Unlimited"],
  ["Developments", "2", "5", "20", "Unlimited"],
  ["Lead management", "Included", "Included", "Included", "Included"],
  ["Promoted listings", "—", "Included", "Included", "Included"],
  ["Featured profile", "—", "—", "Included", "Included"],
  ["Advanced analytics", "—", "—", "Included", "Included"],
  ["AI text receptionist", "—", "Included", "Included", "Included"],
  ["AI listing assistant", "—", "Included", "Included", "Included"],
  ["AI inventory search", "—", "Included", "Included", "Included"],
  ["AI sales agent", "—", "—", "Included", "Included"],
  ["AI lead manager", "—", "—", "Included", "Included"],
  ["AI viewing scheduler", "—", "—", "Included", "Included"],
  ["AI outbound follow-up", "—", "—", "Included", "Included"],
  ["AI outbound calls", "—", "—", "Included", "Included"],
];

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    maximumFractionDigits: 0,
  }).format(value);
}

function PlanCard({
  plan,
  billingCycle,
}: {
  plan: Plan;
  billingCycle: BillingCycle;
}) {
  const monthly = billingCycle === "monthly" || plan.monthlyOnly;
  const amount = monthly ? plan.monthly : plan.annual;
  const period = amount === 0 ? "" : monthly ? "/month" : "/year";

  return (
    <article
      className={
        plan.featured
          ? "relative flex h-full flex-col rounded-3xl border border-teal/35 bg-forest p-6 text-white shadow-xl shadow-forest/10 sm:p-7"
          : "relative flex h-full flex-col rounded-3xl border border-hairline bg-white p-6 text-ink shadow-sm sm:p-7"
      }
    >
      {plan.badge && (
        <span
          className={
            plan.featured
              ? "mb-5 w-fit rounded-full bg-gold px-3 py-1 text-[11px] font-bold uppercase tracking-[0.13em] text-forest-deep"
              : "mb-5 w-fit rounded-full bg-cream px-3 py-1 text-[11px] font-bold uppercase tracking-[0.13em] text-gold-ink"
          }
        >
          {plan.badge}
        </span>
      )}

      <div>
        <h3 className={plan.featured ? "text-xl font-semibold text-white" : "text-xl font-semibold text-forest"}>
          {plan.name}
        </h3>
        <p className={plan.featured ? "mt-2 min-h-[72px] text-sm leading-6 text-white/65" : "mt-2 min-h-[72px] text-sm leading-6 text-muted"}>
          {plan.description}
        </p>
      </div>

      <div className="mt-6 border-t border-current/10 pt-6">
        <div className="flex items-end gap-2">
          <span className={plan.featured ? "text-4xl font-semibold tracking-tight text-white" : "text-4xl font-semibold tracking-tight text-forest"}>
            {amount === 0 ? "Free" : `${plan.pricePrefix ?? ""}${formatPrice(amount)}`}
          </span>
          {period && (
            <span className={plan.featured ? "pb-1 text-sm text-white/55" : "pb-1 text-sm text-muted"}>
              {period}
            </span>
          )}
        </div>

        {amount > 0 && !monthly && (
          <p className={plan.featured ? "mt-2 text-xs text-gold-soft" : "mt-2 text-xs text-emerald"}>
            Equivalent to 10 months of monthly billing.
          </p>
        )}
        {amount > 0 && plan.monthlyOnly && billingCycle === "annual" && (
          <p className={plan.featured ? "mt-2 text-xs text-white/55" : "mt-2 text-xs text-muted"}>
            Billed monthly; no annual plan yet.
          </p>
        )}
        {amount === 0 && (
          <p className={plan.featured ? "mt-2 text-xs text-white/55" : "mt-2 text-xs text-muted"}>
            Current Ghana marketplace launch plan.
          </p>
        )}
      </div>

      <ul className="mt-6 flex-1 space-y-3">
        {plan.highlights.map((item) => (
          <li className="flex items-start gap-3 text-sm leading-6" key={item}>
            <span
              aria-hidden="true"
              className={
                plan.featured
                  ? "mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal/20 text-xs text-teal-light"
                  : "mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal/10 text-xs text-emerald"
              }
            >
              ✓
            </span>
            <span className={plan.featured ? "text-white/78" : "text-muted"}>{item}</span>
          </li>
        ))}
      </ul>

      <Link
        className={
          plan.featured
            ? "mt-7 inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-forest transition hover:bg-cream"
            : "mt-7 inline-flex items-center justify-center rounded-xl bg-forest px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald"
        }
        href={plan.href}
      >
        {plan.cta}
      </Link>
    </article>
  );
}

function BillingToggle({
  billingCycle,
  onChange,
}: {
  billingCycle: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
}) {
  return (
    <div className="inline-flex rounded-panel border border-hairline bg-white p-1" role="group" aria-label="Billing cycle">
      <button
        aria-pressed={billingCycle === "monthly"}
        className={
          billingCycle === "monthly"
            ? "min-h-10 rounded-media bg-forest px-5 py-2 text-sm font-semibold text-white"
            : "min-h-10 rounded-media px-5 py-2 text-sm font-semibold text-slate-600 hover:text-forest"
        }
        onClick={() => onChange("monthly")}
        type="button"
      >
        Monthly
      </button>
      <button
        aria-pressed={billingCycle === "annual"}
        className={
          billingCycle === "annual"
            ? "min-h-10 rounded-media bg-forest px-5 py-2 text-sm font-semibold text-white"
            : "min-h-10 rounded-media px-5 py-2 text-sm font-semibold text-slate-600 hover:text-forest"
        }
        onClick={() => onChange("annual")}
        type="button"
      >
        Annual
        <span className={`ml-2 text-[10px] font-bold uppercase tracking-[0.12em] ${billingCycle === "annual" ? "text-gold-soft" : "text-gold-ink"}`}>
          2 months free
        </span>
      </button>
    </div>
  );
}

function ComparisonTable({
  headings,
  rows,
}: {
  headings: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-x-auto rounded-3xl border border-hairline bg-white shadow-sm">
      <table className="min-w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-hairline bg-cream/55">
            {headings.map((heading, index) => (
              <th
                className={
                  index === 0
                    ? "min-w-[220px] px-5 py-4 text-xs font-bold uppercase tracking-[0.12em] text-forest"
                    : "min-w-[140px] px-5 py-4 text-center text-xs font-bold uppercase tracking-[0.12em] text-forest"
                }
                key={heading}
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-b border-hairline last:border-b-0" key={row[0]}>
              {row.map((cell, index) => (
                <td
                  className={
                    index === 0
                      ? "px-5 py-4 text-sm font-medium text-ink"
                      : cell === "Included"
                        ? "px-5 py-4 text-center text-sm font-semibold text-emerald"
                        : cell === "—"
                          ? "px-5 py-4 text-center text-sm text-muted/45"
                          : "px-5 py-4 text-center text-sm text-muted"
                  }
                  key={index}
                >
                  {cell === "Included" ? "✓ Included" : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PricingExperience() {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");

  return (
    <>
      <section className="bg-warm-white pb-16 pt-20 sm:pb-20 sm:pt-28">
        <div className="mx-auto max-w-4xl px-6 text-center sm:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-gold-ink">
            NESAFRIC PRICING
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-forest sm:text-5xl lg:text-6xl">
            Choose the workspace that fits how you work.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-muted sm:text-lg">
            Clear pricing for property operations and real-estate professionals. Start at the level you need,
            then move up as your portfolio, team or sales operation grows.
          </p>

          <div className="mt-8 flex justify-center">
            <BillingToggle billingCycle={billingCycle} onChange={setBillingCycle} />
          </div>

          <div className="mt-8 flex flex-wrap justify-center gap-2 text-sm">
            <a className="rounded-full border border-hairline bg-white px-4 py-2 font-semibold text-forest hover:border-teal/30" href="#property-management">
              Property Management
            </a>
            <a className="rounded-full border border-hairline bg-white px-4 py-2 font-semibold text-forest hover:border-teal/30" href="#professional-marketplace">
              Professional Marketplace
            </a>
            <a className="rounded-full border border-hairline bg-white px-4 py-2 font-semibold text-forest hover:border-teal/30" href="#compare-plans">
              Compare plans
            </a>
          </div>
        </div>
      </section>

      <section className="bg-cream py-20 sm:py-28" id="property-management">
        <div className="mx-auto max-w-[1280px] px-6 sm:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold-ink">PROPERTY MANAGEMENT</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-forest sm:text-4xl">
              Plans for landlords and property-management teams.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-600">
              Only property management is billed — listing and searching on the marketplace stay free. Every
              plan starts with a {PM_BILLING_RULES.trialDays}-day free trial when you start managing a property,
              and nothing is charged automatically.
            </p>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {propertyPlans.map((plan) => (
              <PlanCard billingCycle={billingCycle} key={plan.name} plan={plan} />
            ))}
          </div>

          <p className="mt-5 text-xs leading-5 text-slate-600">
            Prices shown in Ghana cedis (GHS), billed monthly. Allowances are monthly; nothing is unlimited.
          </p>
        </div>
      </section>

      <section className="bg-warm-white py-20 sm:py-28" id="professional-marketplace">
        <div className="mx-auto max-w-[1400px] px-6 sm:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold-ink">PROFESSIONAL MARKETPLACE</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-forest sm:text-4xl">
              Plans for agents, brokerages, real-estate companies and developers.
            </h2>
            <p className="mt-4 text-base leading-7 text-muted">
              Build your public presence, publish inventory, manage leads and unlock AI sales capabilities as
              your business grows. The Ghana launch starts with a free professional plan.
            </p>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {professionalPlans.map((plan) => (
              <PlanCard billingCycle={billingCycle} key={plan.name} plan={plan} />
            ))}
          </div>
        </div>
      </section>

      <section className="bg-forest-deep py-20 text-white sm:py-24">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 sm:px-8 lg:grid-cols-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold-soft">01 · CHOOSE YOUR WORKSPACE</p>
            <h3 className="mt-3 text-xl font-semibold">Property operations or professional sales.</h3>
            <p className="mt-3 text-sm leading-6 text-white/60">
              NesAfric separates property-management subscriptions from professional marketplace subscriptions,
              so you pay for the operating model you actually use.
            </p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold-soft">02 · PICK YOUR SCALE</p>
            <h3 className="mt-3 text-xl font-semibold">Limits grow with your business.</h3>
            <p className="mt-3 text-sm leading-6 text-white/60">
              Portfolio size, listings, team members, developments, storage and AI capabilities expand as you
              move into higher tiers.
            </p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold-soft">03 · BILL YOUR WAY</p>
            <h3 className="mt-3 text-xl font-semibold">Monthly flexibility or annual value.</h3>
            <p className="mt-3 text-sm leading-6 text-white/60">
              Monthly plans keep billing flexible. Annual pricing is equivalent to paying for 10 months instead
              of 12.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-cream py-20 sm:py-28" id="compare-plans">
        <div className="mx-auto max-w-[1280px] px-6 sm:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold-ink">DETAILED COMPARISON</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-forest sm:text-4xl">
              See exactly what changes from plan to plan.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-600">
              The tables below focus on the limits and advanced capabilities that differ between tiers.
            </p>
          </div>

          <div className="mt-10">
            <h3 className="mb-4 text-lg font-semibold text-forest">Property Management</h3>
            <ComparisonTable
              headings={["Capability", ...pmPlanList.map((plan) => plan.name)]}
              rows={propertyComparison}
            />
          </div>

          <div className="mt-12">
            <h3 className="mb-4 text-lg font-semibold text-forest">Professional Marketplace</h3>
            <ComparisonTable
              headings={["Capability", "Free", "Pro", "Brokerage", "Enterprise"]}
              rows={professionalComparison}
            />
          </div>
        </div>
      </section>

      <section className="bg-warm-white py-20 sm:py-28">
        <div className="mx-auto max-w-5xl px-6 sm:px-8">
          <div className="rounded-3xl border border-hairline bg-white p-8 shadow-sm sm:p-10">
            <div className="grid gap-8 lg:grid-cols-[1fr_0.9fr] lg:items-center">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold-ink">NOT SURE WHERE TO START?</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-forest">
                  Start with the workspace that matches your business today.
                </h2>
                <p className="mt-4 text-sm leading-6 text-muted">
                  Property owners and managers start with a free trial, then choose Essential, Growth or Enterprise. Real-estate professionals can begin on
                  Marketplace Free during the Ghana launch and move to a paid tier when they need more inventory,
                  team capacity, promotion, analytics or AI sales tools.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
                <Link
                  className="inline-flex items-center justify-center rounded-xl bg-forest px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald"
                  href="/register"
                >
                  Create your account
                </Link>
                <Link
                  className="inline-flex items-center justify-center rounded-xl border border-hairline bg-white px-5 py-3 text-sm font-semibold text-forest transition hover:bg-cream"
                  href="/for-property-owners"
                >
                  Explore solutions
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
