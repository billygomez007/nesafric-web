"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Lease = { id: string; referenceNumber: string; status: string; startDate: string; endDate: string | null; property: { name: string }; unit: { name: string } | null; parties: Array<{ tenantOrganisation: { tenant: { legalName: string; preferredName: string | null } } }> };

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-GH", { dateStyle: "medium" }).format(new Date(value)) : "Ongoing";
}

export function LeaseList() {
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) {
      const timer = setTimeout(() => setError("Choose an organisation to view leases."), 0);
      return () => clearTimeout(timer);
    }
    fetch("/api/leases", { headers: { "x-organisation-id": organisationId } })
      .then(async (response) => response.ok ? setLeases(await response.json()) : setError((await response.json()).error?.message ?? "Unable to load leases."));
  }, []);
  if (error) return <p className="mt-8 rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</p>;
  if (!leases) return <p className="mt-8 rounded-xl border bg-white p-6 text-slate-600">Loading leases...</p>;
  if (!leases.length) return <p className="mt-8 rounded-xl border border-dashed p-12 text-center text-slate-600">No leases yet. Create the first lease for this organisation.</p>;
  return <div className="mt-8 grid gap-3">{leases.map((lease) => <Link className="grid gap-3 rounded-xl border bg-white p-5 shadow-sm transition hover:border-emerald-500 sm:grid-cols-[1fr_auto]" href={`/leases/${lease.id}`} key={lease.id}><div><p className="font-semibold">{lease.referenceNumber}</p><p className="text-sm text-slate-600">{lease.property.name}{lease.unit ? ` · ${lease.unit.name}` : ""}</p><p className="mt-2 text-sm text-slate-500">{date(lease.startDate)} – {date(lease.endDate)} · {lease.parties.map(({ tenantOrganisation }) => tenantOrganisation.tenant.preferredName || tenantOrganisation.tenant.legalName).join(", ")}</p></div><span className="self-start rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{lease.status}</span></Link>)}</div>;
}
