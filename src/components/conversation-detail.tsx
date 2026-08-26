"use client";

import { useCallback, useEffect, useState } from "react";

type Message = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  senderType: string;
  body: string;
  createdAt: string;
  deliveries: Array<{ id: string; status: string; failureReason: string | null }>;
};
type Handoff = { id: string; reason: string; urgency: string; status: string; contextSummary: string; createdAt: string };
type ConversationDetail = {
  id: string;
  channel: string;
  status: string;
  subject: string | null;
  identityLevel: string;
  aiSummary: string | null;
  assignedAIEmployee: { id: string; name: string; role: string } | null;
  assignedMember: { id: string; user: { id: string; displayName: string } } | null;
  tenantOrganisation: { id: string; tenant: { legalName: string } } | null;
  property: { id: string; name: string } | null;
  listing: { id: string; title: string } | null;
  marketplaceLead: { id: string; status: string; name: string } | null;
  maintenanceRequest: { id: string; title: string; status: string } | null;
  messages: Message[];
  handoffs: Handoff[];
  assignments: Array<{ id: string; assigneeType: string; reason: string | null; createdAt: string }>;
};

const headers = (organisationId: string, json = false) => ({ "x-organisation-id": organisationId, ...(json ? { "content-type": "application/json" } : {}) });
async function errorMessage(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
  return body.error?.message ?? "Unable to update this conversation.";
}

