"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Property = {
  id: string;
  name: string;
  referenceNumber: string;
  category: string;
  status: string;
  city: string | null;
  geocodeStatus: string;
  portfolio: { id: string; name: string } | null;
  _count: { units: number };
};

const DEVELOPMENT_PREVIEW_PROPERTIES: Property[] = [
  {
    id: "preview-ridge",
    name: "The Ridge Apartments",
    referenceNumber: "PROP-001",
    category: "RESIDENTIAL",
    status: "ACTIVE",
    city: "Accra",
    geocodeStatus: "GEOCODED",
    portfolio: { id: "preview-portfolio", name: "Accra Portfolio" },
    _count: { units: 12 },
  },
  {
    id: "preview-airport",
    name: "Airport Heights",
    referenceNumber: "PROP-002",
    category: "RESIDENTIAL",
    status: "ACTIVE",
    city: "Accra",
    geocodeStatus: "GEOCODED",
    portfolio: { id: "preview-portfolio", name: "Accra Portfolio" },
    _count: { units: 8 },
  },
  {
    id: "preview-business",
    name: "Accra Business Centre",
    referenceNumber: "PROP-003",
    category: "COMMERCIAL",
    status: "ACTIVE",
    city: "Accra",
    geocodeStatus: "GEOCODED",
    portfolio: { id: "preview-commercial", name: "Commercial Portfolio" },
    _count: { units: 16 },
  },
  {
    id: "preview-cantonments",
    name: "Cantonments Residence",
    referenceNumber: "PROP-004",
    category: "RESIDENTIAL",
    status: "ACTIVE",
    city: "Accra",
    geocodeStatus: "GEOCODED",
    portfolio: { id: "preview-portfolio", name: "Accra Portfolio" },
    _count: { units: 6 },
  },
  {
    id: "preview-osu",
    name: "Osu Trade Centre",
    referenceNumber: "PROP-005",
    category: "COMMERCIAL",
    status: "ACTIVE",
    city: "Accra",
    geocodeStatus: "GEOCODED",
    portfolio: { id: "preview-commercial", name: "Commercial Portfolio" },
    _count: { units: 5 },
  },
  {
    id: "preview-prampram",
    name: "Prampram Land",
    referenceNumber: "PROP-006",
    category: "LAND",
    status: "INACTIVE",
    city: "Prampram",
    geocodeStatus: "GEOCODED",
    portfolio: null,
    _count: { units: 0 },
  },
];

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-teal/10 text-teal",
  INACTIVE: "bg-surface text-muted",
  ARCHIVED: "bg-cream text-muted",
};

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(/[_-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function PropertyIcon() {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal/10 text-teal">
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
  );
}

export function PropertyList() {
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const organisationId = localStorage.getItem(
      "propertyos.activeOrganisationId",
    );

    if (!organisationId) {
      if (process.env.NODE_ENV !== "production") {
        const timer = setTimeout(
          () => setProperties(DEVELOPMENT_PREVIEW_PROPERTIES),
          0,
        );
        return () => clearTimeout(timer);
      }

      const timer = setTimeout(
        () => setError("Choose an organisation to view properties."),
        0,
      );
      return () => clearTimeout(timer);
    }

    fetch("/api/properties", {
      headers: { "x-organisation-id": organisationId },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            (await response.json()).error?.message ??
              "Unable to load properties.",
          );
        }

        setProperties((await response.json()) as Property[]);
      })
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : "Unable to load properties.",
        ),
      );
  }, []);

  const filtered = useMemo(() => {
    if (!properties) return null;

    const term = search.trim().toLowerCase();

    return properties.filter((property) => {
      if (status && property.status !== status) return false;

      if (!term) return true;

      return (
        property.name.toLowerCase().includes(term) ||
        property.referenceNumber.toLowerCase().includes(term) ||
        (property.city ?? "").toLowerCase().includes(term) ||
        property.category.toLowerCase().includes(term)
      );
    });
  }, [properties, search, status]);

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-900">
        {error}
      </div>
    );
  }

  if (!properties) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div
            className="h-[220px] animate-pulse rounded-2xl border border-hairline bg-white"
            key={item}
          />
        ))}
      </div>
    );
  }

  if (!properties.length) {
    return (
      <section className="rounded-2xl border border-dashed border-hairline bg-white px-6 py-14 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal/10 text-teal">
          <svg
            aria-hidden="true"
            className="h-7 w-7"
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
          No properties yet
        </h2>

        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
          Add your first property to start managing units, tenants, leases,
          payments and maintenance.
        </p>

        <Link
          className="mt-5 inline-flex rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-light"
          href="/properties/new"
        >
          Add your first property
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-hairline bg-white p-4 shadow-[0_8px_24px_rgba(16,45,42,0.025)] sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-md">
            <svg
              aria-hidden="true"
              className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
            >
              <circle cx="11" cy="11" r="6" />
              <path d="m16 16 4 4" />
            </svg>

            <input
              className="h-11 w-full rounded-xl border border-hairline bg-warm-white pl-10 pr-4 text-sm text-ink outline-none transition placeholder:text-muted focus:border-teal focus:ring-2 focus:ring-teal/10"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search properties, references or cities..."
              type="search"
              value={search}
            />
          </div>

          <div className="flex items-center gap-3">
            <select
              className="h-11 rounded-xl border border-hairline bg-white px-3 text-sm text-ink outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/10"
              onChange={(event) => setStatus(event.target.value)}
              value={status}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="ARCHIVED">Archived</option>
            </select>

            <div className="hidden rounded-xl bg-surface px-3 py-2.5 text-xs font-medium text-muted sm:block">
              {filtered?.length ?? 0}{" "}
              {(filtered?.length ?? 0) === 1 ? "property" : "properties"}
            </div>
          </div>
        </div>
      </section>

      {filtered && filtered.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-hairline bg-white p-10 text-center">
          <p className="text-sm font-medium text-ink">
            No properties match your filters.
          </p>
          <p className="mt-1 text-sm text-muted">
            Try another search term or status.
          </p>
        </section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered?.map((property) => (
            <Link
              className="group rounded-2xl border border-hairline bg-white p-5 shadow-[0_8px_24px_rgba(16,45,42,0.03)] transition hover:-translate-y-0.5 hover:border-teal/25 hover:shadow-[0_14px_34px_rgba(16,45,42,0.07)]"
              href={`/properties/${property.id}`}
              key={property.id}
            >
              <div className="flex items-start justify-between gap-4">
                <PropertyIcon />

                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                    STATUS_STYLES[property.status] ?? "bg-surface text-muted"
                  }`}
                >
                  {titleCase(property.status)}
                </span>
              </div>

              <div className="mt-5">
                <h2 className="text-base font-semibold tracking-[-0.015em] text-ink transition group-hover:text-forest">
                  {property.name}
                </h2>

                <p className="mt-1 text-xs text-muted">
                  {property.referenceNumber}
                </p>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-hairline pt-4">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                    Category
                  </p>
                  <p className="mt-1 text-sm font-medium text-ink">
                    {titleCase(property.category)}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                    Units
                  </p>
                  <p className="mt-1 text-sm font-medium text-ink">
                    {property._count.units}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                    Location
                  </p>
                  <p className="mt-1 truncate text-sm font-medium text-ink">
                    {property.city ?? "Not set"}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                    Portfolio
                  </p>
                  <p className="mt-1 truncate text-sm font-medium text-ink">
                    {property.portfolio?.name ?? "Unassigned"}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between">
                <span className="text-xs font-semibold text-teal">
                  View property
                </span>

                <span className="text-teal transition-transform group-hover:translate-x-1">
                  →
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
