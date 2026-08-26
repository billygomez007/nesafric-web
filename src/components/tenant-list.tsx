"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Tenant = { id: string; email: string | null; phone: string | null; tenant: { legalName: string; preferredName: string | null } };

export function TenantList() {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) {
      const timer = setTimeout(() => setError("Choose an organisation to view tenants."), 0);
      return () => clearTimeout(timer);
    }
    fetch("/api/tenants", { headers: { "x-organisation-id": organisationId } })
      .then(async (response) => response.ok ? setTenants(await response.json()) : setError((await response.json()).error?.message ?? "Unable to load tenants."));
  }, []);
  if (error) return <p className="mt-8 rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</p>;
  if (!tenants) return <p className="mt-8 rounded-xl border bg-white p-6 text-slate-600">Loading tenants...</p>;
  if (!tenants.length) return <p className="mt-8 rounded-xl border border-dashed p-12 text-center text-slate-600">No tenants yet. Add the first tenant for this organisation.</p>;
  return <div className="mt-8 grid gap-3 sm:grid-cols-2">{tenants.map((tenant) => <Link className="rounded-xl border bg-white p-5 shadow-sm transition hover:border-emerald-500" href={`/tenants/${tenant.id}`} key={tenant.id}><p className="font-semibold">{tenant.tenant.preferredName || tenant.tenant.legalName}</p>{tenant.tenant.preferredName && <p className="text-sm text-slate-500">{tenant.tenant.legalName}</p>}<p className="mt-3 text-sm text-slate-600">{tenant.email || tenant.phone || "No contact details"}</p></Link>)}</div>;
}
