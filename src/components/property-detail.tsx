"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PropertyUnitForm } from "@/components/property-unit-form";
import { ScopedMaintenanceHistory } from "@/components/scoped-maintenance-history";

type Unit = {
  id: string;
  name: string;
  unitType: string | null;
  floor: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  status: string;
};

type Building = {
  id: string;
  name: string;
  units: Unit[];
};

type LeaseTenant = {
  id: string;
  email: string | null;
  phone: string | null;
  tenant: {
    legalName: string;
    preferredName: string | null;
  };
};

type Lease = {
  id: string;
  referenceNumber: string;
  status: string;
  startDate: string;
  endDate: string | null;
  unitId: string | null;
  parties: Array<{
    isPrimary: boolean;
    tenantOrganisation: LeaseTenant;
  }>;
};

type Property = {
  id: string;
  name: string;
  referenceNumber: string;
  description: string | null;
  category: string;
  status: string;
  countryCode: string;
  region: string | null;
  city: string | null;
  district: string | null;
  addressLine1: string | null;
  digitalAddress: string | null;
  currencyCode: string;
  geocodeStatus: string;
  portfolio: { id: string; name: string } | null;
  buildings: Building[];
  units: Unit[];
  leases: Lease[];
};

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-teal/10 text-teal",
  INACTIVE: "bg-surface text-muted",
  ARCHIVED: "bg-cream text-muted",
  AVAILABLE: "bg-emerald-50 text-emerald-700",
  OCCUPIED: "bg-blue-50 text-blue-700",
  RESERVED: "bg-amber-50 text-amber-700",
  MAINTENANCE: "bg-orange-50 text-orange-700",
};

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(/[_-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function ActionLink({
  href,
  children,
  primary = false,
}: {
  href: string;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <Link
      className={
        primary
          ? "inline-flex items-center justify-center rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-light"
          : "inline-flex items-center justify-center rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-teal/25 hover:bg-surface"
      }
      href={href}
    >
      {children}
    </Link>
  );
}

export function PropertyDetail({ propertyId }: { propertyId: string }) {
  const [property, setProperty] = useState<Property | null>(null);
  const [error, setError] = useState("");
  const [showUnitForm, setShowUnitForm] = useState(false);

  const loadProperty = useCallback(async () => {
    const organisationId = localStorage.getItem(
      "propertyos.activeOrganisationId",
    );
    if (!organisationId) {
      setError("Choose an organisation to view this property.");
      return;
    }

    setError("");
    const response = await fetch(
      `/api/properties?id=${encodeURIComponent(propertyId)}`,
      { headers: { "x-organisation-id": organisationId } },
    );

    if (!response.ok) {
      throw new Error(
        (await response.json()).error?.message ?? "Unable to load property.",
      );
    }

    setProperty((await response.json()) as Property);
  }, [propertyId]);

  useEffect(() => {
    loadProperty().catch((cause) =>
      setError(
        cause instanceof Error ? cause.message : "Unable to load property.",
      ),
    );
  }, [loadProperty]);

  const allUnits = useMemo(
    () =>
      property
        ? [
            ...property.units.map((unit) => ({ ...unit, buildingName: null })),
            ...property.buildings.flatMap((building) =>
              building.units.map((unit) => ({
                ...unit,
                buildingName: building.name,
              })),
            ),
          ]
        : [],
    [property],
  );

  const leaseByUnit = useMemo(() => {
    const result = new Map<string, Lease>();
    if (!property) return result;
    for (const lease of property.leases) {
      if (lease.unitId && !result.has(lease.unitId)) {
        result.set(lease.unitId, lease);
      }
    }
    return result;
  }, [property]);

  if (error) {
    return (
      <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-900">
        {error}
      </div>
    );
  }

  if (!property) {
    return (
      <div className="mt-6 rounded-2xl border border-hairline bg-white p-6 text-sm text-muted">
        Loading property workspace...
      </div>
    );
  }

  const occupiedUnits = allUnits.filter(
    (unit) => unit.status === "OCCUPIED" || leaseByUnit.has(unit.id),
  ).length;
  const availableUnits = allUnits.filter(
    (unit) => unit.status === "AVAILABLE" && !leaseByUnit.has(unit.id),
  ).length;

  return (
    <div className="mt-6 space-y-6">
      <section className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-[0_10px_30px_rgba(16,45,42,0.04)]">
        <div className="border-b border-hairline p-5 sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-teal">
                  Property workspace
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                    STATUS_STYLES[property.status] ??
                    "bg-surface text-muted"
                  }`}
                >
                  {titleCase(property.status)}
                </span>
              </div>

              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-ink sm:text-3xl">
                {property.name}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {property.referenceNumber} · {titleCase(property.category)}
              </p>

              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
                {property.description ||
                  "Manage units, tenants, leases, maintenance and the operating details of this property from one place."}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex items-center justify-center rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-light"
                onClick={() => setShowUnitForm(true)}
                type="button"
              >
                + Add unit
              </button>
              <ActionLink href={`/tenants/new?propertyId=${property.id}`}>
                + Add tenant
              </ActionLink>
              <ActionLink href={`/leases/new?propertyId=${property.id}`}>
                Create lease
              </ActionLink>
            </div>
          </div>
        </div>

        <div className="grid gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-white p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Total units
            </p>
            <p className="mt-2 text-2xl font-semibold text-ink">
              {allUnits.length}
            </p>
          </div>
          <div className="bg-white p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Occupied
            </p>
            <p className="mt-2 text-2xl font-semibold text-ink">
              {occupiedUnits}
            </p>
          </div>
          <div className="bg-white p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Available
            </p>
            <p className="mt-2 text-2xl font-semibold text-ink">
              {availableUnits}
            </p>
          </div>
          <div className="bg-white p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Active leases
            </p>
            <p className="mt-2 text-2xl font-semibold text-ink">
              {property.leases.length}
            </p>
          </div>
        </div>
      </section>

      {showUnitForm ? (
        <PropertyUnitForm
          buildings={property.buildings.map(({ id, name }) => ({ id, name }))}
          onCancel={() => setShowUnitForm(false)}
          onCreated={() => {
            setShowUnitForm(false);
            loadProperty().catch((cause) =>
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Unable to refresh property.",
              ),
            );
          }}
          propertyId={property.id}
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.75fr)]">
        <section className="rounded-2xl border border-hairline bg-white p-5 shadow-[0_8px_24px_rgba(16,45,42,0.03)] sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-ink">Units</h3>
              <p className="mt-1 text-sm text-muted">
                Open occupancy actions from the exact unit inside this property.
              </p>
            </div>
            <button
              className="rounded-xl border border-hairline bg-white px-3.5 py-2 text-sm font-semibold text-ink transition hover:bg-surface"
              onClick={() => setShowUnitForm(true)}
              type="button"
            >
              Add unit
            </button>
          </div>

          {allUnits.length ? (
            <div className="mt-5 space-y-3">
              {allUnits.map((unit) => {
                const lease = leaseByUnit.get(unit.id);
                const primaryTenant =
                  lease?.parties.find((party) => party.isPrimary)
                    ?.tenantOrganisation ??
                  lease?.parties[0]?.tenantOrganisation;

                return (
                  <article
                    className="rounded-xl border border-hairline p-4 transition hover:border-teal/25"
                    key={unit.id}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-semibold text-ink">{unit.name}</h4>
                          <span
                            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                              STATUS_STYLES[unit.status] ??
                              "bg-surface text-muted"
                            }`}
                          >
                            {titleCase(unit.status)}
                          </span>
                        </div>

                        <p className="mt-1 text-sm text-muted">
                          {[
                            unit.buildingName,
                            unit.unitType,
                            unit.floor ? `Floor ${unit.floor}` : null,
                            unit.bedrooms !== null
                              ? `${unit.bedrooms} bed`
                              : null,
                            unit.bathrooms !== null
                              ? `${unit.bathrooms} bath`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "No additional unit details yet"}
                        </p>

                        <p className="mt-2 text-sm text-ink">
                          {primaryTenant
                            ? `Tenant: ${
                                primaryTenant.tenant.preferredName ||
                                primaryTenant.tenant.legalName
                              }`
                            : "No tenant assigned through an active lease"}
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-2">
                        {lease ? (
                          <ActionLink href={`/leases/${lease.id}`}>
                            View lease
                          </ActionLink>
                        ) : (
                          <>
                            <ActionLink
                              href={`/tenants/new?propertyId=${property.id}&unitId=${unit.id}`}
                            >
                              Add tenant
                            </ActionLink>
                            <ActionLink
                              href={`/leases/new?propertyId=${property.id}&unitId=${unit.id}`}
                              primary
                            >
                              Create lease
                            </ActionLink>
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="mt-5 rounded-xl border border-dashed border-hairline bg-warm-white px-5 py-10 text-center">
              <p className="text-sm font-semibold text-ink">No units yet</p>
              <p className="mt-1 text-sm text-muted">
                Add the first unit so tenants and leases can be tied to the
                correct space.
              </p>
              <button
                className="mt-4 rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white"
                onClick={() => setShowUnitForm(true)}
                type="button"
              >
                Add first unit
              </button>
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-hairline bg-white p-5 shadow-[0_8px_24px_rgba(16,45,42,0.03)]">
            <h3 className="text-sm font-semibold text-ink">Property details</h3>
            <dl className="mt-4 space-y-4 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">
                  Location
                </dt>
                <dd className="mt-1 text-ink">
                  {[
                    property.addressLine1,
                    property.district,
                    property.city,
                    property.region,
                  ]
                    .filter(Boolean)
                    .join(", ") || "No address set"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">
                  Digital address
                </dt>
                <dd className="mt-1 text-ink">
                  {property.digitalAddress ?? "Not set"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">
                  Portfolio
                </dt>
                <dd className="mt-1 text-ink">
                  {property.portfolio?.name ?? "Not assigned"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">
                  Currency
                </dt>
                <dd className="mt-1 text-ink">{property.currencyCode}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-hairline bg-white p-5 shadow-[0_8px_24px_rgba(16,45,42,0.03)]">
            <h3 className="text-sm font-semibold text-ink">Quick actions</h3>
            <div className="mt-4 grid gap-2">
              <ActionLink
                href={`/maintenance/new?propertyId=${property.id}`}
              >
                Add maintenance request
              </ActionLink>
              <ActionLink
                href={`/maintenance/properties/${property.id}`}
              >
                View maintenance history
              </ActionLink>
              <ActionLink href="/documents">Open documents</ActionLink>
            </div>
          </section>
        </aside>
      </div>

      <section className="rounded-2xl border border-hairline bg-white p-5 shadow-[0_8px_24px_rgba(16,45,42,0.03)] sm:p-6">
        <h3 className="text-lg font-semibold text-ink">Recent maintenance</h3>
        <ScopedMaintenanceHistory id={property.id} scope="properties" />
      </section>
    </div>
  );
}
