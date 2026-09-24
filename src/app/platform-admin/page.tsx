"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type Analytics = {
  totalOrganisations: number;
  recentSignups30d: number;
  statusCounts: Record<string, number>;
  planCounts: Array<{
    planKey: string;
    planName: string;
    count: number;
  }>;
  mrrByCurrency: Record<string, string>;
  arrByCurrency: Record<string, string>;
  trialsStarted: number;
  trialsConverted: number;
  cancellations30d: number;
};

type Overview = {
  kpis: {
    totalUsers: number;
    totalOrganisations: number;
    activeSubscriptions: number;
    totalProperties: number;
    totalUnits: number;
    activeLeases: number;
    publishedListings: number;
    verifiedProfessionals: number;
    verifiedProviders: number;
    openMaintenance: number;
    unresolvedAIEscalations: number;
    criticalAIEscalations: number;
    failedPayments: number;
    pastDueSubscriptions: number;
  };
  recentAudit: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    organisationId: string | null;
    createdAt: string;
    platformPrincipal: {
      role: string;
      user: {
        displayName: string;
      };
    } | null;
  }>;
};

function money(amountMinor: string, currency: string) {
  try {
    return new Intl.NumberFormat("en-GH", {
      style: "currency",
      currency,
    }).format(Number(amountMinor) / 100);
  } catch {
    return `${currency} ${(Number(amountMinor) / 100).toFixed(2)}`;
  }
}

