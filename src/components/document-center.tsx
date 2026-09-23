"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

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
type CenterResponse = { items: DocumentEntry[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };

const FILTER_FIELDS = [
  ["propertyId", "Property ID"], ["unitId", "Unit ID"], ["tenantOrganisationId", "Tenant ID"], ["leaseId", "Lease ID"],
  ["paymentId", "Payment ID"], ["maintenanceRequestId", "Maintenance request ID"], ["applicationId", "Application ID"], ["inspectionId", "Inspection ID"],
] as const;
const TYPES = ["LISTING_MEDIA", "MAINTENANCE_ATTACHMENT", "MOVE_IN_INSPECTION_MEDIA", "MOVE_OUT_INSPECTION_MEDIA", "APPLICATION_DOCUMENT", "PROVIDER_EVIDENCE", "RECEIPT", "TENANT_STATEMENT", "MOVE_OUT_STATEMENT", "LEASE_AGREEMENT"];
const UPLOAD_TARGETS = ["MAINTENANCE_ATTACHMENT", "MOVE_IN_INSPECTION_MEDIA", "MOVE_OUT_INSPECTION_MEDIA", "APPLICATION_DOCUMENT"];
const channelLabel = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/(^| )\w/g, (letter) => letter.toUpperCase());
const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const fileKind = (contentType: string) => contentType === "application/pdf" ? "PDF" : contentType.startsWith("image/") ? "Image" : contentType.includes("spreadsheet") ? "Spreadsheet" : contentType.includes("document") ? "Document" : "File";
const headers = (organisationId: string, json = false) => ({ "x-organisation-id": organisationId, ...(json ? { "content-type": "application/json" } : {}) });

function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read this file."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

