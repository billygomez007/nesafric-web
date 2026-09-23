"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Lease = {
  id: string;
  referenceNumber: string;
  status: string;
  startDate: string;
  endDate: string | null;
  property: { name: string };
  unit: { name: string } | null;
  parties: Array<{
    tenantOrganisation: {
      tenant: {
        legalName: string;
        preferredName: string | null;
      };
    };
  }>;
};

function date(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-GH", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "Ongoing";
}

function readableStatus(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusStyle(status: string) {
  switch (status) {
    case "ACTIVE":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "DRAFT":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "EXPIRED":
    case "TERMINATED":
      return "border-slate-200 bg-slate-100 text-slate-600";
    default:
      return "border-teal-200 bg-teal-50 text-emerald-800";
  }
}

export function LeaseList() {
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [today] = useState(() => Date.now());

  useEffect(() => {
    const organisationId = localStorage.getItem(
      "propertyos.activeOrganisationId",
    );

    if (!organisationId) {
      const timer = setTimeout(
        () => setError("Choose an organisation to view leases."),
        0,
      );
      return () => clearTimeout(timer);
    }

    fetch("/api/leases", {
      headers: { "x-organisation-id": organisationId },
    }).then(async (response) =>
      response.ok
        ? setLeases(await response.json())
        : setError(
            (await response.json()).error?.message ?? "Unable to load leases.",
          ),
    );
  }, []);

  const statuses = useMemo(
    () =>
      leases
        ? Array.from(new Set(leases.map((lease) => lease.status))).sort()
        : [],
    [leases],
  );

  const filtered = useMemo(() => {
    if (!leases) return null;

    const term = search.trim().toLowerCase();

    return leases.filter((lease) => {
      if (status && lease.status !== status) return false;

      if (!term) return true;

      const tenants = lease.parties
        .map(
          ({ tenantOrganisation }) =>
            tenantOrganisation.tenant.preferredName ||
            tenantOrganisation.tenant.legalName,
        )
        .join(" ")
        .toLowerCase();

      return (
        lease.referenceNumber.toLowerCase().includes(term) ||
        lease.property.name.toLowerCase().includes(term) ||
        (lease.unit?.name ?? "").toLowerCase().includes(term) ||
        tenants.includes(term)
      );
    });
  }, [leases, search, status]);

  if (error) {
    return (
      <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
        {error}
      </div>
    );
  }

  if (!leases) {
    return (
      <div className="mt-6 rounded-2xl border border-hairline bg-white p-6 text-sm text-muted shadow-sm">
        Loading leases...
      </div>
    );
  }

  const active = leases.filter((lease) => lease.status === "ACTIVE").length;
  const draft = leases.filter((lease) => lease.status === "DRAFT").length;
  const endingSoon = leases.filter((lease) => {
    if (!lease.endDate) return false;

    const end = new Date(lease.endDate).getTime();
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;

    return end >= today && end <= today + ninetyDays;
  }).length;

  return (
    <div className="mt-6 space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total leases"
          value={leases.length}
          detail="All lease records"
        />
        <MetricCard
          label="Active leases"
          value={active}
          detail="Currently in force"
        />
        <MetricCard
          label="Draft leases"
          value={draft}
          detail="Awaiting completion"
        />
        <MetricCard
          label="Ending soon"
          value={endingSoon}
          detail="Within the next 90 days"
        />
      </section>

      <section className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-hairline p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">Lease portfolio</h2>
            <p className="mt-1 text-sm text-muted">
              Review agreements, tenants, terms and lease status.
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                ⌕
              </span>
              <input
                className="h-11 w-full rounded-xl border border-hairline bg-warm-white pl-9 pr-3 text-sm text-ink outline-none transition focus:border-teal sm:w-72"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search leases..."
                type="search"
                value={search}
              />
            </div>

            <select
              className="h-11 rounded-xl border border-hairline bg-warm-white px-3 text-sm text-ink outline-none transition focus:border-teal"
              onChange={(event) => setStatus(event.target.value)}
              value={status}
            >
              <option value="">All statuses</option>
              {statuses.map((value) => (
                <option key={value} value={value}>
                  {readableStatus(value)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!leases.length ? (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-xl text-emerald-700">
              ▤
            </div>
            <h3 className="mt-4 font-semibold text-ink">No leases yet</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              Create your first lease to connect a property with its tenant,
              rent terms and payment schedule.
            </p>
            <Link
              className="mt-5 inline-flex rounded-xl bg-forest px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-light"
              href="/leases/new"
            >
              Create first lease
            </Link>
          </div>
        ) : filtered && filtered.length === 0 ? (
          <div className="px-6 py-14 text-center text-sm text-muted">
            No leases match your search or filter.
          </div>
        ) : (
          <div className="divide-y divide-hairline">
            {filtered?.map((lease) => {
              const tenants = lease.parties
                .map(
                  ({ tenantOrganisation }) =>
                    tenantOrganisation.tenant.preferredName ||
                    tenantOrganisation.tenant.legalName,
                )
                .join(", ");

              return (
                <Link
                  className="group grid gap-5 px-5 py-5 transition hover:bg-warm-white md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center"
                  href={`/leases/${lease.id}`}
                  key={lease.id}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-semibold text-ink transition group-hover:text-emerald">
                        {lease.referenceNumber}
                      </h3>

                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusStyle(
                          lease.status,
                        )}`}
                      >
                        {readableStatus(lease.status)}
                      </span>
                    </div>

                    <p className="mt-2 truncate text-sm font-medium text-ink">
                      {lease.property.name}
                      {lease.unit ? ` · ${lease.unit.name}` : ""}
                    </p>

                    <p className="mt-1 truncate text-sm text-muted">
                      {tenants || "No tenant assigned"}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                      Lease term
                    </p>
                    <p className="mt-1 text-sm font-medium text-ink">
                      {date(lease.startDate)} – {date(lease.endDate)}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-4 md:justify-end">
                    <span className="text-sm font-semibold text-emerald">
                      View lease
                    </span>
                    <span className="text-lg text-muted transition group-hover:translate-x-1 group-hover:text-emerald">
                      →
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-hairline bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-muted">{label}</p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-3xl font-semibold tracking-tight text-ink">
          {value}
        </p>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald">
          ▤
        </span>
      </div>
      <p className="mt-3 text-xs text-muted">{detail}</p>
    </div>
  );
}
