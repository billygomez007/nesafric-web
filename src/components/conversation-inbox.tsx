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
  OPEN: "bg-teal/10 text-teal",
  AI_ACTIVE: "bg-gold/10 text-forest",
  HUMAN_REQUIRED: "bg-cream text-forest",
  HUMAN_ACTIVE: "bg-teal/10 text-teal",
  WAITING_CUSTOMER: "bg-surface text-muted",
  RESOLVED: "bg-surface text-muted",
  CLOSED: "bg-surface text-muted",
};

const bucketLabels: Record<string, string> = {
  ALL: "All conversations",
  UNREAD: "Unread",
  AI_HANDLED: "AI handled",
  HUMAN_ASSIGNED: "Assigned to me",
  HANDOFF_REQUIRED: "Handoff required",
  TENANT: "Tenant",
  PROSPECT: "Prospect",
  MAINTENANCE: "Maintenance",
  LEASING: "Leasing",
  PROVIDER: "Provider",
  URGENT: "Urgent",
};

const channelLabels: Record<string, string> = { WEB_CHAT: "Website chat", EMAIL: "Email", WHATSAPP: "WhatsApp", SMS: "SMS", IN_APP: "NesAfric" };

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
    <section className="rounded-3xl border border-hairline bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal">COMMUNICATIONS</p><h1 className="mt-2 text-2xl font-semibold text-forest">Your conversations</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-muted">Bring enquiries, tenant messages and service conversations into one focused workspace.</p></div>
        <span className="rounded-full bg-cream px-3 py-1.5 text-xs font-semibold text-forest">{channel ? channelLabels[channel] ?? channel : "All channels"}</span>
      </div>
      <div className="mt-6 flex gap-2 overflow-x-auto pb-1" aria-label="Conversation buckets">{BUCKETS.map((value) => <button className={`shrink-0 rounded-full px-3 py-2 text-xs font-semibold transition ${bucket === value ? "bg-forest text-white" : "bg-surface text-muted hover:bg-cream hover:text-forest"}`} key={value} onClick={() => setBucket(value)} type="button">{bucketLabels[value] ?? value.replaceAll("_", " ")}</button>)}</div>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <label className="sr-only" htmlFor="inbox-channel">Channel</label><select className="rounded-xl border border-hairline bg-warm-white p-2.5 text-sm text-forest focus:border-teal focus:ring-2 focus:ring-teal/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal" id="inbox-channel" onChange={(event) => setChannel(event.target.value)} value={channel}>{CHANNELS.map((value) => <option key={value || "any"} value={value}>{value ? channelLabels[value] ?? value : "Any channel"}</option>)}</select>
        <label className="sr-only" htmlFor="inbox-status">Status</label><select className="rounded-xl border border-hairline bg-warm-white p-2.5 text-sm text-forest focus:border-teal focus:ring-2 focus:ring-teal/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal" id="inbox-status" onChange={(event) => setStatus(event.target.value)} value={status}>{STATUSES.map((value) => <option key={value || "any"} value={value}>{value ? value.replaceAll("_", " ") : "Any status"}</option>)}</select>
      </div>
    </section>
    {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <section className="overflow-hidden rounded-3xl border border-hairline bg-white shadow-sm">
      {!data ? <p className="p-6 text-muted">{error || "Loading conversations..."}</p> : data.items.length === 0 ? <div className="p-10 text-center"><p className="font-semibold text-forest">No conversations match these filters.</p><p className="mt-1 text-sm text-muted">New enquiries, tenant messages and service requests will appear here.</p></div> :
        <ul className="divide-y divide-hairline">{data.items.map((conversation) => <li key={conversation.id}>
          <Link className="group flex flex-wrap items-center justify-between gap-4 px-5 py-4 transition hover:bg-warm-white focus-visible:bg-warm-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-teal sm:px-6" href={`/inbox/${conversation.id}`}>
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-forest">{channelLabels[conversation.channel] ?? conversation.channel.replaceAll("_", " ")}</span><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusColor[conversation.status] ?? "bg-surface text-muted"}`}>{conversation.status.replaceAll("_", " ")}</span></div><p className="mt-2 truncate font-semibold text-forest group-hover:text-teal">{conversation.subject || "Conversation"}</p><p className="truncate text-sm text-muted">{conversation.tenantOrganisation?.tenant.legalName || conversation.marketplaceLead?.name || conversation.property?.name || "Unknown contact"}</p></div>
            <div className="text-left text-xs text-muted sm:text-right"><p className="font-medium text-forest">{conversation.assignedAIEmployee ? `AI · ${conversation.assignedAIEmployee.name}` : conversation.assignedMember ? `Human · ${conversation.assignedMember.user.displayName}` : "Unassigned"}</p><p className="mt-1">{conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toLocaleString() : ""}</p></div>
          </Link>
        </li>)}</ul>}
    </section>
  </div>;
}
