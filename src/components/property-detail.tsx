"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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

type Building = { id: string; name: string; units: Unit[] };

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
};

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-800",
  INACTIVE: "bg-slate-100 text-slate-600",
  ARCHIVED: "bg-slate-100 text-slate-500",
};

function titleCase(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function UnitRow({ unit }: { unit: Unit }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
      <div>
        <p className="font-medium text-slate-950">{unit.name}</p>
        <p className="text-slate-500">
          {[unit.unitType, unit.floor ? `Floor ${unit.floor}` : null, unit.bedrooms ? `${unit.bedrooms} bed` : null, unit.bathrooms ? `${unit.bathrooms} bath` : null]
            .filter(Boolean)
            .join(" · ") || "No unit details set"}
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">{titleCase(unit.status)}</span>
    </div>
  );
}

export function PropertyDetail({ propertyId }: { propertyId: string }) {
  const [property, setProperty] = useState<Property | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) {
      const timer = setTimeout(() => setError("Choose an organisation to view this property."), 0);
      return () => clearTimeout(timer);
    }
    fetch(`/api/properties?id=${propertyId}`, { headers: { "x-organisation-id": organisationId } })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error?.message ?? "Unable to load property.");
        setProperty((await response.json()) as Property);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load property."));
  }, [propertyId]);

  if (error) return <p className="mt-8 rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</p>;
  if (!property) return <p className="mt-8 rounded-xl border bg-white p-6 text-slate-600">Loading property...</p>;

  const unassignedUnits = property.units;
  const totalUnits = unassignedUnits.length + property.buildings.reduce((sum, building) => sum + building.units.length, 0);

  return (
    <div className="mt-6 grid gap-6">
      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">{property.name}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {property.referenceNumber} · {titleCase(property.category)}
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[property.status] ?? "bg-slate-100 text-slate-600"}`}>{titleCase(property.status)}</span>
        </div>

        {property.description ? <p className="mt-3 text-sm text-slate-600">{property.description}</p> : null}

        <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase text-slate-400">Location</dt>
            <dd className="mt-1 text-sm text-slate-700">
              {[property.addressLine1, property.district, property.city, property.region].filter(Boolean).join(", ") || "No address set"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-slate-400">Digital address</dt>
            <dd className="mt-1 text-sm text-slate-700">{property.digitalAddress ?? "Not set"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-slate-400">Geocoding</dt>
            <dd className="mt-1 text-sm text-slate-700">{titleCase(property.geocodeStatus)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-slate-400">Portfolio</dt>
            <dd className="mt-1 text-sm text-slate-700">{property.portfolio ? property.portfolio.name : "Not assigned"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-slate-400">Currency</dt>
            <dd className="mt-1 text-sm text-slate-700">{property.currencyCode}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-slate-400">Units</dt>
            <dd className="mt-1 text-sm text-slate-700">{totalUnits}</dd>
          </div>
        </dl>

        <div className="mt-5">
          <Link className="text-sm font-semibold text-emerald-700" href={`/maintenance/properties/${property.id}`}>
            View maintenance history →
          </Link>
        </div>
      </section>

      {property.buildings.length > 0 || unassignedUnits.length > 0 ? (
        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold uppercase text-slate-400">Units</h3>
          {property.buildings.map((building) => (
            <div className="mt-4" key={building.id}>
              <p className="text-sm font-semibold text-slate-700">{building.name}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {building.units.map((unit) => (
                  <UnitRow key={unit.id} unit={unit} />
                ))}
              </div>
            </div>
          ))}
          {unassignedUnits.length > 0 ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {unassignedUnits.map((unit) => (
                <UnitRow key={unit.id} unit={unit} />
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-slate-500">No units recorded for this property yet.</section>
      )}

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold uppercase text-slate-400">Recent maintenance</h3>
        <ScopedMaintenanceHistory id={property.id} scope="properties" />
      </section>
    </div>
  );
}
