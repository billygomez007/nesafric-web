"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type OrgRow = {
  id: string;
  name: string;
  type: string;
  countryCode: string;
  createdAt: string;
  subscription: { status: string; currentPeriodEnd: string; trialEndsAt: string | null; plan: { key: string; name: string } } | null;
  _count: { members: number; properties: number };
};

const STATUS_STYLES: Record<string, string> = {
  TRIALING: "bg-blue-100 text-blue-800",
  ACTIVE: "bg-teal/10 text-teal",
  PAST_DUE: "bg-gold/10 text-ink",
  GRACE_PERIOD: "bg-gold/10 text-orange-800",
  SUSPENDED: "bg-red-50 text-red-800",
  CANCELLED: "bg-surface text-ink",
};

function OrganisationsContent() {
  const [rows, setRows] = useState<OrgRow[] | null>(null);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (search) query.set("search", search);
    const response = await fetch("/api/platform-admin/organisations?" + query.toString());
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to load organisations.");
    setRows(body as OrgRow[]);
  }

  useEffect(() => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (search) query.set("search", search);
    fetch("/api/platform-admin/organisations?" + query.toString()).then(async (response) => {
      const body = await response.json();
      if (response.ok) setRows(body as OrgRow[]);
      else setError(body.error?.message ?? "Unable to load organisations.");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>;

  return <div className="grid gap-4">
    <div className="flex flex-wrap gap-2">
      <input className="rounded-xl border border-hairline p-2 text-sm" onChange={(event) => setSearch(event.target.value)} placeholder="Search by name" value={search} />
      <select className="rounded-xl border border-hairline p-2 text-sm" onChange={(event) => setStatus(event.target.value)} value={status}>
        <option value="">All statuses</option>
        {["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD", "SUSPENDED", "CANCELLED"].map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      <button className="rounded-xl border border-hairline px-3 py-2 text-sm font-semibold" onClick={() => void load()}>Search</button>
    </div>
    {!rows ? <p className="text-muted">Loading…</p> : <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-warm-white"><tr><th className="p-3">Organisation</th><th className="p-3">Plan</th><th className="p-3">Status</th><th className="p-3">Members</th><th className="p-3">Properties</th><th className="p-3">Created</th></tr></thead>
        <tbody>{rows.map((row) => <tr className="border-b last:border-0" key={row.id}>
          <td className="p-3"><Link className="font-semibold text-teal" href={`/platform-admin/organisations/${row.id}`}>{row.name}</Link><p className="text-xs text-muted">{row.countryCode} · {row.type}</p></td>
          <td className="p-3">{row.subscription?.plan.name ?? "—"}</td>
          <td className="p-3">{row.subscription && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[row.subscription.status] ?? ""}`}>{row.subscription.status.replaceAll("_", " ")}</span>}</td>
          <td className="p-3">{row._count.members}</td>
          <td className="p-3">{row._count.properties}</td>
          <td className="p-3">{new Date(row.createdAt).toLocaleDateString()}</td>
        </tr>)}</tbody>
      </table>
      {rows.length === 0 && <p className="p-4 text-sm text-muted">No organisations match this filter.</p>}
    </div>}
  </div>;
}

export default function PlatformAdminOrganisationsPage() {
  return <PlatformAdminShell><OrganisationsContent /></PlatformAdminShell>;
}
