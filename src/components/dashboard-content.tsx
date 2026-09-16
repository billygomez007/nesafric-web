"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";

type Property = {
  id: string;
  name: string;
  referenceNumber: string;
  category: string;
  status: string;
};

type Dashboard = {
  properties: Property[];
  units: number;
  members: number;
};

type CollectionMetrics = {
  currencyCode: string | null;
  chargedAmountMinor: string;
  collectedAmountMinor: string;
  outstandingAmountMinor: string;
};

type MaintenanceMetrics = {
  open: number;
  byStatus: Record<string, number>;
  openByPriority: Record<string, number>;
};

type OnboardingStep = {
  key: string;
  label: string;
  done: boolean;
};

type Onboarding = {
  steps: OnboardingStep[];
  optionalSteps: OnboardingStep[];
  complete: boolean;
};

type BillingSummary = {
  status: string;
  cancelAtPeriodEnd: boolean;
  features: Array<{
    label: string;
    reached: boolean;
    approaching: boolean;
  }>;
};

type Opportunity = {
  key: string;
  tone: "info" | "upgrade";
  message: string;
  href: string;
};

const READ_ONLY_STATUSES = new Set(["SUSPENDED", "CANCELLED"]);

const DEVELOPMENT_PREVIEW_DASHBOARD: Dashboard = {
  properties: [
    {
      id: "preview-1",
      name: "The Ridge Apartments",
      referenceNumber: "PROP-001",
      category: "Residential",
      status: "ACTIVE",
    },
    {
      id: "preview-2",
      name: "Accra Business Centre",
      referenceNumber: "PROP-002",
      category: "Commercial",
      status: "ACTIVE",
    },
    {
      id: "preview-3",
      name: "Lakeside Court",
      referenceNumber: "PROP-003",
      category: "Residential",
      status: "ACTIVE",
    },
    {
      id: "preview-4",
      name: "Cantonments Residence",
      referenceNumber: "PROP-004",
      category: "Residential",
      status: "ACTIVE",
    },
    {
      id: "preview-5",
      name: "Airport Heights",
      referenceNumber: "PROP-005",
      category: "Residential",
      status: "ACTIVE",
    },
    {
      id: "preview-6",
      name: "Labone Gardens",
      referenceNumber: "PROP-006",
      category: "Residential",
      status: "ACTIVE",
    },
    {
      id: "preview-7",
      name: "East Legon Court",
      referenceNumber: "PROP-007",
      category: "Residential",
      status: "ACTIVE",
    },
    {
      id: "preview-8",
      name: "Osu Trade Centre",
      referenceNumber: "PROP-008",
      category: "Commercial",
      status: "ACTIVE",
    },
    {
      id: "preview-9",
      name: "Spintex Business Park",
      referenceNumber: "PROP-009",
      category: "Commercial",
      status: "ACTIVE",
    },
    {
      id: "preview-10",
      name: "Adenta Residence",
      referenceNumber: "PROP-010",
      category: "Residential",
      status: "ACTIVE",
    },
    {
      id: "preview-11",
      name: "Prampram Land",
      referenceNumber: "PROP-011",
      category: "Land",
      status: "ACTIVE",
    },
    {
      id: "preview-12",
      name: "Airport Mixed Use",
      referenceNumber: "PROP-012",
      category: "Mixed use",
      status: "ACTIVE",
    },
  ],
  units: 48,
  members: 4,
};

const DEVELOPMENT_PREVIEW_COLLECTION: CollectionMetrics = {
  currencyCode: "GHS",
  chargedAmountMinor: "3750000",
  collectedAmountMinor: "2850000",
  outstandingAmountMinor: "900000",
};

const DEVELOPMENT_PREVIEW_MAINTENANCE: MaintenanceMetrics = {
  open: 5,
  byStatus: {
    IN_PROGRESS: 3,
  },
  openByPriority: {
    EMERGENCY: 1,
  },
};

function money(
  value: string | undefined,
  currencyCode: string | null | undefined,
) {
  if (!value || !currencyCode) return "—";

  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 0,
  }).format(Number(value) / 100);
}

