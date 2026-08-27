"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Dashboard = { properties: Array<{ id: string; name: string; referenceNumber: string; category: string; status: string }>; units: number; members: number };
type CollectionMetrics = { currencyCode: string | null; chargedAmountMinor: string; collectedAmountMinor: string; outstandingAmountMinor: string };
type MaintenanceMetrics = { open: number; byStatus: Record<string, number>; openByPriority: Record<string, number> };
type OnboardingStep = { key: string; label: string; done: boolean };
type Onboarding = { steps: OnboardingStep[]; optionalSteps: OnboardingStep[]; complete: boolean };
type BillingSummary = { status: string; cancelAtPeriodEnd: boolean; features: Array<{ label: string; reached: boolean; approaching: boolean }> };
type Opportunity = { key: string; tone: "info" | "upgrade"; message: string; href: string };

const READ_ONLY_STATUSES = new Set(["SUSPENDED", "CANCELLED"]);

export function DashboardContent() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [collection, setCollection] = useState<CollectionMetrics | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceMetrics | null>(null);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [error, setError] = useState("");
  const [noOrganisation, setNoOrganisation] = useState(false);
  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    fetch("/api/dashboard", { headers: { "x-organisation-id": organisationId ?? "" } }).then(async (response) => {
      if (response.ok) return setData(await response.json());
      const body = await response.json();
      if (body.error?.code === "ORGANISATION_REQUIRED") return setNoOrganisation(true);
      setError(body.error?.message ?? "Unable to load dashboard.");
    });
    fetch("/api/rent-collection/metrics", { headers: { "x-organisation-id": organisationId ?? "" } }).then(async (response) => { if (response.ok) setCollection(await response.json()); });
    fetch("/api/maintenance/dashboard", { headers: { "x-organisation-id": organisationId ?? "" } }).then(async (response) => { if (response.ok) setMaintenance(await response.json()); });
    fetch("/api/organisations/" + organisationId + "/onboarding", { headers: { "x-organisation-id": organisationId ?? "" } }).then(async (response) => { if (response.ok) setOnboarding(await response.json()); });
    fetch("/api/organisations/" + organisationId + "/billing", { headers: { "x-organisation-id": organisationId ?? "" } }).then(async (response) => { if (response.ok) setBilling(await response.json()); });
    fetch("/api/organisations/" + organisationId + "/dashboard-opportunities", { headers: { "x-organisation-id": organisationId ?? "" } }).then(async (response) => { if (response.ok) setOpportunities((await response.json()).opportunities); });
  }, []);
  if (noOrganisation) return <section className="mt-8 rounded-xl border bg-white p-6 text-center shadow-sm">
    <h2 className="font-semibold">Set up your PropertyOS organisation</h2>
    <p className="mt-2 text-sm text-slate-600">This is where your properties, tenants, leases and rent collection will live. You don&apos;t have an organisation yet — create one to get started.</p>
    <Link className="mt-4 inline-block rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white" href="/onboarding">Create your organisation</Link>
  </section>;
  if (error) return <p className="mt-8 rounded border border-amber-200 bg-amber-50 p-4 text-amber-900">{error}</p>;
  if (!data) return <p className="mt-8 text-slate-600">Loading organisation dashboard...</p>;
  const collectionMoney = (value: string) => collection?.currencyCode ? new Intl.NumberFormat("en-GH", { style: "currency", currency: collection.currencyCode }).format(Number(value) / 100) : "—";
  const reachedFeatures = billing?.features.filter((feature) => feature.reached) ?? [];
  const approachingFeatures = billing?.features.filter((feature) => feature.approaching && !feature.reached) ?? [];
  return <>
    {billing && READ_ONLY_STATUSES.has(billing.status) && <p className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">This organisation&apos;s subscription is {billing.status.toLowerCase()}. Existing data remains fully accessible, but new changes are blocked. <Link className="font-semibold underline" href="/settings/billing">Resolve billing →</Link></p>}
    {billing && billing.cancelAtPeriodEnd && !READ_ONLY_STATUSES.has(billing.status) && <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">This subscription is scheduled to cancel at the end of the current billing period. <Link className="font-semibold underline" href="/settings/billing">Manage billing →</Link></p>}
    {reachedFeatures.length > 0 && <p className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">Plan limit reached for: {reachedFeatures.map((feature) => feature.label).join(", ")}. <Link className="font-semibold underline" href="/settings/billing">Upgrade →</Link></p>}
    {reachedFeatures.length === 0 && approachingFeatures.length > 0 && <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Approaching plan limit for: {approachingFeatures.map((feature) => feature.label).join(", ")}. <Link className="font-semibold underline" href="/settings/billing">View usage →</Link></p>}
    {opportunities.length > 0 && <ul className="mt-6 grid gap-1.5">{opportunities.map((opportunity) => <li key={opportunity.key}><Link className={`block rounded-lg border px-4 py-2 text-sm ${opportunity.tone === "upgrade" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-slate-50 text-slate-700"}`} href={opportunity.href}>{opportunity.message}</Link></li>)}</ul>}
    {onboarding && !onboarding.complete && <section className="mt-6 rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Get set up</h2>
      <ul className="mt-3 grid gap-2 text-sm">
        {onboarding.steps.map((step) => <li className="flex items-center gap-2" key={step.key}><span className={step.done ? "text-emerald-600" : "text-slate-500"}>{step.done ? "✓" : "○"}</span><span className={step.done ? "text-slate-500 line-through" : ""}>{step.label}</span></li>)}
        {onboarding.optionalSteps.map((step) => <li className="flex items-center gap-2 text-slate-500" key={step.key}><span>{step.done ? "✓" : "○"}</span><span>{step.label} (optional)</span></li>)}
      </ul>
    </section>}
    <section className="mt-8 grid gap-4 md:grid-cols-3">{[["Properties", data.properties.length], ["Units", data.units], ["Team members", data.members]].map(([label, value]) => <div className="rounded-xl border bg-white p-5 shadow-sm" key={String(label)}><p className="text-sm text-slate-600">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>)}</section>{collection && <section className="mt-8 grid gap-4 md:grid-cols-3">{[["Expected rent", collection.chargedAmountMinor], ["Collected rent", collection.collectedAmountMinor], ["Outstanding rent", collection.outstandingAmountMinor]].map(([label, value]) => <Link className="rounded-xl border bg-white p-5 shadow-sm" href="/payments" key={label}><p className="text-sm text-slate-600">{label}</p><p className="mt-2 text-2xl font-semibold">{collectionMoney(value)}</p></Link>)}</section>}{maintenance && <section className="mt-8 grid gap-4 md:grid-cols-3">{[["Open maintenance", maintenance.open], ["Emergency issues", maintenance.openByPriority.EMERGENCY ?? 0], ["Work in progress", maintenance.byStatus.IN_PROGRESS ?? 0]].map(([label, value]) => <Link className="rounded-xl border bg-white p-5 shadow-sm" href="/maintenance" key={label}><p className="text-sm text-slate-600">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></Link>)}</section>}<section className="mt-8 rounded-xl border p-6"><h2 className="font-semibold">Recent properties</h2>{data.properties.length ? <ul className="mt-3 divide-y">{data.properties.map((property) => <li className="flex justify-between py-3" key={property.id}><span>{property.name}<span className="ml-2 text-sm text-slate-500">{property.referenceNumber}</span></span><span className="flex items-center gap-3 text-sm text-slate-600"><Link className="font-semibold text-emerald-700" href={`/maintenance/properties/${property.id}`}>Maintenance</Link>{property.category}</span></li>)}</ul> : <p className="mt-2 text-slate-600">No properties yet. <Link className="font-semibold text-emerald-700" href="/properties/new">Add your first property.</Link></p>}</section></>;
}
