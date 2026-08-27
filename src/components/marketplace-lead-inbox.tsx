"use client";

import { useEffect, useState } from "react";

type LeadSummary = {
  id: string;
  status: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
  lastActivityAt: string;
  listing: { id: string; title: string; listingType: string; status: string };
  assignee: { id: string; user: { displayName: string; email: string } } | null;
};

type LeadDetail = LeadSummary & {
  privateNotes: string | null;
  history: Array<{ id: string; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }>;
  activities: Array<{ id: string; type: string; note: string | null; createdAt: string }>;
  viewingRequests: Array<{ id: string; status: string; createdAt: string }>;
};

type Member = { id: string; role: string; status: string; user: { displayName: string; email: string } };

const STATUS_OPTIONS = ["CONTACTED", "QUALIFIED", "VIEWING_SCHEDULED", "VIEWING_COMPLETED", "APPLICATION_STARTED", "APPLICATION_SUBMITTED", "CLOSED", "LOST"];

const STATUS_STYLES: Record<string, string> = {
  NEW: "bg-blue-50 text-blue-800",
  CONTACTED: "bg-indigo-50 text-indigo-800",
  QUALIFIED: "bg-violet-50 text-violet-800",
  VIEWING_SCHEDULED: "bg-amber-50 text-amber-800",
  VIEWING_COMPLETED: "bg-amber-100 text-amber-900",
  APPLICATION_STARTED: "bg-emerald-50 text-emerald-800",
  APPLICATION_SUBMITTED: "bg-emerald-100 text-emerald-900",
  CLOSED: "bg-slate-200 text-slate-700",
  LOST: "bg-red-50 text-red-700",
};

/** Marketplace CRM lead inbox (item 6) — reuses the existing `MarketplaceLead`/`ViewingRequest`
 * domains as-is; this is presentation only, no new lead/CRM data model. */
