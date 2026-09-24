"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  DashboardIcon,
  DashboardPanel,
  DashboardStat,
  ProgressBar,
  StatusBadge,
} from "@/components/dashboard-ui";

type Detail = {
  id: string;
  displayName: string;
  legalName: string | null;
  type: string;
  status: string;
  verificationStatus: string;
  description: string | null;
  websiteUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  slug: string;
  specialities: string[];
  servicesOffered: string[];
  serviceAreas: string[];
  subscription: {
    status: string;
    plan: { key: string; name: string };
  } | null;
  _count: {
    developments: number;
    listings: number;
  };
  members: Array<{
    id: string;
    role: string;
    status: string;
    user: {
      displayName: string;
      email: string;
    };
  }>;
};

type Entitlements = {
  status: string;
  planKey: string;
  planName: string;
  features: Array<{
    featureKey: string;
    label: string;
    kind: string;
    current: number | null;
    limit: number | null;
    isUnlimited: boolean;
    reached: boolean;
    booleanValue: boolean | null;
  }>;
};

type DashboardMetrics = {
  listings: {
    active: number;
    draft: number;
    pendingReview: number;
    paused: number;
    total: number;
  };
  newLeads: number;
  upcomingViewings: number;
  teamMembers: number;
  developments: number;
  profileCompletenessPercent: number;
  verificationStatus: string;
  plan: {
    key: string;
    name: string;
    status: string;
  } | null;
};