export function DocumentCenter() {
  const [organisationId, setOrganisationId] = useState("");
  const [data, setData] = useState<CenterResponse | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [downloadUrls, setDownloadUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [page, setPage] = useState(1);
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  const load = useCallback(async (orgId: string, activeFilters: Record<string, string>, nextPage = 1) => {
    const params = new URLSearchParams({ ...activeFilters, page: String(nextPage), pageSize: "25" });
    const response = await fetch(`/api/documents/center?${params.toString()}`, { headers: headers(orgId) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "Unable to load the Document Center.");
    setData(body as CenterResponse); setPage(nextPage);
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

  async function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget); const next: Record<string, string> = {};
    for (const [key] of FILTER_FIELDS) { const value = String(form.get(key) ?? "").trim(); if (value) next[key] = value; }
    for (const key of ["type", "dateFrom", "dateTo"]) { const value = String(form.get(key) ?? "").trim(); if (value) next[key] = value; }
    setActiveFilters(next);
    await load(organisationId, next).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load the Document Center."));
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setUploading(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget); const file = form.get("file");
    if (!(file instanceof File) || !file.size) { setError("Choose a file to upload."); setUploading(false); return; }
    try {
      const targetType = String(form.get("targetType"));
      const payload: Record<string, unknown> = { targetType, targetId: String(form.get("targetId")), fileName: file.name, contentType: file.type || "application/octet-stream", dataBase64: await readAsBase64(file), classification: "PRIVATE" };
      if (targetType === "LISTING_MEDIA") payload.mediaType = String(form.get("mediaType"));
      if (targetType === "APPLICATION_DOCUMENT") payload.documentType = String(form.get("documentType"));
      if (targetType === "MOVE_IN_INSPECTION_MEDIA") payload.areaId = String(form.get("areaId"));
      const response = await fetch("/api/documents/uploads", { method: "POST", headers: headers(organisationId, true), body: JSON.stringify(payload) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Unable to upload this document.");
      event.currentTarget.reset(); setNotice("Document uploaded and secured."); await load(organisationId, {});
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to upload this document."); } finally { setUploading(false); }
  }

  async function resolveDownload(item: DocumentEntry) {
    setError(""); const response = await fetch(`/api/documents/${item.id}/signed-url`, { headers: headers(organisationId) }); const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to resolve a secure access link.");
    setDownloadUrls((current) => ({ ...current, [item.id]: body.url }));
  }

  return <div className="grid gap-6">
    {(error || notice) && <p className={`rounded-xl border p-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-teal/20 bg-teal/10 text-teal"}`}>{error || notice}</p>}
    <section className="rounded-3xl border border-hairline bg-white p-6 shadow-sm sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal">SECURE RECORDS</p><h1 className="mt-2 text-3xl font-semibold text-forest">Everything in its place.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Access uploaded and generated documents across your properties, leases, payments and operations, filtered by the permissions you hold.</p></div><div className="rounded-2xl bg-cream px-4 py-3 text-right"><p className="text-xs uppercase tracking-wide text-gold">Library</p><p className="mt-1 text-2xl font-semibold text-forest">{data?.pagination.total ?? "—"}</p><p className="text-xs text-muted">visible records</p></div></div></section>
    <section className="rounded-3xl border border-hairline bg-white p-5 shadow-sm"><div><h2 className="text-xl font-semibold text-forest">Upload a document</h2><p className="mt-1 text-sm text-muted">Files are validated, scanned and stored privately before they appear in this library.</p></div><form className="mt-5 grid gap-3 md:grid-cols-3" onSubmit={(event) => void upload(event)}><label className="grid gap-1 text-sm font-medium text-forest">File<input className="rounded-xl border border-hairline bg-warm-white p-2.5 text-sm" name="file" required type="file" /></label><label className="grid gap-1 text-sm font-medium text-forest">Upload target<select className="rounded-xl border border-hairline bg-warm-white p-2.5 text-sm" name="targetType" defaultValue="MAINTENANCE_ATTACHMENT">{UPLOAD_TARGETS.map((type) => <option key={type} value={type}>{channelLabel(type)}</option>)}</select></label><label className="grid gap-1 text-sm font-medium text-forest">Related record ID<input className="rounded-xl border border-hairline bg-warm-white p-2.5 text-sm" name="targetId" placeholder="UUID" required /></label><label className="grid gap-1 text-sm font-medium text-forest">Inspection area ID <span className="font-normal text-muted">(move-in media)</span><input className="rounded-xl border border-hairline bg-warm-white p-2.5 text-sm" name="areaId" placeholder="Required for move-in media" /></label><label className="grid gap-1 text-sm font-medium text-forest">Application type <span className="font-normal text-muted">(applications)</span><select className="rounded-xl border border-hairline bg-warm-white p-2.5 text-sm" name="documentType"><option>ID</option><option>INCOME</option><option>EMPLOYMENT</option><option>REFERENCE</option><option>OTHER</option></select></label><label className="grid gap-1 text-sm font-medium text-forest">Media type <span className="font-normal text-muted">(listing media)</span><select className="rounded-xl border border-hairline bg-warm-white p-2.5 text-sm" name="mediaType"><option>PHOTO</option><option>VIDEO</option><option>FLOOR_PLAN</option></select></label><button className="rounded-xl bg-forest px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted md:col-span-3" disabled={uploading} type="submit">{uploading ? "Securing document…" : "Upload document"}</button></form></section>
    <form className="grid gap-3 rounded-3xl border border-hairline bg-white p-5 shadow-sm md:grid-cols-3" onSubmit={(event) => void applyFilters(event)}><div className="md:col-span-3"><h2 className="text-xl font-semibold text-forest">Browse library</h2><p className="mt-1 text-sm text-muted">Filter by the real property, lease, tenant or workflow identifiers available to your organisation.</p></div>{FILTER_FIELDS.map(([key, label]) => <input className="rounded-xl border border-hairline bg-warm-white p-2.5 text-sm text-forest focus:border-teal focus:ring-2 focus:ring-teal/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal" key={key} name={key} placeholder={label} />)}<select className="rounded-xl border border-hairline bg-warm-white p-2.5 text-sm text-forest" name="type"><option value="">All document types</option>{TYPES.map((type) => <option key={type} value={type}>{channelLabel(type)}</option>)}</select><label className="grid gap-1 text-xs font-semibold text-muted">From<input className="rounded-xl border border-hairline bg-warm-white p-2.5 text-sm font-normal text-forest" name="dateFrom" type="date" /></label><label className="grid gap-1 text-xs font-semibold text-muted">To<input className="rounded-xl border border-hairline bg-warm-white p-2.5 text-sm font-normal text-forest" name="dateTo" type="date" /></label><button className="rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald md:col-span-3" type="submit">Apply filters</button></form>
    <section className="overflow-hidden rounded-3xl border border-hairline bg-white shadow-sm">{!data ? <p className="p-6 text-muted">Loading documents…</p> : data.items.length === 0 ? <div className="p-12 text-center"><p className="font-semibold text-forest">No documents match these filters.</p><p className="mt-1 text-sm text-muted">Uploaded or generated records will appear here when they are available to your organisation.</p></div> : <div className="divide-y divide-hairline">{data.items.map((item) => <article className="flex flex-wrap items-center justify-between gap-4 p-5 transition hover:bg-warm-white sm:p-6" key={item.id}><div className="flex min-w-0 items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cream text-[10px] font-bold uppercase tracking-wide text-forest">{fileKind(item.contentType)}</div><div className="min-w-0"><p className="truncate font-semibold text-forest">{item.fileName}</p><p className="mt-1 text-xs text-muted">{channelLabel(item.type)} · {item.kind === "GENERATED" ? "Generated" : "Uploaded"} · {formatBytes(item.sizeBytes)} · {new Date(item.createdAt).toLocaleString()}</p><div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(item.scope).filter(([, value]) => value).slice(0, 3).map(([key, value]) => <span className="rounded-full bg-surface px-2 py-1 text-[11px] text-muted" key={key}>{channelLabel(key)} · {String(value).slice(0, 14)}</span>)}<span className="rounded-full bg-teal/10 px-2 py-1 text-[11px] font-semibold text-teal">{item.classification}</span></div></div></div>{downloadUrls[item.id] ? <a className="rounded-xl bg-forest px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald" href={downloadUrls[item.id]} rel="noreferrer" target="_blank">Open securely</a> : <button className="rounded-xl border border-hairline px-3 py-2 text-sm font-semibold text-forest transition hover:border-teal hover:bg-surface" onClick={() => void resolveDownload(item)} type="button">Get secure link</button>}</article>)}</div>}{data && data.pagination.totalPages > 1 && <div className="flex items-center justify-between border-t border-hairline px-5 py-4 text-sm"><button className="font-semibold text-forest disabled:text-muted" disabled={page <= 1} onClick={() => void load(organisationId, activeFilters, page - 1)} type="button">← Previous</button><span className="text-muted">Page {page} of {data.pagination.totalPages}</span><button className="font-semibold text-forest disabled:text-muted" disabled={page >= data.pagination.totalPages} onClick={() => void load(organisationId, activeFilters, page + 1)} type="button">Next →</button></div>}</section>
  </div>;
}
