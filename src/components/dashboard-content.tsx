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

type Property = {
  id: string;
  name: string;
  referenceNumber: string;
  category: string;
  status: string;
};

type Dashboard = {
  organisation: {
    id: string;
    name: string;
    logoUrl: string | null;
  };
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

const DEV_DASHBOARD: Dashboard = {
  organisation: {
    id: "dev-organisation",
    name: "NesAfric Demo Properties",
    logoUrl: null,
  },
  properties: [
    { id: "p1", name: "The Ridge Apartments", referenceNumber: "PROP-001", category: "Residential", status: "ACTIVE" },
    { id: "p2", name: "Accra Business Centre", referenceNumber: "PROP-002", category: "Commercial", status: "ACTIVE" },
    { id: "p3", name: "Lakeside Court", referenceNumber: "PROP-003", category: "Residential", status: "ACTIVE" },
    { id: "p4", name: "Cantonments Residence", referenceNumber: "PROP-004", category: "Residential", status: "ACTIVE" },
    { id: "p5", name: "Airport Heights", referenceNumber: "PROP-005", category: "Residential", status: "ACTIVE" },
  ],
  units: 48,
  members: 4,
};

const DEV_COLLECTION: CollectionMetrics = {
  currencyCode: "GHS",
  chargedAmountMinor: "3750000",
  collectedAmountMinor: "2850000",
  outstandingAmountMinor: "900000",
};

const DEV_MAINTENANCE: MaintenanceMetrics = {
  open: 5,
  byStatus: { IN_PROGRESS: 3 },
  openByPriority: { EMERGENCY: 1 },
};

function getTimeGreeting(hour: number) {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

function money(value?: string, currencyCode?: string | null) {
  if (!value || !currencyCode) return "—";

  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 0,
  }).format(Number(value) / 100);
}