function getTimeGreeting() {
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

const VERIFICATION: Record<
  string,
  { label: string; tone: "neutral" | "success" | "warning" | "danger" }
> = {
  UNVERIFIED: { label: "Unverified", tone: "neutral" },
  PENDING: { label: "Verification pending", tone: "warning" },
  VERIFIED: { label: "Verified", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  SUSPENDED: { label: "Suspended", tone: "danger" },
};

export function MarketplaceProfileDashboard({
  professionalId,
}: {
  professionalId: string;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    localStorage.setItem(
      "nesafric.activeMarketplaceProfessionalId",
      professionalId,
    );

    fetch(`/api/marketplace-professionals/${professionalId}`).then(
      async (response) => {
        const body = await response.json();

        if (response.ok) {
          setDetail(body);
        } else {
          setError(
            body.error?.message ??
              "Unable to load this professional workspace.",
          );
        }
      },
    );

    fetch(
      `/api/marketplace-professionals/${professionalId}/dashboard`,
    ).then(async (response) => {
      if (response.ok) setMetrics(await response.json());
    });

    fetch(
      `/api/marketplace-professionals/${professionalId}/entitlements`,
    ).then(async (response) => {
      if (response.ok) setEntitlements(await response.json());
    });
  }, [professionalId]);

  const verification = detail
    ? VERIFICATION[detail.verificationStatus] ?? {
        label: detail.verificationStatus,
        tone: "neutral" as const,
      }
    : null;

  const listingHealth = useMemo(() => {
    if (!metrics || metrics.listings.total === 0) return 0;

    return Math.round(
      (metrics.listings.active / metrics.listings.total) * 100,
    );
  }, [metrics]);

  async function submitVerification() {
    setError("");
    setNotice("");

    const response = await fetch(
      `/api/marketplace-professionals/${professionalId}/verification`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          evidenceReferences: [
            "private/evidence/business-registration.pdf",
          ],
        }),
      },
    );

    const body = await response.json();

    if (!response.ok) {
      setError(
        body.error?.message ?? "Unable to submit verification.",
      );
      return;
    }

    setNotice("Verification submitted successfully.");

    setDetail((current) =>
      current
        ? {
            ...current,
            verificationStatus: body.verificationStatus,
          }
        : current,
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        {error}
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div
            className="h-40 animate-pulse rounded-[22px] border border-hairline bg-white"
            key={item}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {notice && (
        <div className="rounded-2xl border border-teal/15 bg-teal/5 px-4 py-3 text-sm text-forest">
          {notice}
        </div>
      )}

      <section className="relative overflow-hidden rounded-[30px] bg-forest-deep px-6 py-7 text-white shadow-[0_22px_60px_rgba(16,45,42,0.16)] sm:px-8 sm:py-8">
        <div className="absolute -right-12 -top-16 h-64 w-64 rounded-full bg-teal/15 blur-3xl" />
        <div className="absolute -bottom-28 right-40 h-64 w-64 rounded-full bg-gold/10 blur-3xl" />

        <div className="relative flex flex-col justify-between gap-7 xl:flex-row xl:items-end">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-teal-light">
                PROFESSIONAL MANAGEMENT
              </p>

              {verification && (
                <StatusBadge tone={verification.tone}>
                  {verification.label}
                </StatusBadge>
              )}
            </div>

            <p className="mt-3 text-sm font-medium text-white/60">
              {getTimeGreeting()}
            </p>

            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.045em] sm:text-[38px]">
              {detail.displayName}
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/65">
              Manage listings, leads, developments, viewings, promotions and
              your professional team from one workspace.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-forest"
                href={`/pro/${professionalId}/listings/new`}
              >
                + New listing
              </Link>

              <Link
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white"
                href={`/pro/${professionalId}/leads`}
              >
                Open lead inbox
              </Link>

              <Link
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white"
                href={`/marketplace/professionals/${detail.slug}`}
              >
                Public profile
              </Link>
            </div>
          </div>

          <div className="min-w-[260px] rounded-2xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="text-xs text-white/50">
                Profile completeness
              </p>
              <p className="text-sm font-semibold">
                {metrics?.profileCompletenessPercent ?? 0}%
              </p>
            </div>

            <ProgressBar
              className="mt-3 bg-white/10"
              value={metrics?.profileCompletenessPercent ?? 0}
            />

            <p className="mt-4 text-xs leading-5 text-white/50">
              Complete your profile and verification to build trust and improve
              marketplace visibility.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardStat
          href={`/pro/${professionalId}/listings`}
          helper={`${metrics?.listings.draft ?? 0} draft · ${metrics?.listings.pendingReview ?? 0} in review`}
          icon={<DashboardIcon name="listing" />}
          label="Active listings"
          tone="teal"
          value={metrics?.listings.active ?? detail._count.listings}
        />

        <DashboardStat
          href={`/pro/${professionalId}/leads`}
          helper="New opportunities awaiting action"
          icon={<DashboardIcon name="leads" />}
          label="New leads"
          tone="gold"
          value={metrics?.newLeads ?? 0}
        />

        <DashboardStat
          href={`/pro/${professionalId}/leads`}
          helper="Scheduled client appointments"
          icon={<DashboardIcon name="calendar" />}
          label="Upcoming viewings"
          tone="forest"
          value={metrics?.upcomingViewings ?? 0}
        />

        <DashboardStat
          href={`/pro/${professionalId}/developments`}
          helper={`${metrics?.teamMembers ?? detail.members.length} team members`}
          icon={<DashboardIcon name="building" />}
          label="Developments"
          tone="teal"
          value={metrics?.developments ?? detail._count.developments}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <DashboardPanel
          action={
            <Link
              className="text-xs font-semibold text-teal"
              href={`/pro/${professionalId}/listings`}
            >
              Manage listings →
            </Link>
          }
          description="Visibility and publishing health across your current inventory."
          title="Listing performance"
        >
          <div className="p-5 sm:p-6">
            <div className="flex items-end justify-between gap-5">
              <div>
                <p className="text-xs text-muted">Active listing ratio</p>
                <p className="mt-1 text-[38px] font-semibold tracking-[-0.05em] text-ink">
                  {listingHealth}%
                </p>
              </div>

              <StatusBadge tone={listingHealth >= 70 ? "success" : "warning"}>
                {listingHealth >= 70 ? "Healthy" : "Needs attention"}
              </StatusBadge>
            </div>

            <ProgressBar className="mt-5" value={listingHealth} />

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl bg-teal/5 p-4">
                <p className="text-[11px] text-muted">Active</p>
                <p className="mt-1 text-xl font-semibold text-ink">
                  {metrics?.listings.active ?? 0}
                </p>
              </div>

              <div className="rounded-2xl bg-surface p-4">
                <p className="text-[11px] text-muted">Draft</p>
                <p className="mt-1 text-xl font-semibold text-ink">
                  {metrics?.listings.draft ?? 0}
                </p>
              </div>

              <div className="rounded-2xl bg-gold/10 p-4">
                <p className="text-[11px] text-muted">In review</p>
                <p className="mt-1 text-xl font-semibold text-ink">
                  {metrics?.listings.pendingReview ?? 0}
                </p>
              </div>

              <div className="rounded-2xl bg-surface p-4">
                <p className="text-[11px] text-muted">Paused</p>
                <p className="mt-1 text-xl font-semibold text-ink">
                  {metrics?.listings.paused ?? 0}
                </p>
              </div>
            </div>
          </div>
        </DashboardPanel>

        <DashboardPanel
          description="Key business signals for your marketplace presence."
          title="Business health"
        >
          <div className="space-y-3 p-5 sm:p-6">
            <div className="flex items-center justify-between rounded-2xl bg-surface p-4">
              <div>
                <p className="text-xs text-muted">Verification</p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {verification?.label}
                </p>
              </div>

              {detail.verificationStatus === "UNVERIFIED" ? (
                <button
                  className="rounded-xl bg-forest px-3 py-2 text-xs font-semibold text-white"
                  onClick={() => void submitVerification()}
                  type="button"
                >
                  Start verification
                </button>
              ) : (
                <StatusBadge tone={verification?.tone}>
                  {verification?.label}
                </StatusBadge>
              )}
            </div>

            <Link
              className="flex items-center justify-between rounded-2xl bg-surface p-4"
              href={`/pro/${professionalId}/team`}
            >
              <div>
                <p className="text-xs text-muted">Team members</p>
                <p className="mt-1 text-xl font-semibold text-ink">
                  {metrics?.teamMembers ?? detail.members.length}
                </p>
              </div>
              <span className="text-xs font-semibold text-teal">Manage →</span>
            </Link>

            <Link
              className="flex items-center justify-between rounded-2xl bg-forest p-4 text-white"
              href={`/pro/${professionalId}/promotions`}
            >
              <div>
                <p className="text-xs text-white/50">Growth tools</p>
                <p className="mt-1 text-sm font-semibold">
                  Promote your listings
                </p>
              </div>
              <span className="text-xs font-semibold text-teal-light">
                Open →
              </span>
            </Link>
          </div>
        </DashboardPanel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <DashboardPanel
          description="Your public business information."
          title="Professional profile"
        >
          <div className="space-y-4 p-5 sm:p-6">
            <div>
              <p className="text-xs text-muted">Business type</p>
              <p className="mt-1 text-sm font-semibold text-ink">
                {detail.type.replaceAll("_", " ")}
              </p>
            </div>

            {detail.contactEmail && (
              <div>
                <p className="text-xs text-muted">Email</p>
                <p className="mt-1 text-sm font-medium text-ink">
                  {detail.contactEmail}
                </p>
              </div>
            )}

            {detail.contactPhone && (
              <div>
                <p className="text-xs text-muted">Phone</p>
                <p className="mt-1 text-sm font-medium text-ink">
                  {detail.contactPhone}
                </p>
              </div>
            )}

            {detail.serviceAreas.length > 0 && (
              <div>
                <p className="text-xs text-muted">Service areas</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {detail.serviceAreas.slice(0, 6).map((area) => (
                    <span
                      className="rounded-full bg-surface px-3 py-1 text-xs font-medium text-forest"
                      key={area}
                    >
                      {area}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DashboardPanel>

        <DashboardPanel
          description="Your current marketplace subscription and feature availability."
          title="Plan & capacity"
        >
          {!entitlements ? (
            <div className="p-6 text-sm text-muted">
              Subscription information is loading.
            </div>
          ) : (
            <div className="p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-ink">
                    {entitlements.planName}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Marketplace Professional plan
                  </p>
                </div>

                <StatusBadge tone="success">
                  {entitlements.status.replaceAll("_", " ")}
                </StatusBadge>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {entitlements.features.slice(0, 6).map((feature) => (
                  <div
                    className="rounded-2xl border border-hairline bg-surface p-4"
                    key={feature.featureKey}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-ink">
                        {feature.label}
                      </p>

                      {feature.reached && (
                        <StatusBadge tone="warning">At limit</StatusBadge>
                      )}
                    </div>

                    <p className="mt-2 text-xs leading-5 text-muted">
                      {feature.kind === "BOOLEAN"
                        ? feature.booleanValue
                          ? "Included"
                          : "Not included"
                        : feature.isUnlimited
                          ? `${feature.current ?? 0} used · Unlimited`
                          : `${feature.current ?? 0} / ${feature.limit ?? 0} used`}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DashboardPanel>
      </div>
    </div>
  );
}
