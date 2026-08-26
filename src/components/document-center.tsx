"use client";

import { useCallback, useEffect, useState } from "react";

type DocumentEntry = {
  id: string;
  kind: "UPLOADED" | "GENERATED";
  type: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  classification: string;
  createdAt: string;
  scope: Record<string, string | null>;
};

const FILTER_FIELDS = [
  ["propertyId", "Property ID"],
  ["unitId", "Unit ID"],
  ["tenantOrganisationId", "Tenant ID"],
  ["leaseId", "Lease ID"],
  ["paymentId", "Payment ID"],
  ["maintenanceRequestId", "Maintenance request ID"],
  ["applicationId", "Application ID"],
  ["inspectionId", "Inspection ID"],
] as const;

const TYPES = [
  "LISTING_MEDIA", "MAINTENANCE_ATTACHMENT", "MOVE_IN_INSPECTION_MEDIA", "MOVE_OUT_INSPECTION_MEDIA",
  "APPLICATION_DOCUMENT", "PROVIDER_EVIDENCE", "RECEIPT", "TENANT_STATEMENT", "MOVE_OUT_STATEMENT", "LEASE_AGREEMENT",
];

/** Secure Document Center (item 8): permission-checked filters across property/unit/tenant/lease/payment/maintenance/application/inspection/type/date. Staff-only. */
export function DocumentCenter() {
  const [organisationId, setOrganisationId] = useState("");
  const [items, setItems] = useState<DocumentEntry[] | null>(null);
  const [error, setError] = useState("");
  const [downloadUrls, setDownloadUrls] = useState<Record<string, string>>({});

  const load = useCallback(async (orgId: string, activeFilters: Record<string, string>) => {
    const params = new URLSearchParams(Object.fromEntries(Object.entries(activeFilters).filter(([, value]) => value)));
    const response = await fetch(`/api/documents/center?${params.toString()}`, { headers: { "x-organisation-id": orgId } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "Unable to load the Document Center.");
    setItems(body.items as DocumentEntry[]);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const orgId = localStorage.getItem("propertyos.activeOrganisationId") ?? "";
      setOrganisationId(orgId);
      if (!orgId) return setError("Choose an organisation.");
      void load(orgId, {}).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load the Document Center."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const next: Record<string, string> = {};
    for (const [key] of FILTER_FIELDS) { const value = String(form.get(key) ?? "").trim(); if (value) next[key] = value; }
    const type = String(form.get("type") ?? "").trim();
    if (type) next.type = type;
    await load(organisationId, next).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load the Document Center."));
  }

  async function resolveDownload(item: DocumentEntry) {
    const response = await fetch(`/api/documents/${item.id}/signed-url`, { headers: { "x-organisation-id": organisationId } });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to resolve a download link.");
    setDownloadUrls((current) => ({ ...current, [item.id]: body.url }));
  }

  return <div className="grid gap-6">
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold">Document Center</h1>
      <p className="mt-1 text-sm text-slate-600">Every uploaded attachment and generated document across properties, units, tenants, leases, payments, maintenance, applications, and inspections — filtered by exactly what you have permission to see.</p>
    </section>
    {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <form className="grid gap-3 rounded-2xl border bg-white p-5 shadow-sm md:grid-cols-3" onSubmit={(event) => void applyFilters(event)}>
      {FILTER_FIELDS.map(([key, label]) => <input className="rounded-lg border p-2 text-sm" key={key} name={key} placeholder={label} />)}
      <select className="rounded-lg border p-2 text-sm" name="type"><option value="">All types</option>{TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select>
      <button className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white md:col-span-3">Apply filters</button>
    </form>
    <section className="grid gap-3">
      {!items ? <p className="rounded-xl border bg-white p-6 text-slate-500">Loading documents...</p>
        : items.length === 0 ? <p className="rounded-xl border bg-white p-6 text-slate-500">No documents match the current filters.</p>
        : items.map((item) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4 shadow-sm" key={item.id}>
          <div>
            <p className="font-semibold">{item.fileName}</p>
            <p className="text-xs text-slate-500">{item.type.replaceAll("_", " ")} · {item.kind} · {item.classification} · {new Date(item.createdAt).toLocaleString()}</p>
          </div>
          {downloadUrls[item.id]
            ? <a className="rounded-lg border px-3 py-2 text-sm font-semibold" href={downloadUrls[item.id]} rel="noreferrer" target="_blank">Open</a>
            : <button className="rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => void resolveDownload(item)}>Get link</button>}
        </div>)}
    </section>
  </div>;
}
