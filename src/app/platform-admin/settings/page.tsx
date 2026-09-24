"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type SettingsSummary = {
  configuration: {
    featureFlags: number;
    featureFlagOverrides: number;
    subscriptionPlans: number;
    publicSubscriptionPlans: number;
    marketplacePlans: number;
    publicMarketplacePlans: number;
    activeCountries: number;
    activeCurrencies: number;
  };
  platformAccess: {
    byStatus: Record<string, number>;
    byRole: Record<string, number>;
  };
};

function SettingsContent() {
  const [data, setData] = useState<SettingsSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/platform-admin/settings", {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.error?.message ?? "Unable to load platform settings.",
          );
        }

        return body as SettingsSummary;
      })
      .then((body) => {
        setData(body);
        setError("");
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load platform settings.",
        );
      });

    return () => controller.abort();
  }, []);

  return (
    <div className="grid gap-7">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
          Platform configuration
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-forest">
          Platform Settings
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          A consolidated view of NesAfric&apos;s real configuration surfaces.
          Configuration remains owned by the existing plans, feature flags,
          infrastructure and platform-access systems rather than a duplicate
          generic settings table.
        </p>
      </section>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {error}
        </p>
      )}

      {!data ? (
        <p className="text-sm text-muted">Loading platform settings…</p>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Link
              className="rounded-2xl border border-hairline bg-white p-5 shadow-card transition hover:border-teal"
              href="/platform-admin/plans"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                PropertyOS plans
              </p>
              <p className="mt-2 text-3xl font-semibold text-forest">
                {data.configuration.subscriptionPlans}
              </p>
              <p className="mt-1 text-xs text-muted">
                {data.configuration.publicSubscriptionPlans} public
              </p>
              <p className="mt-4 text-sm font-semibold text-teal">
                Manage plans & entitlements →
              </p>
            </Link>

            <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Marketplace plans
              </p>
              <p className="mt-2 text-3xl font-semibold text-forest">
                {data.configuration.marketplacePlans}
              </p>
              <p className="mt-1 text-xs text-muted">
                {data.configuration.publicMarketplacePlans} public
              </p>
              <p className="mt-4 text-xs leading-5 text-muted">
                Marketplace Professional subscriptions remain a separate
                commercial domain from PropertyOS management subscriptions.
              </p>
            </div>

            <Link
              className="rounded-2xl border border-hairline bg-white p-5 shadow-card transition hover:border-teal"
              href="/platform-admin/flags"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Feature flags
              </p>
              <p className="mt-2 text-3xl font-semibold text-forest">
                {data.configuration.featureFlags}
              </p>
              <p className="mt-1 text-xs text-muted">
                {data.configuration.featureFlagOverrides} organisation
                overrides
              </p>
              <p className="mt-4 text-sm font-semibold text-teal">
                Open feature flags →
              </p>
            </Link>

            <Link
              className="rounded-2xl border border-hairline bg-white p-5 shadow-card transition hover:border-teal"
              href="/platform-admin/system"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Infrastructure
              </p>
              <p className="mt-2 text-lg font-semibold text-forest">
                Runtime readiness
              </p>
              <p className="mt-2 text-xs leading-5 text-muted">
                Providers, database, storage, communications, payments,
                AI and background operations.
              </p>
              <p className="mt-4 text-sm font-semibold text-teal">
                Open system health →
              </p>
            </Link>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Geographic configuration
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-warm-white p-4">
                  <p className="text-xs text-muted">Active countries</p>
                  <p className="mt-1 text-2xl font-semibold text-forest">
                    {data.configuration.activeCountries}
                  </p>
                </div>

                <div className="rounded-xl bg-warm-white p-4">
                  <p className="text-xs text-muted">Active currencies</p>
                  <p className="mt-1 text-2xl font-semibold text-forest">
                    {data.configuration.activeCurrencies}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Platform access
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {Object.entries(data.platformAccess.byRole).map(
                  ([role, count]) => (
                    <div
                      className="rounded-xl bg-warm-white p-4"
                      key={role}
                    >
                      <p className="text-xs text-muted">
                        {role.replaceAll("_", " ")}
                      </p>
                      <p className="mt-1 text-xl font-semibold text-forest">
                        {count}
                      </p>
                    </div>
                  ),
                )}
              </div>

              <p className="mt-4 text-xs leading-5 text-muted">
                Platform access remains independent from organisation OWNER /
                ADMIN membership and is provisioned through the existing
                controlled bootstrap process.
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-hairline bg-forest-deep p-6 text-white shadow-card">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-soft">
              Configuration safety
            </p>
            <h3 className="mt-2 text-lg font-semibold">
              Secrets are not editable from this console
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/65">
              API credentials, database URLs, webhook secrets, private storage
              configuration and provider tokens remain deployment-level
              secrets. This page deliberately does not read or expose their
              values.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

export default function PlatformAdminSettingsPage() {
  return (
    <PlatformAdminShell>
      <SettingsContent />
    </PlatformAdminShell>
  );
}
