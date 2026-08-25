"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Dashboard = { properties: Array<{ id: string; name: string; referenceNumber: string; category: string; status: string }>; units: number; members: number };

export function DashboardContent() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    fetch("/api/dashboard", { headers: { "x-organisation-id": organisationId ?? "" } }).then(async (response) => response.ok ? setData(await response.json()) : setError((await response.json()).error?.message ?? "Unable to load dashboard."));
  }, []);
  if (error) return <p className="mt-8 rounded border border-amber-200 bg-amber-50 p-4 text-amber-900">{error}</p>;
  if (!data) return <p className="mt-8 text-slate-600">Loading organisation dashboard...</p>;
  return <><section className="mt-8 grid gap-4 md:grid-cols-3">{[["Properties", data.properties.length], ["Units", data.units], ["Team members", data.members]].map(([label, value]) => <div className="rounded-xl border bg-white p-5 shadow-sm" key={String(label)}><p className="text-sm text-slate-600">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>)}</section><section className="mt-8 rounded-xl border p-6"><h2 className="font-semibold">Recent properties</h2>{data.properties.length ? <ul className="mt-3 divide-y">{data.properties.map((property) => <li className="flex justify-between py-3" key={property.id}><span>{property.name}<span className="ml-2 text-sm text-slate-500">{property.referenceNumber}</span></span><span className="text-sm text-slate-600">{property.category}</span></li>)}</ul> : <p className="mt-2 text-slate-600">No properties yet. <Link className="font-semibold text-emerald-700" href="/properties/new">Add your first property.</Link></p>}</section></>;
}
