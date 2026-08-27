"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type ConversationSummary = {
  id: string;
  channel: string;
  status: string;
  subject: string | null;
  lastMessageAt: string | null;
  updatedAt: string;
  assignedAIEmployee: { id: string; name: string } | null;
  assignedMember: { id: string; user: { displayName: string } } | null;
  tenantOrganisation: { id: string; tenant: { legalName: string } } | null;
  property: { id: string; name: string } | null;
  marketplaceLead: { id: string; name: string } | null;
};

type InboxResponse = { items: ConversationSummary[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };

const headers = (organisationId: string) => ({ "x-organisation-id": organisationId });
const BUCKETS = ["ALL", "UNREAD", "AI_HANDLED", "HUMAN_ASSIGNED", "HANDOFF_REQUIRED", "TENANT", "PROSPECT", "MAINTENANCE", "LEASING", "PROVIDER", "URGENT"];
const CHANNELS = ["", "WEB_CHAT", "EMAIL", "WHATSAPP", "SMS", "IN_APP"];
const STATUSES = ["", "OPEN", "AI_ACTIVE", "HUMAN_REQUIRED", "HUMAN_ACTIVE", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"];

const statusColor: Record<string, string> = {
  OPEN: "bg-blue-50 text-blue-800",
  AI_ACTIVE: "bg-violet-50 text-violet-800",
  HUMAN_REQUIRED: "bg-amber-50 text-amber-900",
  HUMAN_ACTIVE: "bg-emerald-50 text-emerald-800",
  WAITING_CUSTOMER: "bg-slate-100 text-slate-700",
  RESOLVED: "bg-slate-100 text-slate-500",
  CLOSED: "bg-slate-100 text-slate-500",
};

export function ConversationInbox() {
  const [data, setData] = useState<InboxResponse | null>(null);
  const [bucket, setBucket] = useState("ALL");
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (orgId: string, filters: { bucket: string; channel: string; status: string }) => {
    const params = new URLSearchParams();
    if (filters.bucket !== "ALL") params.set("bucket", filters.bucket);
    if (filters.channel) params.set("channel", filters.channel);
    if (filters.status) params.set("status", filters.status);
    const response = await fetch(`/api/conversations?${params.toString()}`, { headers: headers(orgId) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "Unable to load conversations.");
    setData(body as InboxResponse);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const orgId = localStorage.getItem("propertyos.activeOrganisationId") ?? "";
      if (!orgId) return setError("Choose an organisation to view the inbox.");
      void load(orgId, { bucket, channel, status }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load conversations."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, bucket, channel, status]);

  return <div className="grid gap-6">
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <h1 className="text-2xl font-semibold">Unified inbox</h1>
      <p className="mt-1 text-sm text-slate-600">Conversations across web chat, email, WhatsApp, and SMS, with AI receptionist and human handling in one place.</p>
      <div className="mt-4 flex flex-wrap gap-2">{BUCKETS.map((value) => <button className={`rounded-full px-3 py-1 text-xs font-semibold ${bucket === value ? "bg-slate-950 text-white" : "bg-slate-100"}`} key={value} onClick={() => setBucket(value)}>{value.replaceAll("_", " ")}</button>)}</div>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <select className="rounded-lg border p-2" onChange={(event) => setChannel(event.target.value)} value={channel}>{CHANNELS.map((value) => <option key={value || "any"} value={value}>{value || "Any channel"}</option>)}</select>
        <select className="rounded-lg border p-2" onChange={(event) => setStatus(event.target.value)} value={status}>{STATUSES.map((value) => <option key={value || "any"} value={value}>{value || "Any status"}</option>)}</select>
      </div>
    </section>
    {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      {!data ? <p className="p-4 text-slate-600">{error || "Loading conversations..."}</p> : data.items.length === 0 ? <p className="p-4 text-slate-600">No conversations match these filters.</p> :
        <ul className="divide-y">{data.items.map((conversation) => <li key={conversation.id}>
          <Link className="flex flex-wrap items-center justify-between gap-3 py-4 hover:bg-slate-50" href={`/inbox/${conversation.id}`}>
            <div>
              <div className="flex items-center gap-2"><span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold">{conversation.channel.replaceAll("_", " ")}</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusColor[conversation.status] ?? "bg-slate-100"}`}>{conversation.status.replaceAll("_", " ")}</span></div>
              <p className="mt-1 font-semibold">{conversation.subject || "Conversation"}</p>
              <p className="text-sm text-slate-600">{conversation.tenantOrganisation?.tenant.legalName || conversation.marketplaceLead?.name || conversation.property?.name || "Unknown contact"}</p>
            </div>
            <div className="text-right text-xs text-slate-500">
              <p>{conversation.assignedAIEmployee ? `AI · ${conversation.assignedAIEmployee.name}` : conversation.assignedMember ? `Human · ${conversation.assignedMember.user.displayName}` : "Unassigned"}</p>
              <p className="mt-1">{conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toLocaleString() : ""}</p>
            </div>
          </Link>
        </li>)}</ul>}
    </section>
  </div>;
}
