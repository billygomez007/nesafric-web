"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MaintenanceProviderPanel } from "@/components/maintenance-provider-panel";

type Assignee = { id: string; user: { displayName: string; email: string } };
type WorkOrder = { id: string; title: string; description: string | null; status: string; dueAt: string | null; estimateAmountMinor: string | null; actualCostAmountMinor: string | null; currencyCode: string; assigneeUser: { displayName: string } | null; history: { id: string; status: string; note: string | null; createdAt: string }[] };
type Detail = {
  id: string; title: string; description: string; category: string; priority: string; status: string; createdAt: string; completedAt: string | null; closedAt: string | null;
  property: { id: string; name: string; referenceNumber: string; currencyCode: string }; unit: { id: string; name: string } | null;
  tenantOrganisation: { id: string; tenant: { legalName: string; preferredName: string | null } } | null; reportedBy: { displayName: string };
  attachments: { id: string; fileKey: string; fileName: string; contentType: string | null }[];
  history: { id: string; type: string; fromStatus: string | null; toStatus: string | null; note: string | null; createdAt: string; actor: { displayName: string } }[];
  approvals: { id: string; status: string; requestedAmountMinor: string; approvedAmountMinor: string | null; currencyCode: string; requestReason: string | null; decisionReason: string | null; requestedAt: string; decidedAt: string | null }[];
  workOrders: WorkOrder[];
};

const transitionActions: Record<string, { status: string; label: string }[]> = {
  REPORTED: [{ status: "TRIAGED", label: "Mark triaged" }],
  TRIAGED: [{ status: "APPROVED", label: "Approve without estimate" }, { status: "REJECTED", label: "Reject" }],
  ASSIGNED: [{ status: "IN_PROGRESS", label: "Start work" }],
  IN_PROGRESS: [{ status: "COMPLETED", label: "Complete work" }],
  COMPLETED: [{ status: "CLOSED", label: "Close request" }],
};

