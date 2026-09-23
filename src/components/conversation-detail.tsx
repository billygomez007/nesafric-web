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

  if (!conversation) return <p className="rounded-2xl border border-hairline bg-white p-6 text-muted">{error || "Loading conversation..."}</p>;
  return <div className="grid gap-6 lg:grid-cols-3">
    {(error || notice) && <p className={`lg:col-span-3 rounded-xl border p-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-teal/20 bg-teal/10 text-teal"}`}>{error || notice}</p>}
    <section className="rounded-3xl border border-hairline bg-white p-5 shadow-sm sm:p-6 lg:col-span-2">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-forest">{conversation.channel.replaceAll("_", " ")}</span> <span className="ml-2 rounded-full bg-teal/10 px-2.5 py-1 text-xs font-semibold text-teal">{conversation.status.replaceAll("_", " ")}</span><h1 className="mt-3 text-2xl font-semibold text-forest">{conversation.subject || "Conversation"}</h1><p className="mt-1 text-sm text-muted">{conversation.tenantOrganisation?.tenant.legalName || conversation.marketplaceLead?.name || conversation.property?.name || "Conversation participant"}</p></div>
        <div className="flex flex-wrap gap-2 text-xs"><button className="rounded-xl border border-hairline px-3 py-2 font-semibold text-forest transition hover:border-teal hover:bg-surface" onClick={takeover} type="button">Take over</button><button className="rounded-xl border border-hairline px-3 py-2 font-semibold text-forest transition hover:border-teal hover:bg-surface" onClick={reassignToAI} type="button">Reassign to AI</button><button className="rounded-xl bg-forest px-3 py-2 font-semibold text-white transition hover:bg-emerald" onClick={() => void updateStatus("RESOLVED")} type="button">Resolve</button><button className="rounded-xl border border-hairline px-3 py-2 font-semibold text-forest transition hover:border-teal hover:bg-surface" onClick={() => void updateStatus("CLOSED")} type="button">Close</button></div>
      </header>
      <div className="mt-6 grid max-h-[34rem] gap-3 overflow-auto rounded-2xl bg-warm-white p-4 sm:p-5">
        {conversation.messages.map((message) => <div className={`max-w-[88%] rounded-2xl p-3 text-sm shadow-sm sm:max-w-[75%] ${message.direction === "OUTBOUND" ? "ml-auto bg-forest text-white" : "border border-hairline bg-white text-ink"}`} key={message.id}>
          <p className="text-xs font-semibold opacity-70">{message.senderType.replaceAll("_", " ")} · {new Date(message.createdAt).toLocaleString()}</p>
          <p className="mt-1 whitespace-pre-wrap">{message.body}</p>
          {message.deliveries.map((delivery) => <p className="mt-1 text-[11px] opacity-70" key={delivery.id}>Delivery: {delivery.status}{delivery.failureReason ? ` — ${delivery.failureReason}` : ""}</p>)}
        </div>)}
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row"><textarea aria-label="Message reply" className="min-h-20 flex-1 rounded-2xl border border-hairline bg-warm-white p-3 text-sm text-ink focus:border-teal focus:ring-2 focus:ring-teal/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal" onChange={(event) => setDraft(event.target.value)} placeholder="Reply as a team member..." rows={2} value={draft} /><button className="rounded-xl bg-forest px-5 py-3 font-semibold text-white transition hover:bg-emerald sm:self-end" onClick={() => void sendReply()} type="button">Send</button></div>
    </section>
    <aside className="grid gap-4">
      <section className="rounded-3xl border border-hairline bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-forest">Conversation context</h2>
        <dl className="mt-3 grid gap-2 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted">Identity</dt><dd className="text-right font-semibold text-forest">{conversation.identityLevel}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">AI employee</dt><dd className="text-right">{conversation.assignedAIEmployee?.name ?? "—"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">Human assignee</dt><dd className="text-right">{conversation.assignedMember?.user.displayName ?? "—"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">Tenant</dt><dd className="text-right">{conversation.tenantOrganisation?.tenant.legalName ?? "—"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">Property</dt><dd className="text-right">{conversation.property?.name ?? "—"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">Listing</dt><dd className="text-right">{conversation.listing?.title ?? "—"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">Lead</dt><dd className="text-right">{conversation.marketplaceLead?.name ?? "—"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">Maintenance</dt><dd className="text-right">{conversation.maintenanceRequest?.title ?? "—"}</dd></div>
        </dl>
      </section>
      {conversation.handoffs.length > 0 && <section className="rounded-3xl border border-gold/30 bg-cream p-5">
        <h2 className="font-semibold text-forest">Handoffs</h2>
        <div className="mt-3 grid gap-2">{conversation.handoffs.map((handoff) => <article className="rounded-2xl border border-gold/20 bg-white p-3 text-sm" key={handoff.id}><p className="font-semibold text-forest">{handoff.urgency} · {handoff.status}</p><p className="mt-1 text-muted">{handoff.reason}</p><p className="mt-1 text-xs text-muted">{handoff.contextSummary}</p></article>)}</div>
      </section>}
      <section className="rounded-3xl border border-hairline bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-forest">Assignment history</h2>
        <div className="mt-3 grid gap-2 text-sm">{conversation.assignments.map((assignment) => <p className="border-b border-hairline pb-2 text-xs text-muted" key={assignment.id}>{new Date(assignment.createdAt).toLocaleString()} · {assignment.assigneeType.replaceAll("_", " ")}{assignment.reason ? ` — ${assignment.reason}` : ""}</p>)}</div>
      </section>
    </aside>
  </div>;
}
