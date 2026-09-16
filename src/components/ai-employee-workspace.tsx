"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Item = { id: string; type?: string; status: string; reason?: string; actionKey?: string | null; createdAt: string };
type Workspace = {
  employee: { id: string; name: string; role: string; status: string; description: string | null; scope: string; timezone: string; responsibilities: unknown; instructions: unknown; escalationConfiguration: unknown; toolPermissions: Array<{ toolKey: string }>; autonomyPolicies: Array<{ policy: { actionKey: string; level: string } }> };
  assignments: { properties: Array<{ id: string; name: string; status: string }>; portfolios: Array<{ id: string; name: string }> };
  queue: { newItems: Item[]; attentionRequired: Item[]; pendingProposals: Item[]; escalations: Item[]; completedActions: Item[]; failedActions: Item[] };
  conversations: { incomingEnquiries: number; conversationsHandled: number; unresolvedConversations: number; handoffsRequired: number; humanHandoffs: number; resolvedConversations: number; responseMetrics: Record<string, number>; queue: Array<{ id: string; channel: string; status: string; subject: string | null }> };
  metrics: Record<string, string | number | boolean>;
  conflicts: Array<{ propertyId: string; ownerEmployeeId: string; overlappingEmployeeIds: string[] }>;
};
const headers = (organisationId: string, json = false) => ({ "x-organisation-id": organisationId, ...(json ? { "content-type": "application/json" } : {}) });

type VoiceCall = { id: string; direction: string; status: string; outcome: string; fromNumber: string; toNumber: string; createdAt: string };