export function ConversationDetailView({ conversationId }: { conversationId: string }) {
  const [organisationId, setOrganisationId] = useState("");
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("");

  const load = useCallback(async (orgId: string) => {
    const response = await fetch(`/api/conversations/${conversationId}`, { headers: headers(orgId) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "Unable to load conversation.");
    setConversation(body as ConversationDetail);
  }, [conversationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const orgId = localStorage.getItem("propertyos.activeOrganisationId") ?? "";
      setOrganisationId(orgId);
      if (!orgId) return setError("Choose an organisation.");
      void load(orgId).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load conversation."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function sendReply() {
    if (!draft.trim()) return;
    setError(""); setNotice("");
    const response = await fetch(`/api/conversations/${conversationId}/messages`, { method: "POST", headers: headers(organisationId, true), body: JSON.stringify({ body: draft }) });
    if (!response.ok) return setError(await errorMessage(response));
    setDraft("");
    await load(organisationId);
  }

  async function takeover() {
    const response = await fetch(`/api/conversations/${conversationId}/assign`, { method: "POST", headers: headers(organisationId, true), body: JSON.stringify({ assigneeType: "ORG_MEMBER", organisationMemberId: window.prompt("Your organisation member id") }) });
    if (!response.ok) return setError(await errorMessage(response));
    setNotice("Conversation assigned to you.");
    await load(organisationId);
  }

  async function reassignToAI() {
    const aiEmployeeId = window.prompt("AI employee id to reassign to");
    if (!aiEmployeeId) return;
    const response = await fetch(`/api/conversations/${conversationId}/assign`, { method: "POST", headers: headers(organisationId, true), body: JSON.stringify({ assigneeType: "AI_EMPLOYEE", aiEmployeeId, reason: "Reassigned back to AI." }) });
    if (!response.ok) return setError(await errorMessage(response));
    setNotice("Conversation reassigned to AI.");
    await load(organisationId);
  }

  async function updateStatus(status: string) {
    const response = await fetch(`/api/conversations/${conversationId}/status`, { method: "PATCH", headers: headers(organisationId, true), body: JSON.stringify({ status }) });
    if (!response.ok) return setError(await errorMessage(response));
    setNotice(`Conversation marked ${status.toLowerCase()}.`);
    await load(organisationId);
  }

  if (!conversation) return <p className="rounded-xl border bg-white p-6">{error || "Loading conversation..."}</p>;
  return <div className="grid gap-6 lg:grid-cols-3">
    {(error || notice) && <p className={`lg:col-span-3 rounded-lg p-3 text-sm ${error ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{error || notice}</p>}
    <section className="rounded-2xl border bg-white p-5 shadow-sm lg:col-span-2">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold">{conversation.channel.replaceAll("_", " ")}</span> <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold">{conversation.status.replaceAll("_", " ")}</span><h1 className="mt-2 text-2xl font-semibold">{conversation.subject || "Conversation"}</h1></div>
        <div className="flex gap-2 text-xs"><button className="rounded border px-3 py-2 font-semibold" onClick={takeover}>Take over</button><button className="rounded border px-3 py-2 font-semibold" onClick={reassignToAI}>Reassign to AI</button><button className="rounded border px-3 py-2 font-semibold" onClick={() => void updateStatus("RESOLVED")}>Resolve</button><button className="rounded border px-3 py-2 font-semibold" onClick={() => void updateStatus("CLOSED")}>Close</button></div>
      </header>
      <div className="mt-5 grid max-h-[28rem] gap-3 overflow-auto rounded-lg bg-slate-50 p-4">
        {conversation.messages.map((message) => <div className={`max-w-[80%] rounded-xl p-3 text-sm ${message.direction === "OUTBOUND" ? "ml-auto bg-emerald-600 text-white" : "bg-white"}`} key={message.id}>
          <p className="text-xs font-semibold opacity-70">{message.senderType.replaceAll("_", " ")} · {new Date(message.createdAt).toLocaleString()}</p>
          <p className="mt-1 whitespace-pre-wrap">{message.body}</p>
          {message.deliveries.map((delivery) => <p className="mt-1 text-[11px] opacity-70" key={delivery.id}>Delivery: {delivery.status}{delivery.failureReason ? ` — ${delivery.failureReason}` : ""}</p>)}
        </div>)}
      </div>
      <div className="mt-4 flex gap-2"><textarea className="flex-1 rounded-lg border p-3 text-sm" onChange={(event) => setDraft(event.target.value)} placeholder="Reply as a team member..." rows={2} value={draft} /><button className="rounded-lg bg-slate-950 px-4 font-semibold text-white" onClick={sendReply}>Send</button></div>
    </section>
    <aside className="grid gap-4">
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Context</h2>
        <dl className="mt-3 grid gap-2 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Identity</dt><dd className="font-semibold">{conversation.identityLevel}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">AI employee</dt><dd>{conversation.assignedAIEmployee?.name ?? "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Human assignee</dt><dd>{conversation.assignedMember?.user.displayName ?? "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Tenant</dt><dd>{conversation.tenantOrganisation?.tenant.legalName ?? "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Property</dt><dd>{conversation.property?.name ?? "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Listing</dt><dd>{conversation.listing?.title ?? "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Lead</dt><dd>{conversation.marketplaceLead?.name ?? "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Maintenance</dt><dd>{conversation.maintenanceRequest?.title ?? "—"}</dd></div>
        </dl>
      </section>
      {conversation.handoffs.length > 0 && <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
        <h2 className="font-semibold text-amber-900">Handoffs</h2>
        <div className="mt-3 grid gap-2">{conversation.handoffs.map((handoff) => <article className="rounded-lg bg-white p-3 text-sm" key={handoff.id}><p className="font-semibold">{handoff.urgency} · {handoff.status}</p><p className="mt-1 text-slate-600">{handoff.reason}</p><p className="mt-1 text-xs text-slate-500">{handoff.contextSummary}</p></article>)}</div>
      </section>}
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Assignment history</h2>
        <div className="mt-3 grid gap-2 text-sm">{conversation.assignments.map((assignment) => <p className="border-b pb-2 text-xs text-slate-600" key={assignment.id}>{new Date(assignment.createdAt).toLocaleString()} · {assignment.assigneeType.replaceAll("_", " ")}{assignment.reason ? ` — ${assignment.reason}` : ""}</p>)}</div>
      </section>
    </aside>
  </div>;
}