export function MaintenanceDetail({ requestId }: { requestId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Choose an organisation to view maintenance.");
    const response = await fetch(`/api/maintenance/requests/${requestId}`, { headers: { "x-organisation-id": organisationId } });
    if (!response.ok) return setError((await response.json()).error?.message ?? "Unable to load maintenance request.");
    setDetail(await response.json());
    const assigneeResponse = await fetch("/api/maintenance/assignees", { headers: { "x-organisation-id": organisationId } });
    if (assigneeResponse.ok) setAssignees(await assigneeResponse.json());
  }, [requestId]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function mutate(url: string, method: string, body: unknown, message: string) {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return;
    setBusy(true); setError(""); setSuccess("");
    const response = await fetch(url, { method, headers: { "content-type": "application/json", "x-organisation-id": organisationId }, body: JSON.stringify(body) });
    if (!response.ok) setError((await response.json()).error?.message ?? "Unable to update maintenance.");
    else { setSuccess(message); await load(); }
    setBusy(false);
  }

  if (error && !detail) return <p className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</p>;
  if (!detail) return <p className="rounded-xl border bg-white p-6 text-slate-600">Loading maintenance request...</p>;
  const pendingApproval = detail.approvals.find((approval) => approval.status === "PENDING");
  return <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
    <div className="grid gap-6">
      <section className="rounded-2xl border bg-white p-6 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap gap-2 text-xs font-semibold"><span className="rounded-full bg-slate-100 px-2 py-1">{detail.status}</span><span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800">{detail.priority}</span><span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-800">{detail.category}</span></div><h2 className="mt-3 text-2xl font-semibold">{detail.title}</h2></div><p className="text-sm text-slate-500">{new Intl.DateTimeFormat("en-GH", { dateStyle: "medium" }).format(new Date(detail.createdAt))}</p></div><p className="mt-4 whitespace-pre-wrap text-slate-700">{detail.description}</p><dl className="mt-6 grid gap-4 border-t pt-5 sm:grid-cols-2"><Info label="Property" value={`${detail.property.name} (${detail.property.referenceNumber})`} /><Info label="Unit" value={detail.unit?.name ?? "Whole property"} /><Info label="Reported by" value={detail.reportedBy.displayName} /><Info label="Tenant" value={detail.tenantOrganisation ? detail.tenantOrganisation.tenant.preferredName || detail.tenantOrganisation.tenant.legalName : "Internal report"} /></dl><div className="mt-4 flex flex-wrap gap-4 text-sm font-semibold text-emerald-700"><Link href={`/maintenance/properties/${detail.property.id}`}>View property history →</Link>{detail.tenantOrganisation && <Link href={`/tenants/${detail.tenantOrganisation.id}`}>View tenant history →</Link>}</div></section>
      <section className="rounded-2xl border bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Status and notes</h2>{detail.history.length ? <ol className="mt-5 border-l-2 border-slate-200 pl-5">{[...detail.history].reverse().map((item) => <li className="relative mb-5 last:mb-0" key={item.id}><span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full bg-emerald-500 ring-4 ring-white" /><p className="font-medium">{item.type === "STATUS" ? `${item.fromStatus} → ${item.toStatus}` : item.type}</p><p className="text-sm text-slate-500">{item.actor.displayName} · {new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</p>{item.note && <p className="mt-1 text-sm text-slate-700">{item.note}</p>}</li>)}</ol> : <p className="mt-4 text-slate-500">No history yet.</p>}</section>
      <section className="rounded-2xl border bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Work orders</h2>{detail.workOrders.length ? <div className="mt-4 grid gap-4">{detail.workOrders.map((workOrder) => <WorkOrderCard key={workOrder.id} workOrder={workOrder} detail={detail} assignees={assignees} busy={busy} mutate={mutate} />)}</div> : <p className="mt-4 rounded-xl border border-dashed p-6 text-center text-slate-500">No work order has been created.</p>}</section>
      <MaintenanceProviderPanel maintenanceRequestId={detail.id} currencyCode={detail.property.currencyCode} workOrders={detail.workOrders} />
    </div>
    <aside className="grid content-start gap-6">
      {(error || success) && <p className={`rounded-xl p-4 text-sm ${error ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{error || success}</p>}
      <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">Request actions</h2><div className="mt-4 grid gap-3">{transitionActions[detail.status]?.map((action) => <button className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={busy} key={action.status} onClick={() => mutate(`/api/maintenance/requests/${detail.id}/transition`, "PATCH", { status: action.status }, action.label)}>{action.label}</button>)}{detail.status === "TRIAGED" && <ApprovalRequestForm busy={busy} currency={detail.property.currencyCode} onSubmit={(body) => mutate(`/api/maintenance/requests/${detail.id}/approval`, "POST", body, "Approval requested.")} />}{detail.status === "APPROVED" && <WorkOrderForm busy={busy} currency={detail.property.currencyCode} onSubmit={(body) => mutate(`/api/maintenance/requests/${detail.id}/work-orders`, "POST", body, "Work order created.")} />}<NoteForm busy={busy} onSubmit={(note) => mutate(`/api/maintenance/requests/${detail.id}/notes`, "POST", { note }, "Note added.")} /></div></section>
      {pendingApproval && <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">Pending approval</h2><p className="mt-2 text-2xl font-semibold">{formatMoney(pendingApproval.requestedAmountMinor, pendingApproval.currencyCode)}</p>{pendingApproval.requestReason && <p className="mt-2 text-sm text-slate-600">{pendingApproval.requestReason}</p>}<div className="mt-4 grid grid-cols-2 gap-2"><button className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white" disabled={busy} onClick={() => mutate(`/api/maintenance/requests/${detail.id}/approval/approve`, "POST", {}, "Approval granted.")}>Approve</button><button className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700" disabled={busy} onClick={() => mutate(`/api/maintenance/requests/${detail.id}/approval/reject`, "POST", {}, "Approval rejected.")}>Reject</button></div></section>}
      <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">Approvals</h2>{detail.approvals.length ? <div className="mt-3 grid gap-3">{detail.approvals.map((approval) => <div className="rounded-lg border p-3 text-sm" key={approval.id}><div className="flex justify-between gap-2"><strong>{approval.status}</strong><span>{formatMoney(approval.approvedAmountMinor ?? approval.requestedAmountMinor, approval.currencyCode)}</span></div>{(approval.decisionReason || approval.requestReason) && <p className="mt-1 text-slate-600">{approval.decisionReason || approval.requestReason}</p>}</div>)}</div> : <p className="mt-3 text-sm text-slate-500">No approval decisions.</p>}</section>
      {detail.attachments.length > 0 && <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">Attachments</h2><div className="mt-3 grid gap-2">{detail.attachments.map((attachment) => <div className="rounded-lg border p-3 text-sm" key={attachment.id}><p className="font-medium">{attachment.fileName}</p><p className="truncate text-slate-500">{attachment.contentType ?? attachment.fileKey}</p></div>)}</div></section>}
    </aside>
  </div>;
}

function WorkOrderCard({ workOrder, detail, assignees, busy, mutate }: { workOrder: WorkOrder; detail: Detail; assignees: Assignee[]; busy: boolean; mutate: (url: string, method: string, body: unknown, message: string) => Promise<void> }) {
  return <article className="rounded-xl border p-4"><div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-semibold">{workOrder.title}</h3><p className="text-sm text-slate-500">{workOrder.status}{workOrder.assigneeUser ? ` · ${workOrder.assigneeUser.displayName}` : ""}</p></div><div className="text-right text-sm"><p>Estimate: {formatMoney(workOrder.estimateAmountMinor, workOrder.currencyCode)}</p><p>Actual: {formatMoney(workOrder.actualCostAmountMinor, workOrder.currencyCode)}</p></div></div>{workOrder.description && <p className="mt-3 text-sm text-slate-700">{workOrder.description}</p>}{["OPEN", "ASSIGNED"].includes(workOrder.status) && <div className="mt-4 grid gap-3 border-t pt-4 md:grid-cols-2"><form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void mutate(`/api/maintenance/work-orders/${workOrder.id}/assign`, "PATCH", { assigneeMemberId: data.get("assigneeMemberId") }, "Work order assigned."); }}><select className="min-w-0 flex-1 rounded-lg border p-2 text-sm" name="assigneeMemberId" required defaultValue=""><option value="">Assign member</option>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.user.displayName}</option>)}</select><button className="rounded-lg border px-3 text-sm font-semibold" disabled={busy}>Assign</button></form><CostForm label="Record estimate" disabled={busy} onSubmit={(amountMinor) => mutate(`/api/maintenance/work-orders/${workOrder.id}/cost`, "PATCH", { type: "ESTIMATE", amountMinor, currencyCode: detail.property.currencyCode }, "Estimate recorded.")} /></div>}{workOrder.status === "IN_PROGRESS" && <div className="mt-4 border-t pt-4"><CostForm label="Record actual cost" disabled={busy} onSubmit={(amountMinor) => mutate(`/api/maintenance/work-orders/${workOrder.id}/cost`, "PATCH", { type: "ACTUAL", amountMinor, currencyCode: detail.property.currencyCode }, "Actual cost recorded.")} /></div>}</article>;
}

function ApprovalRequestForm({ currency, busy, onSubmit }: { currency: string; busy: boolean; onSubmit: (body: unknown) => void }) { return <form className="grid gap-2 rounded-lg border p-3" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); onSubmit({ requestedAmountMinor: String(Math.round(Number(data.get("amount")) * 100)), currencyCode: currency, reason: data.get("reason") || undefined }); }}><p className="text-sm font-semibold">Request cost approval</p><input className="rounded-lg border p-2 text-sm" min={0} name="amount" placeholder={`Amount (${currency})`} required step="0.01" type="number" /><input className="rounded-lg border p-2 text-sm" name="reason" placeholder="Reason (optional)" /><button className="rounded-lg border p-2 text-sm font-semibold" disabled={busy}>Request approval</button></form>; }
function WorkOrderForm({ currency, busy, onSubmit }: { currency: string; busy: boolean; onSubmit: (body: unknown) => void }) { return <form className="grid gap-2 rounded-lg border p-3" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); onSubmit({ title: data.get("title"), description: data.get("description") || undefined, currencyCode: currency }); }}><p className="text-sm font-semibold">Create work order</p><input className="rounded-lg border p-2 text-sm" name="title" placeholder="Work order title" required /><textarea className="rounded-lg border p-2 text-sm" name="description" placeholder="Instructions" /><button className="rounded-lg border p-2 text-sm font-semibold" disabled={busy}>Create work order</button></form>; }
function NoteForm({ busy, onSubmit }: { busy: boolean; onSubmit: (note: string) => void }) { return <form className="grid gap-2 rounded-lg border p-3" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); onSubmit(String(data.get("note"))); event.currentTarget.reset(); }}><p className="text-sm font-semibold">Add internal note</p><textarea className="rounded-lg border p-2 text-sm" minLength={1} name="note" required /><button className="rounded-lg border p-2 text-sm font-semibold" disabled={busy}>Add note</button></form>; }
function CostForm({ label, disabled, onSubmit }: { label: string; disabled: boolean; onSubmit: (amountMinor: string) => void }) { return <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); onSubmit(String(Math.round(Number(new FormData(event.currentTarget).get("amount")) * 100))); }}><input className="min-w-0 flex-1 rounded-lg border p-2 text-sm" min={0} name="amount" placeholder="Amount" required step="0.01" type="number" /><button className="rounded-lg border px-3 text-sm font-semibold" disabled={disabled}>{label}</button></form>; }
function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1">{value}</dd></div>; }
function formatMoney(value: string | null, currency: string) { return value === null ? "—" : new Intl.NumberFormat("en-GH", { style: "currency", currency }).format(Number(value) / 100); }
