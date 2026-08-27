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

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-800",
  INACTIVE: "bg-slate-100 text-slate-600",
  ARCHIVED: "bg-slate-100 text-slate-500",
};

export function PropertyList() {
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) {
      const timer = setTimeout(() => setError("Choose an organisation to view properties."), 0);
      return () => clearTimeout(timer);
    }
    fetch("/api/properties", { headers: { "x-organisation-id": organisationId } })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error?.message ?? "Unable to load properties.");
        setProperties((await response.json()) as Property[]);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load properties."));
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
        (property.city ?? "").toLowerCase().includes(term)
      );
    });
  }, [properties, search, status]);

  if (error) return <p className="mt-8 rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</p>;
  if (!properties) return <p className="mt-8 rounded-xl border bg-white p-6 text-slate-600">Loading properties...</p>;

  if (!properties.length) {
    return (
      <div className="mt-8 rounded-xl border border-dashed p-12 text-center text-slate-600">
        <p>No properties yet.</p>
        <Link className="mt-2 inline-block font-semibold text-emerald-700" href="/properties/new">
          Add your first property.
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          className="w-full rounded-lg border px-3 py-2 text-sm sm:max-w-xs"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, reference, or city"
          type="search"
          value={search}
        />
        <select className="rounded-lg border px-3 py-2 text-sm" onChange={(event) => setStatus(event.target.value)} value={status}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </div>

      {filtered && filtered.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed p-8 text-center text-slate-600">No properties match your filters.</p>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered?.map((property) => (
            <Link className="rounded-xl border bg-white p-5 shadow-sm transition hover:border-emerald-300 hover:shadow" href={`/properties/${property.id}`} key={property.id}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-slate-950">{property.name}</p>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[property.status] ?? "bg-slate-100 text-slate-600"}`}>
                  {property.status.charAt(0) + property.status.slice(1).toLowerCase()}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {property.referenceNumber} · {property.category.charAt(0) + property.category.slice(1).toLowerCase()}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {property.city ?? "No city set"} · {property._count.units} unit{property._count.units === 1 ? "" : "s"}
              </p>
              {property.portfolio ? <p className="mt-1 text-xs text-slate-500">Portfolio: {property.portfolio.name}</p> : null}
              <span className="mt-4 inline-block text-sm font-semibold text-emerald-700">View property →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