function MetricIcon({
  children,
  tone = "teal",
}: {
  children: ReactNode;
  tone?: "teal" | "gold" | "forest" | "cream";
}) {
  const styles = {
    teal: "bg-teal/10 text-teal",
    gold: "bg-gold/15 text-gold",
    forest: "bg-forest/10 text-forest",
    cream: "bg-cream text-forest",
  };

  return (
    <div
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${styles[tone]}`}
    >
      {children}
    </div>
  );
}

function MetricCard({
  label,
  value,
  helper,
  icon,
  href,
}: {
  label: string;
  value: ReactNode;
  helper?: string;
  icon: ReactNode;
  href?: string;
}) {
  const content = (
    <div className="flex min-h-[128px] items-start justify-between gap-4 rounded-2xl border border-hairline bg-white p-5 shadow-[0_8px_24px_rgba(16,45,42,0.035)] transition hover:border-teal/20 hover:shadow-[0_12px_32px_rgba(16,45,42,0.06)]">
      <div>
        <p className="text-xs font-medium text-muted">{label}</p>
        <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-ink sm:text-[28px]">
          {value}
        </p>
        {helper && (
          <p className="mt-2 text-[11px] leading-4 text-muted">{helper}</p>
        )}
      </div>
      {icon}
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

function SectionCard({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-hairline bg-white shadow-[0_8px_28px_rgba(16,45,42,0.035)] ${className}`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description && (
            <p className="mt-1 text-xs leading-5 text-muted">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyDashboard() {
  return (
    <section className="mt-4 rounded-2xl border border-hairline bg-white p-8 text-center shadow-[0_8px_28px_rgba(16,45,42,0.035)]">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-teal/10 text-teal">
        <svg
          aria-hidden="true"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
        >
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10.5V20h13v-9.5" />
          <path d="M9 20v-6h6v6" />
        </svg>
      </div>

      <h2 className="mt-4 text-lg font-semibold text-ink">
        Set up your NesAfric workspace
      </h2>

      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
        This is where your properties, tenants, leases, payments and maintenance
        activity will come together.
      </p>

      <Link
        className="mt-5 inline-flex rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-light"
        href="/onboarding"
      >
        Create your organisation
      </Link>
    </section>
  );
}

export function DashboardContent() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [collection, setCollection] = useState<CollectionMetrics | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceMetrics | null>(
    null,
  );
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [error, setError] = useState("");
  const [noOrganisation, setNoOrganisation] = useState(false);

  useEffect(() => {
    const organisationId = localStorage.getItem(
      "propertyos.activeOrganisationId",
    );

    const headers = {
      "x-organisation-id": organisationId ?? "",
    };

    fetch("/api/dashboard", { headers }).then(async (response) => {
      if (response.ok) {
        setData(await response.json());
        return;
      }

      if (response.status === 401 && process.env.NODE_ENV !== "production") {
        setData(DEVELOPMENT_PREVIEW_DASHBOARD);
        setCollection(DEVELOPMENT_PREVIEW_COLLECTION);
        setMaintenance(DEVELOPMENT_PREVIEW_MAINTENANCE);
        return;
      }

      const body = await response.json();

      if (body.error?.code === "ORGANISATION_REQUIRED") {
        setNoOrganisation(true);
        return;
      }

      setError(body.error?.message ?? "Unable to load dashboard.");
    });

    fetch("/api/rent-collection/metrics", { headers }).then(
      async (response) => {
        if (response.ok) setCollection(await response.json());
      },
    );

    fetch("/api/maintenance/dashboard", { headers }).then(async (response) => {
      if (response.ok) setMaintenance(await response.json());
    });

    if (organisationId) {
      fetch(`/api/organisations/${organisationId}/onboarding`, {
        headers,
      }).then(async (response) => {
        if (response.ok) setOnboarding(await response.json());
      });

      fetch(`/api/organisations/${organisationId}/billing`, {
        headers,
      }).then(async (response) => {
        if (response.ok) setBilling(await response.json());
      });

      fetch(`/api/organisations/${organisationId}/dashboard-opportunities`, {
        headers,
      }).then(async (response) => {
        if (response.ok) {
          const body = await response.json();
          setOpportunities(body.opportunities ?? []);
        }
      });
    }
  }, []);

  const propertyBreakdown = useMemo(() => {
    if (!data) return [];

    const counts = new Map<string, number>();

    for (const property of data.properties) {
      const key = property.category || "Other";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [data]);

  if (noOrganisation) return <EmptyDashboard />;

  if (error) {
    return (
      <p className="rounded-2xl border border-warning/25 bg-amber-50 p-4 text-sm text-amber-900">
        {error}
      </p>
    );
  }

  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div
            className="h-[128px] animate-pulse rounded-2xl border border-hairline bg-white"
            key={item}
          />
        ))}
      </div>
    );
  }

  const reachedFeatures =
    billing?.features.filter((feature) => feature.reached) ?? [];

  const approachingFeatures =
    billing?.features.filter(
      (feature) => feature.approaching && !feature.reached,
    ) ?? [];

  const collected = Number(collection?.collectedAmountMinor ?? 0);
  const charged = Number(collection?.chargedAmountMinor ?? 0);

  const collectionRate =
    charged > 0 ? Math.min(100, Math.round((collected / charged) * 100)) : 0;

  return (
    <div className="space-y-6">
      {billing && READ_ONLY_STATUSES.has(billing.status) && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          This organisation&apos;s subscription is{" "}
          {billing.status.toLowerCase()}. Existing data remains accessible, but
          new changes are blocked.{" "}
          <Link className="font-semibold underline" href="/settings/billing">
            Resolve billing →
          </Link>
        </div>
      )}

      {billing &&
        billing.cancelAtPeriodEnd &&
        !READ_ONLY_STATUSES.has(billing.status) && (
          <div className="rounded-xl border border-warning/20 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            This subscription is scheduled to cancel at the end of the current
            billing period.{" "}
            <Link className="font-semibold underline" href="/settings/billing">
              Manage billing →
            </Link>
          </div>
        )}

      {reachedFeatures.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          Plan limit reached for:{" "}
          {reachedFeatures.map((feature) => feature.label).join(", ")}.{" "}
          <Link className="font-semibold underline" href="/settings/billing">
            Upgrade →
          </Link>
        </div>
      )}

      {reachedFeatures.length === 0 && approachingFeatures.length > 0 && (
        <div className="rounded-xl border border-warning/20 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Approaching plan limit for:{" "}
          {approachingFeatures.map((feature) => feature.label).join(", ")}.{" "}
          <Link className="font-semibold underline" href="/settings/billing">
            View usage →
          </Link>
        </div>
      )}

      {opportunities.length > 0 && (
        <div className="grid gap-2">
          {opportunities.map((opportunity) => (
            <Link
              className={`rounded-xl border px-4 py-3 text-sm transition ${
                opportunity.tone === "upgrade"
                  ? "border-gold/20 bg-gold/10 text-forest"
                  : "border-teal/15 bg-teal/5 text-forest"
              }`}
              href={opportunity.href}
              key={opportunity.key}
            >
              {opportunity.message}
            </Link>
          ))}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          href="/properties"
          icon={
            <MetricIcon tone="teal">
              <svg
                aria-hidden="true"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <path d="M3 11.5 12 4l9 7.5" />
                <path d="M5.5 10.5V20h13v-9.5" />
                <path d="M9 20v-6h6v6" />
              </svg>
            </MetricIcon>
          }
          label="Properties"
          value={data.properties.length}
        />

        <MetricCard
          href="/properties"
          icon={
            <MetricIcon tone="forest">
              <svg
                aria-hidden="true"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <rect height="14" rx="2" width="16" x="4" y="5" />
                <path d="M8 9h2M14 9h2M8 13h2M14 13h2M10 19v-3h4v3" />
              </svg>
            </MetricIcon>
          }
          label="Units"
          value={data.units}
        />

        <MetricCard
          href="/payments"
          helper={
            collection
              ? `${collectionRate}% of expected rent collected`
              : undefined
          }
          icon={
            <MetricIcon tone="gold">
              <svg
                aria-hidden="true"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <rect height="14" rx="2" width="18" x="3" y="5" />
                <path d="M3 9h18M7 15h4" />
              </svg>
            </MetricIcon>
          }
          label="Collected rent"
          value={money(
            collection?.collectedAmountMinor,
            collection?.currencyCode,
          )}
        />

        <MetricCard
          href="/maintenance"
          icon={
            <MetricIcon tone="cream">
              <svg
                aria-hidden="true"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-3 3-3-3z" />
              </svg>
            </MetricIcon>
          }
          label="Open maintenance"
          value={maintenance?.open ?? "—"}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <SectionCard
          action={
            <Link
              className="text-xs font-semibold text-teal hover:text-forest"
              href="/properties"
            >
              View all
            </Link>
          }
          description="A live view of your current portfolio."
          title="Property overview"
        >
          <div className="grid gap-6 p-5 sm:grid-cols-[160px_1fr] sm:p-6">
            <div className="relative mx-auto flex h-36 w-36 items-center justify-center rounded-full bg-[conic-gradient(var(--color-teal)_0_40%,var(--color-teal-light)_40%_65%,var(--color-gold)_65%_82%,var(--color-cream)_82%_100%)]">
              <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-white">
                <span className="text-3xl font-semibold tracking-[-0.04em] text-ink">
                  {data.properties.length}
                </span>
                <span className="mt-1 text-[11px] text-muted">Properties</span>
              </div>
            </div>

            <div className="space-y-3">
              {propertyBreakdown.length > 0 ? (
                propertyBreakdown.map(([category, count], index) => {
                  const dotClasses = [
                    "bg-teal",
                    "bg-teal-light",
                    "bg-gold",
                    "bg-forest-light",
                    "bg-cream",
                  ];

                  return (
                    <div
                      className="flex items-center justify-between gap-3"
                      key={category}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            dotClasses[index] ?? "bg-muted"
                          }`}
                        />
                        <span className="text-sm text-muted">{category}</span>
                      </div>
                      <span className="text-sm font-semibold text-ink">
                        {count}
                      </span>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm leading-6 text-muted">
                  Add properties to see your portfolio breakdown.
                </p>
              )}

              <div className="border-t border-hairline pt-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Total units</span>
                  <span className="font-semibold text-ink">{data.units}</span>
                </div>

                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-muted">Team members</span>
                  <span className="font-semibold text-ink">{data.members}</span>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          action={
            <Link
              className="text-xs font-semibold text-teal hover:text-forest"
              href="/payments"
            >
              View payments
            </Link>
          }
          description="Expected, collected and outstanding rent."
          title="Rent collection"
        >
          <div className="p-5 sm:p-6">
            {collection ? (
              <>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-xs text-muted">Collection rate</p>
                    <p className="mt-1 text-3xl font-semibold tracking-[-0.04em] text-ink">
                      {collectionRate}%
                    </p>
                  </div>
                  <p className="text-xs text-muted">
                    {money(
                      collection.collectedAmountMinor,
                      collection.currencyCode,
                    )}{" "}
                    collected
                  </p>
                </div>

                <div className="mt-5 h-2 overflow-hidden rounded-full bg-cream">
                  <div
                    className="h-full rounded-full bg-teal transition-all"
                    style={{ width: `${collectionRate}%` }}
                  />
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-surface p-4">
                    <p className="text-[11px] text-muted">Expected</p>
                    <p className="mt-1 text-sm font-semibold text-ink">
                      {money(
                        collection.chargedAmountMinor,
                        collection.currencyCode,
                      )}
                    </p>
                  </div>

                  <div className="rounded-xl bg-teal/5 p-4">
                    <p className="text-[11px] text-muted">Collected</p>
                    <p className="mt-1 text-sm font-semibold text-ink">
                      {money(
                        collection.collectedAmountMinor,
                        collection.currencyCode,
                      )}
                    </p>
                  </div>

                  <div className="rounded-xl bg-gold/10 p-4">
                    <p className="text-[11px] text-muted">Outstanding</p>
                    <p className="mt-1 text-sm font-semibold text-ink">
                      {money(
                        collection.outstandingAmountMinor,
                        collection.currencyCode,
                      )}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm leading-6 text-muted">
                Rent collection data is not available yet.
              </p>
            )}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <SectionCard
          action={
            <Link
              className="text-xs font-semibold text-teal hover:text-forest"
              href="/properties"
            >
              View all
            </Link>
          }
          description="Your most recently available property records."
          title="Recent properties"
        >
          {data.properties.length > 0 ? (
            <div className="divide-y divide-hairline">
              {data.properties.slice(0, 5).map((property) => (
                <div
                  className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6"
                  key={property.id}
                >
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {property.name}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {property.referenceNumber} · {property.category}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-surface px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {property.status}
                    </span>

                    <Link
                      className="text-xs font-semibold text-teal hover:text-forest"
                      href={`/maintenance/properties/${property.id}`}
                    >
                      Maintenance
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6">
              <p className="text-sm text-muted">
                No properties yet.{" "}
                <Link
                  className="font-semibold text-teal hover:text-forest"
                  href="/properties/new"
                >
                  Add your first property.
                </Link>
              </p>
            </div>
          )}
        </SectionCard>

        <SectionCard
          description="Open issues requiring attention."
          title="Maintenance"
        >
          <div className="space-y-4 p-5 sm:p-6">
            <div className="flex items-center justify-between rounded-xl bg-surface p-4">
              <div>
                <p className="text-[11px] text-muted">Open requests</p>
                <p className="mt-1 text-xl font-semibold text-ink">
                  {maintenance?.open ?? "—"}
                </p>
              </div>
              <div className="h-2 w-2 rounded-full bg-teal" />
            </div>

            <div className="flex items-center justify-between rounded-xl bg-gold/10 p-4">
              <div>
                <p className="text-[11px] text-muted">Emergency issues</p>
                <p className="mt-1 text-xl font-semibold text-ink">
                  {maintenance?.openByPriority.EMERGENCY ?? "—"}
                </p>
              </div>
              <div className="h-2 w-2 rounded-full bg-gold" />
            </div>

            <div className="flex items-center justify-between rounded-xl bg-teal/5 p-4">
              <div>
                <p className="text-[11px] text-muted">Work in progress</p>
                <p className="mt-1 text-xl font-semibold text-ink">
                  {maintenance?.byStatus.IN_PROGRESS ?? "—"}
                </p>
              </div>
              <div className="h-2 w-2 rounded-full bg-teal-light" />
            </div>

            <Link
              className="inline-flex text-xs font-semibold text-teal hover:text-forest"
              href="/maintenance"
            >
              Open maintenance workspace →
            </Link>
          </div>
        </SectionCard>
      </div>

      {onboarding && !onboarding.complete && (
        <SectionCard
          description="Complete these steps to get the most from your workspace."
          title="Finish setting up NesAfric"
        >
          <div className="grid gap-2 p-5 sm:grid-cols-2 sm:p-6">
            {onboarding.steps.map((step) => (
              <div
                className="flex items-center gap-3 rounded-xl bg-surface p-3"
                key={step.key}
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                    step.done
                      ? "bg-teal/10 text-teal"
                      : "bg-white text-muted ring-1 ring-hairline"
                  }`}
                >
                  {step.done ? "✓" : "○"}
                </span>

                <span
                  className={`text-sm ${
                    step.done ? "text-muted line-through" : "text-ink"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            ))}

            {onboarding.optionalSteps.map((step) => (
              <div
                className="flex items-center gap-3 rounded-xl bg-surface p-3"
                key={step.key}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs text-muted ring-1 ring-hairline">
                  {step.done ? "✓" : "○"}
                </span>

                <span className="text-sm text-muted">
                  {step.label} · Optional
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
