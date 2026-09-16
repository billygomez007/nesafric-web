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
  UNVERIFIED: { label: "Unverified", tone: "bg-surface text-ink", message: "Submit evidence to appear as a verified professional to prospective clients." },
  PENDING: { label: "Verification pending", tone: "bg-gold/10 text-ink", message: "Your evidence is under review. This usually takes a few business days." },
  VERIFIED: { label: "Verified", tone: "bg-teal/10 text-teal", message: "Your profile displays a verified badge publicly." },
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

  if (error) return <p className="rounded-xl border border-hairline border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>;
  if (!detail) return <p className="text-muted">Loading…</p>;

  return (
    <div className="grid gap-6">
      {notice && <p className="rounded-lg bg-teal/10 p-3 text-sm text-teal">{notice}</p>}
      <section className="rounded-xl border border-hairline border-hairline bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{detail.displayName}</h1>
            <p className="mt-1 text-sm text-muted">{detail.type.replaceAll("_", " ")} · {detail.status}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${VERIFICATION_COPY[detail.verificationStatus]?.tone ?? "bg-surface text-ink"}`}>
            {VERIFICATION_COPY[detail.verificationStatus]?.label ?? detail.verificationStatus}
          </span>
        </div>
        <p className="mt-2 text-sm text-muted">{VERIFICATION_COPY[detail.verificationStatus]?.message}</p>
        {detail.description && <p className="mt-4 text-ink">{detail.description}</p>}
        <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted">
          {detail.websiteUrl && <span>{detail.websiteUrl}</span>}
          {detail.contactEmail && <span>{detail.contactEmail}</span>}
          {detail.contactPhone && <span>{detail.contactPhone}</span>}
        </div>
        <Link className="mt-4 inline-block text-sm font-semibold text-teal" href={`/marketplace/professionals/${detail.slug}`}>
          View public profile →
        </Link>
        {detail.verificationStatus === "UNVERIFIED" && (
          <button className="mt-4 block rounded-xl border border-hairline px-4 py-2 text-sm font-semibold" onClick={() => void submitVerification()} type="button">
            Submit for verification
          </button>
        )}
      </section>

      {!metrics ? (
        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-hairline border-hairline bg-white p-5 shadow-sm"><p className="text-sm text-muted">Team members</p><p className="mt-2 text-3xl font-semibold">{detail.members.length}</p></div>
          <div className="rounded-xl border border-hairline border-hairline bg-white p-5 shadow-sm"><p className="text-sm text-muted">Developments</p><p className="mt-2 text-3xl font-semibold">{detail._count.developments}</p></div>
          <div className="rounded-xl border border-hairline border-hairline bg-white p-5 shadow-sm"><p className="text-sm text-muted">Listings</p><p className="mt-2 text-3xl font-semibold">{detail._count.listings}</p></div>
        </section>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-hairline border-hairline bg-white p-5 shadow-sm">
              <p className="text-sm text-muted">Active listings</p>
              <p className="mt-2 text-3xl font-semibold">{metrics.listings.active}</p>
              <p className="mt-1 text-xs text-muted">{metrics.listings.draft} draft · {metrics.listings.pendingReview} in review · {metrics.listings.paused} paused</p>
            </div>
            <div className="rounded-xl border border-hairline border-hairline bg-white p-5 shadow-sm">
              <p className="text-sm text-muted">New leads</p>
              <p className="mt-2 text-3xl font-semibold">{metrics.newLeads}</p>
              <Link className="mt-1 inline-block text-xs font-semibold text-teal" href={`/pro/${professionalId}/leads`}>View inbox →</Link>
            </div>
            <div className="rounded-xl border border-hairline border-hairline bg-white p-5 shadow-sm">
              <p className="text-sm text-muted">Upcoming viewings</p>
              <p className="mt-2 text-3xl font-semibold">{metrics.upcomingViewings}</p>
            </div>
            <div className="rounded-xl border border-hairline border-hairline bg-white p-5 shadow-sm">
              <p className="text-sm text-muted">Profile completeness</p>
              <p className="mt-2 text-3xl font-semibold">{metrics.profileCompletenessPercent}%</p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface">
                <div className="h-full rounded-full bg-teal/100" style={{ width: `${metrics.profileCompletenessPercent}%` }} />
              </div>
            </div>
          </section>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-hairline border-hairline bg-white p-5 shadow-sm"><p className="text-sm text-muted">Team members</p><p className="mt-2 text-3xl font-semibold">{metrics.teamMembers}</p></div>
            <div className="rounded-xl border border-hairline border-hairline bg-white p-5 shadow-sm"><p className="text-sm text-muted">Developments</p><p className="mt-2 text-3xl font-semibold">{metrics.developments}</p></div>
            <div className="rounded-xl border border-hairline border-hairline bg-white p-5 shadow-sm"><p className="text-sm text-muted">Total listings</p><p className="mt-2 text-3xl font-semibold">{metrics.listings.total}</p></div>
          </section>
        </>
      )}

      {entitlements && (
        <section className="rounded-2xl border border-forest bg-forest p-6 text-white shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-soft">Marketplace workspace</p><h2 className="mt-2 text-xl font-semibold">{entitlements.planName}</h2><p className="mt-1 text-sm text-white/65">This subscription is separate from PropertyOS billing.</p></div>
            <span className="rounded-full bg-teal/20 px-3 py-1 text-xs font-semibold text-white">{entitlements.status.replaceAll("_", " ")}</span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {entitlements.features.map((feature) => (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4" key={feature.featureKey}>
                <div className="flex items-start justify-between gap-3"><p className="text-sm font-semibold">{feature.label}</p>{feature.reached && <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[11px] font-semibold text-gold-soft">At limit</span>}</div>
                <p className="mt-2 text-sm text-white/70">{feature.kind === "BOOLEAN" ? (feature.booleanValue ? "Included" : "Not included on this plan") : !feature.isUnlimited && feature.limit === 0 ? "Not included on this plan" : feature.isUnlimited ? `${feature.current ?? 0} used · No configured limit` : `${feature.current ?? 0} / ${feature.limit}`}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