function OverviewContent() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      fetch("/api/platform-admin/analytics", {
        signal: controller.signal,
      }).then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.error?.message ?? "Unable to load commercial analytics.",
          );
        }

        return body as Analytics;
      }),

      fetch("/api/platform-admin/overview", {
        signal: controller.signal,
      }).then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.error?.message ?? "Unable to load platform overview.",
          );
        }

        return body as Overview;
      }),
    ])
      .then(([analyticsBody, overviewBody]) => {
        setAnalytics(analyticsBody);
        setOverview(overviewBody);
        setError("");
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load platform overview.",
        );
      });

    return () => controller.abort();
  }, []);

  if (error) {
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        {error}
      </p>
    );
  }

  if (!analytics || !overview) {
    return <p className="text-sm text-muted">Loading platform overview…</p>;
  }

  const currencies = [
    ...new Set([
      ...Object.keys(analytics.mrrByCurrency),
      ...Object.keys(analytics.arrByCurrency),
    ]),
  ];

  const kpis = overview.kpis;

  return (
    <div className="grid gap-7">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
            Executive control plane
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-forest">
            NesAfric Platform Overview
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Real platform data across customers, property operations,
            marketplace activity, subscriptions, payments and AI operations.
          </p>
        </div>

        <Link
          className="rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white"
          href="/platform-admin/system"
        >
          System health
        </Link>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Organisations", kpis.totalOrganisations],
          ["Users", kpis.totalUsers],
          ["Active subscriptions", kpis.activeSubscriptions],
          ["Properties", kpis.totalProperties],
          ["Units", kpis.totalUnits],
          ["Active leases", kpis.activeLeases],
          ["Published listings", kpis.publishedListings],
          ["Open maintenance", kpis.openMaintenance],
        ].map(([label, value]) => (
          <div
            className="rounded-2xl border border-hairline bg-white p-5 shadow-card"
            key={String(label)}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              {label}
            </p>
            <p className="mt-2 text-3xl font-semibold text-forest">
              {value}
            </p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Marketplace trust
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-warm-white p-4">
              <p className="text-xs text-muted">Verified professionals</p>
              <p className="mt-1 text-2xl font-semibold text-forest">
                {kpis.verifiedProfessionals}
              </p>
            </div>

            <div className="rounded-xl bg-warm-white p-4">
              <p className="text-xs text-muted">Verified providers</p>
              <p className="mt-1 text-2xl font-semibold text-forest">
                {kpis.verifiedProviders}
              </p>
            </div>
          </div>

          <Link
            className="mt-5 inline-flex text-sm font-semibold text-teal"
            href="/platform-admin/marketplace"
          >
            Marketplace control center →
          </Link>
        </div>

        <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Billing attention
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-warm-white p-4">
              <p className="text-xs text-muted">Failed payments</p>
              <p className="mt-1 text-2xl font-semibold text-forest">
                {kpis.failedPayments}
              </p>
            </div>

            <div className="rounded-xl bg-warm-white p-4">
              <p className="text-xs text-muted">Past due / grace</p>
              <p className="mt-1 text-2xl font-semibold text-forest">
                {kpis.pastDueSubscriptions}
              </p>
            </div>
          </div>

          <Link
            className="mt-5 inline-flex text-sm font-semibold text-teal"
            href="/platform-admin/payments"
          >
            Payment operations →
          </Link>
        </div>

        <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            AI attention
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-warm-white p-4">
              <p className="text-xs text-muted">Open escalations</p>
              <p className="mt-1 text-2xl font-semibold text-forest">
                {kpis.unresolvedAIEscalations}
              </p>
            </div>

            <div className="rounded-xl bg-red-50 p-4">
              <p className="text-xs text-red-700">Critical</p>
              <p className="mt-1 text-2xl font-semibold text-red-900">
                {kpis.criticalAIEscalations}
              </p>
            </div>
          </div>

          <Link
            className="mt-5 inline-flex text-sm font-semibold text-teal"
            href="/platform-admin/ai"
          >
            AI operations →
          </Link>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Commercial health
              </p>
              <h3 className="mt-1 font-semibold text-forest">
                Recurring revenue
              </h3>
            </div>

            <Link
              className="text-xs font-semibold text-teal"
              href="/platform-admin/subscriptions"
            >
              Subscriptions →
            </Link>
          </div>

          {currencies.length ? (
            <div className="mt-4 grid gap-3">
              {currencies.map((currency) => (
                <div
                  className="rounded-xl bg-warm-white p-4"
                  key={currency}
                >
                  <p className="text-xs font-semibold text-muted">
                    {currency}
                  </p>
                  <p className="mt-2 text-sm text-forest">
                    MRR{" "}
                    <strong>
                      {money(
                        analytics.mrrByCurrency[currency] ?? "0",
                        currency,
                      )}
                    </strong>
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    ARR{" "}
                    {money(
                      analytics.arrByCurrency[currency] ?? "0",
                      currency,
                    )}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">
              No paying subscription revenue recorded yet.
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Growth
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-warm-white p-4">
              <p className="text-xs text-muted">New organisations · 30d</p>
              <p className="mt-1 text-2xl font-semibold text-forest">
                {analytics.recentSignups30d}
              </p>
            </div>

            <div className="rounded-xl bg-warm-white p-4">
              <p className="text-xs text-muted">Cancellations · 30d</p>
              <p className="mt-1 text-2xl font-semibold text-forest">
                {analytics.cancellations30d}
              </p>
            </div>

            <div className="rounded-xl bg-warm-white p-4">
              <p className="text-xs text-muted">Trials started</p>
              <p className="mt-1 text-2xl font-semibold text-forest">
                {analytics.trialsStarted}
              </p>
            </div>

            <div className="rounded-xl bg-warm-white p-4">
              <p className="text-xs text-muted">Trials converted</p>
              <p className="mt-1 text-2xl font-semibold text-forest">
                {analytics.trialsConverted}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-hairline bg-white shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Governance
            </p>
            <h3 className="mt-1 font-semibold text-forest">
              Recent platform activity
            </h3>
          </div>

          <Link
            className="text-xs font-semibold text-teal"
            href="/platform-admin/audit"
          >
            Full audit log →
          </Link>
        </div>

        {!overview.recentAudit.length ? (
          <p className="p-6 text-sm text-muted">
            No platform audit activity yet.
          </p>
        ) : (
          <div className="divide-y divide-hairline">
            {overview.recentAudit.map((entry) => (
              <div
                className="grid gap-2 px-5 py-4 md:grid-cols-[1fr_auto]"
                key={entry.id}
              >
                <div>
                  <p className="text-sm font-semibold text-forest">
                    {entry.action}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {entry.entityType} · {entry.entityId}
                  </p>
                </div>

                <div className="text-xs text-muted md:text-right">
                  <p>
                    {entry.platformPrincipal?.user.displayName ??
                      "Platform system"}
                  </p>
                  <p className="mt-1">
                    {new Date(entry.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function PlatformAdminOverviewPage() {
  return (
    <PlatformAdminShell>
      <OverviewContent />
    </PlatformAdminShell>
  );
}