export function DashboardContent() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [greeting, setGreeting] = useState("");

  useEffect(() => {
    const updateGreeting = () => {
      setGreeting(getTimeGreeting(new Date().getHours()));
    };

    updateGreeting();
    const timer = window.setInterval(updateGreeting, 60_000);

    return () => window.clearInterval(timer);
  }, []);
  const [collection, setCollection] = useState<CollectionMetrics | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceMetrics | null>(null);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [error, setError] = useState("");
  const [noOrganisation, setNoOrganisation] = useState(false);

  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    const headers = { "x-organisation-id": organisationId ?? "" };

    fetch("/api/dashboard", { headers }).then(async (response) => {
      if (response.ok) {
        setData(await response.json());
        return;
      }

      if (response.status === 401 && process.env.NODE_ENV !== "production") {
        setData(DEV_DASHBOARD);
        setCollection(DEV_COLLECTION);
        setMaintenance(DEV_MAINTENANCE);
        return;
      }

      const body = await response.json();

      if (body.error?.code === "ORGANISATION_REQUIRED") {
        setNoOrganisation(true);
        return;
      }

      setError(body.error?.message ?? "Unable to load your portfolio dashboard.");
    });

    fetch("/api/rent-collection/metrics", { headers }).then(async (response) => {
      if (response.ok) setCollection(await response.json());
    });

    fetch("/api/maintenance/dashboard", { headers }).then(async (response) => {
      if (response.ok) setMaintenance(await response.json());
    });

    if (organisationId) {
      fetch(`/api/organisations/${organisationId}/onboarding`, { headers }).then(async (response) => {
        if (response.ok) setOnboarding(await response.json());
      });

      fetch(`/api/organisations/${organisationId}/billing`, { headers }).then(async (response) => {
        if (response.ok) setBilling(await response.json());
      });

      fetch(`/api/organisations/${organisationId}/dashboard-opportunities`, { headers }).then(async (response) => {
        if (response.ok) {
          const body = await response.json();
          setOpportunities(body.opportunities ?? []);
        }
      });
    }
  }, []);

  const collectionRate = useMemo(() => {
    const charged = Number(collection?.chargedAmountMinor ?? 0);
    const collected = Number(collection?.collectedAmountMinor ?? 0);

    return charged > 0
      ? Math.min(100, Math.round((collected / charged) * 100))
      : 0;
  }, [collection]);

  const propertyBreakdown = useMemo(() => {
    if (!data) return [];

    const counts = new Map<string, number>();

    data.properties.forEach((property) => {
      const category = property.category || "Other";
      counts.set(category, (counts.get(category) ?? 0) + 1);
    });

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [data]);

  if (noOrganisation) {
    return (
      <div className="border-y border-hairline bg-white px-6 py-12 text-center sm:px-10">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[10px] bg-teal/8 text-teal">
          <DashboardIcon name="building" />
        </div>
        <h2 className="mt-5 text-xl font-semibold text-ink">
          Create your property workspace
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">
          Add your organisation and properties to unlock portfolio monitoring,
          rent collection, maintenance and AI-assisted operations.
        </p>
        <Link
          className="mt-6 inline-flex rounded-xl bg-forest px-5 py-3 text-sm font-semibold text-white"
          href="/onboarding"
        >
          Start setup
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div
            className="h-36 animate-pulse border-t border-hairline bg-white/70"
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

  const emergency = maintenance?.openByPriority.EMERGENCY ?? 0;
  const inProgress = maintenance?.byStatus.IN_PROGRESS ?? 0;

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[18px] border border-white/8 bg-forest-deep px-6 py-7 text-white sm:px-8 sm:py-8">
        <div className="relative grid gap-7 xl:grid-cols-[1.2fr_0.8fr] xl:items-end">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-teal-light">
              Live portfolio
            </p>
            <p className="mt-3 text-sm font-medium text-white/60">
              {greeting || "Welcome"}
            </p>
            <div className="mt-2 flex items-center gap-3">
              {data.organisation.logoUrl ? (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/15 bg-white p-1.5 shadow-sm">
                  <img
                    alt={`${data.organisation.name} logo`}
                    className="h-full w-full object-contain"
                    src={data.organisation.logoUrl}
                  />
                </div>
              ) : null}
              <h2 className="max-w-2xl text-2xl font-semibold tracking-[-0.04em] sm:text-[34px]">
                {data.organisation.name}
              </h2>
            </div>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/65">
              Track rent, properties, units, maintenance and team activity from
              one operating view.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-forest"
                href="/payments"
              >
                Review payments
              </Link>
              <Link
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white"
                href="/maintenance"
              >
                Open maintenance
              </Link>
              <Link
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white"
                href="/ai"
              >
                Ask AI manager
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[12px] border border-white/10 bg-white/[0.045] p-4">
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/45">
                Collection rate
              </p>
              <p className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
                {collectionRate}%
              </p>
              <ProgressBar className="mt-3 bg-white/10" value={collectionRate} />
            </div>

            <div className="rounded-[12px] border border-white/10 bg-white/[0.045] p-4">
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/45">
                Outstanding
              </p>
              <p className="mt-2 text-xl font-semibold tracking-[-0.03em]">
                {money(
                  collection?.outstandingAmountMinor,
                  collection?.currencyCode,
                )}
              </p>
              <p className="mt-3 text-xs text-white/45">
                Across current rent obligations
              </p>
            </div>
          </div>
        </div>
      </section>

      {billing && READ_ONLY_STATUSES.has(billing.status) && (
        <div className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          Your subscription is {billing.status.toLowerCase()}. Existing data is
          available, but new changes are restricted.{" "}
          <Link className="font-semibold underline" href="/settings/billing">
            Resolve billing
          </Link>
        </div>
      )}

      {reachedFeatures.length > 0 && (
        <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Plan limit reached for{" "}
          {reachedFeatures.map((feature) => feature.label).join(", ")}.{" "}
          <Link className="font-semibold underline" href="/settings/billing">
            Review plan
          </Link>
        </div>
      )}

      {reachedFeatures.length === 0 && approachingFeatures.length > 0 && (
        <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You are approaching the limit for{" "}
          {approachingFeatures.map((feature) => feature.label).join(", ")}.
        </div>
      )}

      {opportunities.length > 0 && (
        <div className="grid gap-2">
          {opportunities.slice(0, 3).map((opportunity) => (
            <Link
              className={`rounded-[10px] border px-4 py-3 text-sm font-medium ${
                opportunity.tone === "upgrade"
                  ? "border-gold/25 bg-gold/10 text-forest"
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
        <DashboardStat
          href="/properties"
          icon={<DashboardIcon name="building" />}
          label="Properties"
          tone="teal"
          value={data.properties.length}
        />
        <DashboardStat
          href="/properties"
          helper="Across the active portfolio"
          icon={<DashboardIcon name="units" />}
          label="Units"
          tone="forest"
          value={data.units}
        />
        <DashboardStat
          href="/payments"
          helper={`${collectionRate}% of expected rent`}
          icon={<DashboardIcon name="money" />}
          label="Rent collected"
          tone="gold"
          value={money(
            collection?.collectedAmountMinor,
            collection?.currencyCode,
          )}
        />
        <DashboardStat
          href="/maintenance"
          helper={`${emergency} emergency · ${inProgress} in progress`}
          icon={<DashboardIcon name="maintenance" />}
          label="Open maintenance"
          tone={emergency > 0 ? "red" : "teal"}
          value={maintenance?.open ?? "—"}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
        <DashboardPanel
          action={
            <Link
              className="text-xs font-semibold text-teal hover:text-forest"
              href="/payments"
            >
              View ledger →
            </Link>
          }
          description="Expected rent compared with confirmed collections."
          title="Rent performance"
        >
          <div className="p-5 sm:p-6">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs text-muted">Collection rate</p>
                <p className="mt-1 text-[38px] font-semibold tracking-[-0.05em] text-ink">
                  {collectionRate}%
                </p>
              </div>

              <div className="text-left sm:text-right">
                <p className="text-xs text-muted">Collected this period</p>
                <p className="mt-1 text-lg font-semibold text-ink">
                  {money(
                    collection?.collectedAmountMinor,
                    collection?.currencyCode,
                  )}
                </p>
              </div>
            </div>

            <ProgressBar className="mt-5" value={collectionRate} />

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[10px] bg-surface p-4">
                <p className="text-[11px] text-muted">Expected</p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {money(
                    collection?.chargedAmountMinor,
                    collection?.currencyCode,
                  )}
                </p>
              </div>
              <div className="rounded-[10px] bg-teal/5 p-4">
                <p className="text-[11px] text-muted">Collected</p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {money(
                    collection?.collectedAmountMinor,
                    collection?.currencyCode,
                  )}
                </p>
              </div>
              <div className="rounded-[10px] bg-gold/10 p-4">
                <p className="text-[11px] text-muted">Outstanding</p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {money(
                    collection?.outstandingAmountMinor,
                    collection?.currencyCode,
                  )}
                </p>
              </div>
            </div>
          </div>
        </DashboardPanel>

        <DashboardPanel
          action={
            <Link
              className="text-xs font-semibold text-teal hover:text-forest"
              href="/properties"
            >
              Portfolio →
            </Link>
          }
          description="How your managed portfolio is distributed."
          title="Portfolio mix"
        >
          <div className="p-5 sm:p-6">
            <div className="grid gap-6 sm:grid-cols-[150px_1fr] sm:items-center">
              <div className="relative mx-auto flex h-36 w-36 items-center justify-center rounded-full bg-[conic-gradient(var(--color-teal)_0_46%,var(--color-gold)_46%_67%,var(--color-forest-light)_67%_84%,var(--color-cream)_84%_100%)]">
                <div className="flex h-[98px] w-[98px] flex-col items-center justify-center rounded-full bg-white">
                  <p className="text-3xl font-semibold tracking-[-0.04em] text-ink">
                    {data.properties.length}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-muted">
                    Properties
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {propertyBreakdown.map(([category, count], index) => {
                  const dots = [
                    "bg-teal",
                    "bg-gold",
                    "bg-forest-light",
                    "bg-amber-300",
                    "bg-slate-400",
                  ];

                  return (
                    <div
                      className="flex items-center justify-between"
                      key={category}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            dots[index] ?? "bg-muted"
                          }`}
                        />
                        <span className="text-sm text-muted">{category}</span>
                      </div>
                      <span className="text-sm font-semibold text-ink">
                        {count}
                      </span>
                    </div>
                  );
                })}

                <div className="border-t border-hairline pt-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">Team members</span>
                    <span className="font-semibold text-ink">
                      {data.members}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DashboardPanel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <DashboardPanel
          action={
            <Link
              className="text-xs font-semibold text-teal hover:text-forest"
              href="/properties"
            >
              View all →
            </Link>
          }
          description="Your latest managed property records."
          title="Portfolio activity"
        >
          <div className="divide-y divide-hairline">
            {data.properties.slice(0, 5).map((property) => (
              <div
                className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6"
                key={property.id}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-[9px] bg-teal/10 text-teal">
                    <DashboardIcon name="building" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {property.name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {property.referenceNumber} · {property.category}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <StatusBadge tone="success">
                    {property.status}
                  </StatusBadge>

                  <Link
                    className="text-xs font-semibold text-teal"
                    href={`/maintenance/properties/${property.id}`}
                  >
                    Open →
                  </Link>
                </div>
              </div>
            ))}

            {data.properties.length === 0 && (
              <div className="p-6 text-sm text-muted">
                No properties have been added yet.
              </div>
            )}
          </div>
        </DashboardPanel>

        <DashboardPanel
          description="Operational items requiring attention."
          title="Operations"
        >
          <div className="space-y-3 p-5 sm:p-6">
            <Link
              className="flex items-center justify-between rounded-[10px] bg-surface p-4 transition hover:bg-cream"
              href="/maintenance"
            >
              <div>
                <p className="text-xs text-muted">Maintenance requests</p>
                <p className="mt-1 text-xl font-semibold text-ink">
                  {maintenance?.open ?? "—"}
                </p>
              </div>
              <StatusBadge tone={emergency > 0 ? "danger" : "neutral"}>
                {emergency} urgent
              </StatusBadge>
            </Link>

            <Link
              className="flex items-center justify-between rounded-[10px] bg-surface p-4 transition hover:bg-cream"
              href="/team"
            >
              <div>
                <p className="text-xs text-muted">Workspace team</p>
                <p className="mt-1 text-xl font-semibold text-ink">
                  {data.members}
                </p>
              </div>
              <span className="text-xs font-semibold text-teal">Manage →</span>
            </Link>

            <Link
              className="flex items-center justify-between rounded-[10px] bg-forest p-4 text-white"
              href="/ai"
            >
              <div>
                <p className="text-xs text-white/55">AI property manager</p>
                <p className="mt-1 text-sm font-semibold">
                  Review your portfolio
                </p>
              </div>
              <span className="text-xs font-semibold text-teal-light">Open →</span>
            </Link>
          </div>
        </DashboardPanel>
      </div>

      {onboarding && !onboarding.complete && (
        <DashboardPanel
          description="Complete these steps to unlock the full workspace."
          title="Finish workspace setup"
        >
          <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
            {onboarding.steps.map((step) => (
              <div
                className="flex items-center gap-3 rounded-[10px] bg-surface p-4"
                key={step.key}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
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
          </div>
        </DashboardPanel>
      )}
    </div>
  );
}