export function AIEmployeeWorkspace({ employeeId }: { employeeId: string }) {
  const [organisationId, setOrganisationId] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [voiceCalls, setVoiceCalls] = useState<VoiceCall[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async (orgId: string) => {
    const response = await fetch(`/api/ai/employees/${employeeId}`, { headers: headers(orgId) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "Unable to load AI employee.");
    setWorkspace(body as Workspace);
  }, [employeeId]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const orgId = localStorage.getItem("propertyos.activeOrganisationId") ?? "";
      setOrganisationId(orgId);
      if (!orgId) return setError("Choose an organisation.");
      void load(orgId).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load AI employee."));
      fetch(`/api/organisations/${orgId}/voice/calls?aiEmployeeId=${employeeId}&pageSize=10`, { headers: headers(orgId) })
        .then(async (response) => { if (response.ok) setVoiceCalls((await response.json()).items); })
        .catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, employeeId]);
  async function changeStatus(status: string) {
    setError(""); setNotice("");
    const response = await fetch(`/api/ai/employees/${employeeId}`, { method: "PATCH", headers: headers(organisationId, true), body: JSON.stringify({ status }) });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to update employee.");
    await load(organisationId); setNotice(status === "ACTIVE" ? "AI employee activated." : "AI employee deactivated.");
  }
  async function resolveHandoff(handoffId: string) {
    const response = await fetch(`/api/ai/employees/${employeeId}/handoffs/${handoffId}`, { method: "PATCH", headers: headers(organisationId, true), body: JSON.stringify({ status: "RESOLVED" }) });
    if (!response.ok) return setError((await response.json()).error?.message ?? "Unable to resolve handoff.");
    await load(organisationId);
  }
  if (!workspace) return <p className="rounded-2xl border border-hairline bg-white p-6">{error || "Loading employee workspace..."}</p>;
  const { employee } = workspace;
  const queues = Object.entries(workspace.queue);
  return <div className="grid gap-6">
    {(error || notice) && <p className={`rounded-lg p-3 text-sm ${error ? "bg-red-50 text-red-800" : "bg-teal/10 text-teal"}`}>{error || notice}</p>}
    <section className={`rounded-2xl border-l-8 bg-white p-6 shadow-sm ${employee.role === "RECEPTIONIST" ? "border-l-gold" : "border-l-teal"}`}><div className="flex flex-wrap justify-between gap-4"><div><p className="text-sm font-semibold text-muted">AI {employee.role.replaceAll("_", " ")}</p><h1 className="text-3xl font-semibold">{employee.name}</h1><p className="mt-2 text-muted">{employee.description}</p></div><div className="text-right"><span className="rounded-full bg-surface px-3 py-1 text-xs font-semibold">{employee.status}</span><div className="mt-3"><button className="rounded-xl border border-hairline px-3 py-2 text-sm font-semibold" onClick={() => void changeStatus(employee.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")}>{employee.status === "ACTIVE" ? "Deactivate" : "Activate"}</button></div></div></div></section>
    <div className="grid gap-6 lg:grid-cols-3"><section className="rounded-3xl border border-hairline bg-white p-5 lg:col-span-2"><h2 className="text-lg font-semibold">Scope and authority</h2><p className="mt-2 text-sm">{employee.scope === "ORGANISATION" ? "Entire organisation" : "Selected assignments"} · {employee.timezone}</p><div className="mt-4 flex flex-wrap gap-2">{workspace.assignments.portfolios.map((item) => <span className="rounded-full bg-surface px-3 py-1 text-xs" key={item.id}>{item.name}</span>)}{workspace.assignments.properties.map((item) => <span className="rounded-full bg-teal/10 px-3 py-1 text-xs" key={item.id}>{item.name}</span>)}</div><h3 className="mt-5 font-semibold">Tools</h3><div className="mt-2 flex flex-wrap gap-2">{employee.toolPermissions.map(({ toolKey }) => <code className="rounded bg-surface px-2 py-1 text-xs" key={toolKey}>{toolKey}</code>)}</div><h3 className="mt-5 font-semibold">Autonomy</h3><div className="mt-2 grid gap-2">{employee.autonomyPolicies.map(({ policy }) => <p className="rounded-xl border border-hairline p-2 text-sm" key={`${policy.actionKey}-${policy.level}`}>{policy.actionKey} · {policy.level.replaceAll("_", " ")}</p>)}</div></section><section className="rounded-3xl border border-hairline bg-white p-5"><h2 className="text-lg font-semibold">Readiness metrics</h2><dl className="mt-4 grid gap-3">{Object.entries(workspace.metrics).map(([key, value]) => <div className="flex justify-between gap-3 border-b pb-2" key={key}><dt className="text-sm text-muted">{key.replaceAll(/([A-Z])/g, " $1")}</dt><dd className="font-semibold">{String(value)}</dd></div>)}</dl></section></div>
    {workspace.conflicts.length > 0 && <section className="rounded-xl border border-gold/40 bg-cream p-5"><h2 className="font-semibold text-forest">Assignment conflicts</h2><p className="mt-1 text-sm text-forest">Overlapping employees are routed deterministically to the oldest active assignment. Duplicate execution remains blocked.</p><p className="mt-2 text-sm">{workspace.conflicts.length} overlapping property assignment(s).</p></section>}
    {employee.role === "RECEPTIONIST" && <section className="rounded-3xl border border-hairline bg-white p-6"><h2 className="text-xl font-semibold">Conversations</h2><div className="mt-4 grid gap-3 sm:grid-cols-3 md:grid-cols-6">{Object.entries({ "Incoming enquiries": workspace.conversations.incomingEnquiries, "Handled": workspace.conversations.conversationsHandled, "Unresolved": workspace.conversations.unresolvedConversations, "Handoffs required": workspace.conversations.handoffsRequired, "Human handoffs": workspace.conversations.humanHandoffs, "Resolved": workspace.conversations.resolvedConversations }).map(([label, value]) => <div className="rounded-xl border border-hairline p-3 text-center" key={label}><p className="text-2xl font-semibold">{value}</p><p className="text-xs text-muted">{label}</p></div>)}</div><div className="mt-4 grid gap-2">{workspace.conversations.queue.slice(0, 10).map((conversation) => <Link className="rounded-lg bg-warm-white p-3 text-sm hover:bg-surface" href={`/inbox/${conversation.id}`} key={conversation.id}><strong>{conversation.subject || "Conversation"}</strong> <span className="text-muted">· {conversation.channel} · {conversation.status}</span></Link>)}</div></section>}
    {employee.role === "RECEPTIONIST" && voiceCalls && voiceCalls.length > 0 && <section className="rounded-3xl border border-hairline bg-white p-6"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Recent voice calls</h2><Link className="text-sm font-semibold text-teal" href="/ai/voice">View all →</Link></div><div className="mt-4 grid gap-2">{voiceCalls.map((call) => <div className="flex items-center justify-between rounded-lg bg-warm-white p-3 text-sm" key={call.id}><span>{call.direction === "INBOUND" ? call.fromNumber : call.toNumber} <span className="text-muted">· {call.direction.toLowerCase()}</span></span><span className="text-xs text-muted">{call.status.replaceAll("_", " ")} · {call.outcome.replaceAll("_", " ")}</span></div>)}</div></section>}
    <section className="rounded-3xl border border-hairline bg-white p-6"><h2 className="text-xl font-semibold">Work queue</h2><div className="mt-4 grid gap-4 md:grid-cols-2">{queues.map(([name, items]) => <div className="rounded-xl border p-4" key={name}><h3 className="font-semibold">{name.replaceAll(/([A-Z])/g, " $1")} <span className="text-muted">({items.length})</span></h3><div className="mt-3 grid gap-2">{items.slice(0, 10).map((item) => <article className="rounded-lg bg-warm-white p-3 text-sm" key={item.id}><strong>{item.actionKey || item.type || "Operational item"}</strong><p className="mt-1 text-muted">{item.reason || item.status}</p>{name === "escalations" && <button className="mt-2 text-xs font-semibold text-teal" onClick={() => void resolveHandoff(item.id)}>Resolve handoff</button>}</article>)}</div></div>)}</div></section>
    <section className="rounded-3xl border border-hairline bg-white p-6"><h2 className="text-xl font-semibold text-forest">Operating guidance</h2><p className="mt-2 text-sm leading-6 text-muted">This employee follows the organisation’s configured instructions and escalation rules. Sensitive execution configuration remains protected by the AI safety controls.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-cream p-4"><p className="text-xs font-semibold uppercase tracking-wide text-gold">Communication</p><p className="mt-2 text-sm text-forest">Configured greeting, tone and office-hour preferences are active.</p></div><div className="rounded-2xl bg-surface p-4"><p className="text-xs font-semibold uppercase tracking-wide text-teal">Escalation</p><p className="mt-2 text-sm text-forest">Uncertain or approval-gated work follows the configured human handoff route.</p></div></div></section>
  </div>;
}
