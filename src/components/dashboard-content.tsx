"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/states";
import { buttonClass } from "@/components/ui/button-styles";
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

function formatToday(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(date);
}

/** Categorical fills for the portfolio mix bar, in order of category size. */
const MIX_COLOURS = ["bg-forest", "bg-teal", "bg-gold", "bg-teal-light", "bg-slate-400"];

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
      setGreeting(formatToday(new Date()));
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
      <section className="rounded-[var(--radius-panel)] bg-forest-deep px-5 py-6 text-white sm:px-8 sm:py-7">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-sm font-medium text-white/65">
              {greeting || "Portfolio"}
            </p>
            <div className="mt-2 flex items-center gap-3">
              {data.organisation.logoUrl ? (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-control)] border border-white/15 bg-white p-1.5">
                  <img
                    alt={`${data.organisation.name} logo`}
                    className="h-full w-full object-contain"
                    src={data.organisation.logoUrl}
                  />
                </div>
              ) : null}
              <h2 className="max-w-2xl text-2xl font-semibold tracking-[-0.025em] sm:text-[32px]">
                {data.organisation.name}
              </h2>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                className={buttonClass("primaryOnDark", "sm")}
                href="/payments"
              >
                Review payments
              </Link>
              <Link
                className={buttonClass("secondaryOnDark", "sm")}
                href="/maintenance"
              >
                Open maintenance
              </Link>
              <Link
                className={buttonClass("secondaryOnDark", "sm")}
                href="/ai"
              >
                Ask AI manager
              </Link>
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

      <section aria-label="Portfolio summary" className="grid grid-cols-2 gap-x-6 xl:grid-cols-4">
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
                <p className="mt-1 text-[36px] font-semibold tabular-nums tracking-[-0.02em] text-ink">
                  {collectionRate}%
                </p>
              </div>

              <div className="text-left sm:text-right">
                <p className="text-xs text-muted">Collected this period</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                  {money(
                    collection?.collectedAmountMinor,
                    collection?.currencyCode,
                  )}
                </p>
              </div>
            </div>

            <ProgressBar className="mt-5" value={collectionRate} />

            <dl className="mt-6 grid grid-cols-2 divide-x divide-hairline border-y border-hairline">
              <div className="py-3 pr-4">
                <dt className="text-xs text-muted">Expected</dt>
                <dd className="mt-1 text-sm font-semibold tabular-nums text-ink">
                  {money(collection?.chargedAmountMinor, collection?.currencyCode)}
                </dd>
              </div>
              <div className="py-3 pl-4">
                <dt className="text-xs text-muted">Outstanding</dt>
                <dd className="mt-1 text-sm font-semibold tabular-nums text-ink">
                  {money(collection?.outstandingAmountMinor, collection?.currencyCode)}
                </dd>
              </div>
            </dl>
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
            {/* Proportions are computed from the organisation's own properties — never fixed. */}
            {data.properties.length > 0 ? (
              <>
                <p className="text-sm text-muted">
                  <span className="text-2xl font-semibold tabular-nums text-ink">{data.properties.length}</span>{" "}
                  {data.properties.length === 1 ? "property" : "properties"}
                </p>
                <div
                  aria-hidden="true"
                  className="mt-4 flex h-2.5 overflow-hidden rounded-[2px] bg-cream"
                >
                  {propertyBreakdown.map(([category, count], index) => (
                    <span
                      className={`h-full ${MIX_COLOURS[index] ?? "bg-slate-400"} ${index > 0 ? "border-l-2 border-white" : ""}`}
                      key={category}
                      style={{ width: `${(count / data.properties.length) * 100}%` }}
                    />
                  ))}
                </div>
                <dl className="mt-4 divide-y divide-hairline border-y border-hairline">
                  {propertyBreakdown.map(([category, count], index) => (
                    <div className="flex items-center justify-between gap-4 py-2.5" key={category}>
                      <dt className="flex items-center gap-2.5 text-sm text-ink">
                        <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-[2px] ${MIX_COLOURS[index] ?? "bg-slate-400"}`} />
                        {category}
                      </dt>
                      <dd className="text-sm tabular-nums text-muted">
                        <span className="font-semibold text-ink">{count}</span>
                        {" · "}
                        {Math.round((count / data.properties.length) * 100)}%
                      </dd>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-4 py-2.5">
                    <dt className="text-sm text-muted">Team members</dt>
                    <dd className="text-sm font-semibold tabular-nums text-ink">{data.members}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <EmptyState
                action={<Link className={buttonClass("secondary", "sm")} href="/properties/new">Add a property</Link>}
                className="border-y-0 py-4"
                description="Your portfolio mix appears here once you add properties."
                title="No properties yet"
              />
            )}
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
