"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Detail = {
  id: string; displayName: string; legalName: string | null; type: string; status: string; verificationStatus: string;
  description: string | null; websiteUrl: string | null; contactEmail: string | null; contactPhone: string | null;
  slug: string; specialities: string[]; servicesOffered: string[]; serviceAreas: string[];
  subscription: { status: string; plan: { key: string; name: string } } | null;
  _count: { developments: number; listings: number };
  members: Array<{ id: string; role: string; status: string; user: { displayName: string; email: string } }>;
};

type Entitlements = { status: string; planKey: string; planName: string; features: Array<{ featureKey: string; label: string; kind: string; current: number | null; limit: number | null; isUnlimited: boolean; reached: boolean; booleanValue: boolean | null }> };

type DashboardMetrics = {
  listings: { active: number; draft: number; pendingReview: number; paused: number; total: number };
  newLeads: number;
  upcomingViewings: number;
  teamMembers: number;
  developments: number;
  profileCompletenessPercent: number;
  verificationStatus: string;
  plan: { key: string; name: string; status: string } | null;
};

const VERIFICATION_COPY: Record<string, { label: string; tone: string; message: string }> = {
  UNVERIFIED: { label: "Unverified", tone: "bg-slate-100 text-slate-700", message: "Submit evidence to appear as a verified professional to prospective clients." },
  PENDING: { label: "Verification pending", tone: "bg-amber-50 text-amber-800", message: "Your evidence is under review. This usually takes a few business days." },
  VERIFIED: { label: "Verified", tone: "bg-emerald-50 text-emerald-800", message: "Your profile displays a verified badge publicly." },
  REJECTED: { label: "Verification rejected", tone: "bg-red-50 text-red-800", message: "Your last submission wasn't accepted. Review the details and resubmit." },
  SUSPENDED: { label: "Verification suspended", tone: "bg-red-100 text-red-900", message: "Your verified status has been suspended. Contact support for details." },
};

export function MarketplaceProfileDashboard({ professionalId }: { professionalId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    localStorage.setItem("nesafric.activeMarketplaceProfessionalId", professionalId);
    fetch(`/api/marketplace-professionals/${professionalId}`).then(async (response) => {
      const body = await response.json();
      if (response.ok) setDetail(body);
      else setError(body.error?.message ?? "Unable to load this marketplace profile.");
    });
    fetch(`/api/marketplace-professionals/${professionalId}/dashboard`).then(async (response) => {
      if (response.ok) setMetrics(await response.json());
    });
    fetch(`/api/marketplace-professionals/${professionalId}/entitlements`).then(async (response) => {
      if (response.ok) setEntitlements(await response.json());
    });
  }, [professionalId]);

  async function submitVerification() {
    setError(""); setNotice("");
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/verification`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ evidenceReferences: ["private/evidence/business-registration.pdf"] }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to submit verification.");
    setNotice("Verification submitted for review.");
    setDetail((current) => current && { ...current, verificationStatus: body.verificationStatus });
  }

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>;
  if (!detail) return <p className="text-slate-600">Loading…</p>;

  return (
    <div className="grid gap-6">
      {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{detail.displayName}</h1>
            <p className="mt-1 text-sm text-slate-500">{detail.type.replaceAll("_", " ")} · {detail.status}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${VERIFICATION_COPY[detail.verificationStatus]?.tone ?? "bg-slate-100 text-slate-700"}`}>
            {VERIFICATION_COPY[detail.verificationStatus]?.label ?? detail.verificationStatus}
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-500">{VERIFICATION_COPY[detail.verificationStatus]?.message}</p>
        {detail.description && <p className="mt-4 text-slate-700">{detail.description}</p>}
        <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-600">
          {detail.websiteUrl && <span>{detail.websiteUrl}</span>}
          {detail.contactEmail && <span>{detail.contactEmail}</span>}
          {detail.contactPhone && <span>{detail.contactPhone}</span>}
        </div>
        <Link className="mt-4 inline-block text-sm font-semibold text-emerald-700" href={`/marketplace/professionals/${detail.slug}`}>
          View public profile →
        </Link>
        {detail.verificationStatus === "UNVERIFIED" && (
          <button className="mt-4 block rounded-lg border px-4 py-2 text-sm font-semibold" onClick={() => void submitVerification()} type="button">
            Submit for verification
          </button>
        )}
      </section>

      {!metrics ? (
        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Team members</p><p className="mt-2 text-3xl font-semibold">{detail.members.length}</p></div>
          <div className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Developments</p><p className="mt-2 text-3xl font-semibold">{detail._count.developments}</p></div>
          <div className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Listings</p><p className="mt-2 text-3xl font-semibold">{detail._count.listings}</p></div>
        </section>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-600">Active listings</p>
              <p className="mt-2 text-3xl font-semibold">{metrics.listings.active}</p>
              <p className="mt-1 text-xs text-slate-400">{metrics.listings.draft} draft · {metrics.listings.pendingReview} in review · {metrics.listings.paused} paused</p>
            </div>
            <div className="rounded-xl border bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-600">New leads</p>
              <p className="mt-2 text-3xl font-semibold">{metrics.newLeads}</p>
              <Link className="mt-1 inline-block text-xs font-semibold text-emerald-700" href={`/pro/${professionalId}/leads`}>View inbox →</Link>
            </div>
            <div className="rounded-xl border bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-600">Upcoming viewings</p>
              <p className="mt-2 text-3xl font-semibold">{metrics.upcomingViewings}</p>
            </div>
            <div className="rounded-xl border bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-600">Profile completeness</p>
              <p className="mt-2 text-3xl font-semibold">{metrics.profileCompletenessPercent}%</p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${metrics.profileCompletenessPercent}%` }} />
              </div>
            </div>
          </section>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Team members</p><p className="mt-2 text-3xl font-semibold">{metrics.teamMembers}</p></div>
            <div className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Developments</p><p className="mt-2 text-3xl font-semibold">{metrics.developments}</p></div>
            <div className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Total listings</p><p className="mt-2 text-3xl font-semibold">{metrics.listings.total}</p></div>
          </section>
        </>
      )}

      {entitlements && (
        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Plan &amp; entitlements</h2>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">{entitlements.planName} · {entitlements.status}</span>
          </div>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            {entitlements.features.map((feature) => (
              <div className="flex justify-between rounded-lg border px-3 py-2" key={feature.featureKey}>
                <dt className="text-slate-600">{feature.label}</dt>
                <dd className={`font-medium ${feature.reached ? "text-red-700" : "text-slate-800"}`}>
                  {feature.kind === "BOOLEAN" ? (feature.booleanValue ? "Enabled" : "Disabled") : `${feature.current ?? 0} / ${feature.isUnlimited ? "Unlimited" : feature.limit}`}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