export function MarketplaceLeadInbox({ professionalId }: { professionalId: string }) {
  const [leads, setLeads] = useState<LeadSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pageSize = 20;

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (statusFilter) params.set("status", statusFilter);
    fetch(`/api/marketplace-professionals/${professionalId}/leads?${params}`).then(async (response) => {
      const body = await response.json();
      if (response.ok) { setLeads(body.items); setTotal(body.pagination.total); }
      else setError(body.error?.message ?? "Unable to load leads.");
    });
  }, [professionalId, page, statusFilter]);

  useEffect(() => {
    fetch(`/api/marketplace-professionals/${professionalId}`).then(async (response) => {
      const body = await response.json();
      if (response.ok) setMembers(body.members.filter((member: Member) => member.status === "ACTIVE"));
    });
  }, [professionalId]);

  async function openLead(leadId: string) {
    setSelectedId(leadId); setDetail(null); setError(""); setNotice("");
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/leads/${leadId}`);
    const body = await response.json();
    if (response.ok) setDetail(body);
    else setError(body.error?.message ?? "Unable to load this lead.");
  }

  async function refreshDetail() {
    if (!selectedId) return;
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/leads/${selectedId}`);
    const body = await response.json();
    if (response.ok) setDetail(body);
  }

  async function updateStatus(status: string) {
    if (!selectedId) return;
    setError(""); setNotice("");
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/leads/${selectedId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to update this lead.");
    setNotice("Lead updated."); await refreshDetail();
    setLeads((current) => current?.map((lead) => (lead.id === selectedId ? { ...lead, status } : lead)) ?? current);
  }

  async function assignRepresentative(memberId: string) {
    if (!selectedId || !memberId) return;
    setError(""); setNotice("");
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/leads/${selectedId}/assign`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ representativeMemberId: memberId }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to assign a representative.");
    setNotice("Representative assigned."); await refreshDetail();
  }

  async function saveNotes(notes: string) {
    if (!selectedId) return;
    setError(""); setNotice("");
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/leads/${selectedId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ privateNotes: notes }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to save notes.");
    setNotice("Notes saved.");
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Leads</h1>
          <p className="mt-1 text-sm text-slate-500">Enquiries across every listing this profile is attributed to, including properties marketed on behalf of an owner.</p>
        </div>
        <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} value={statusFilter}>
          <option value="">All statuses</option>
          <option value="NEW">New</option>
          {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
        </select>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {!leads ? (
            <p className="p-6 text-sm text-slate-500">Loading…</p>
          ) : leads.length === 0 ? (
            <div className="p-10 text-center">
              <p className="font-medium text-slate-700">No leads yet</p>
              <p className="mt-1 text-sm text-slate-500">Enquiries from your published listings will appear here as they come in.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {leads.map((lead) => (
                <li key={lead.id}>
                  <button
                    className={`flex w-full flex-col gap-1 px-5 py-4 text-left transition hover:bg-slate-50 ${selectedId === lead.id ? "bg-emerald-50/60" : ""}`}
                    onClick={() => void openLead(lead.id)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-900">{lead.name ?? lead.email ?? lead.phone ?? "Unnamed enquiry"}</span>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[lead.status] ?? "bg-slate-100 text-slate-700"}`}>{lead.status.replaceAll("_", " ")}</span>
                    </div>
                    <span className="text-sm text-slate-500">{lead.listing.title}</span>
                    <span className="text-xs text-slate-400">{lead.assignee ? `Assigned to ${lead.assignee.user.displayName}` : "Unassigned"} · {new Date(lead.lastActivityAt).toLocaleDateString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {total > pageSize && (
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm">
              <button className="font-medium text-slate-600 disabled:text-slate-300" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} type="button">← Previous</button>
              <span className="text-slate-500">Page {page} of {totalPages}</span>
              <button className="font-medium text-slate-600 disabled:text-slate-300" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} type="button">Next →</button>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {!selectedId ? (
            <p className="text-sm text-slate-500">Select a lead to see its detail, assign a representative, and track follow-up.</p>
          ) : !detail ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <div className="grid gap-5">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{detail.name ?? "Unnamed enquiry"}</h2>
                <p className="mt-1 text-sm text-slate-500">{[detail.email, detail.phone].filter(Boolean).join(" · ") || "No contact details supplied"}</p>
                <p className="mt-1 text-sm text-slate-500">Listing: <span className="font-medium text-slate-700">{detail.listing.title}</span></p>
              </div>

              <div className="grid gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="lead-status">Status</label>
                <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" id="lead-status" onChange={(event) => void updateStatus(event.target.value)} value={detail.status}>
                  <option disabled value={detail.status}>{detail.status.replaceAll("_", " ")}</option>
                  {STATUS_OPTIONS.filter((status) => status !== detail.status).map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
                </select>
              </div>

              <div className="grid gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="lead-rep">Assigned representative</label>
                <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" id="lead-rep" onChange={(event) => void assignRepresentative(event.target.value)} value="">
                  <option value="">{detail.assignee ? `Currently: ${detail.assignee.user.displayName}` : "Unassigned — choose a representative"}</option>
                  {members.map((member) => <option key={member.id} value={member.id}>{member.user.displayName}</option>)}
                </select>
              </div>

              <div className="grid gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="lead-notes">Private notes</label>
                <textarea className="min-h-24 rounded-lg border border-slate-200 px-3 py-2 text-sm" defaultValue={detail.privateNotes ?? ""} id="lead-notes" onBlur={(event) => void saveNotes(event.target.value)} />
                <p className="text-xs text-slate-400">Notes are internal to your team and are never shown publicly.</p>
              </div>

              {detail.viewingRequests.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Viewing requests</h3>
                  <ul className="mt-2 grid gap-1.5">
                    {detail.viewingRequests.map((viewing) => (
                      <li className="rounded-lg border border-slate-100 px-3 py-2 text-sm text-slate-600" key={viewing.id}>{viewing.status.replaceAll("_", " ")} · {new Date(viewing.createdAt).toLocaleDateString()}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Activity</h3>
                <ul className="mt-2 grid gap-1.5">
                  {detail.history.map((entry) => (
                    <li className="text-sm text-slate-600" key={entry.id}>
                      <span className="text-slate-400">{new Date(entry.createdAt).toLocaleDateString()}</span> — {entry.fromStatus ? `${entry.fromStatus.replaceAll("_", " ")} → ` : ""}{entry.toStatus.replaceAll("_", " ")}{entry.note ? `: ${entry.note}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
