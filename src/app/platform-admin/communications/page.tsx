"use client";

import { FormEvent, useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type CommunicationsResponse = {
  summary: {
    total: number;
    handoffRequired: number;
    aiActive: number;
    byStatus: Record<string, number>;
    byChannel: Record<string, number>;
  };
  conversations: Array<{
    id: string;
    channel: string;
    status: string;
    subject: string | null;
    identityLevel: string;
    lastMessageAt: string | null;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    createdAt: string;
    updatedAt: string;
    organisation: {
      id: string;
      name: string;
    };
    assignedAIEmployee: {
      id: string;
      name: string;
      role: string;
      status: string;
    } | null;
    assignedMember: {
      id: string;
      user: {
        id: string;
        displayName: string;
      };
    } | null;
    _count: {
      messages: number;
      assignments: number;
      participants: number;
      voiceCalls: number;
    };
  }>;
};

const STATUSES = [
  "",
  "OPEN",
  "AI_ACTIVE",
  "HUMAN_REQUIRED",
  "HUMAN_ACTIVE",
  "WAITING_CUSTOMER",
  "RESOLVED",
  "CLOSED",
];

function CommunicationsContent() {
  const [data, setData] = useState<CommunicationsResponse | null>(null);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [status, setStatus] = useState("");
  const [activeStatus, setActiveStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ take: "100" });

    if (activeSearch.trim()) {
      params.set("search", activeSearch.trim());
    }

    if (activeStatus) {
      params.set("status", activeStatus);
    }

    fetch(`/api/platform-admin/communications?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.error?.message ?? "Unable to load communications.",
          );
        }

        return body as CommunicationsResponse;
      })
      .then((body) => {
        setData(body);
        setError("");
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load communications.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [activeSearch, activeStatus]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setActiveSearch(search);
    setActiveStatus(status);
  }

  return (
    <div className="grid gap-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
          Omnichannel operations
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-forest">
          Communications Control Center
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Privacy-aware platform oversight across conversations, channels and
          AI-to-human handoffs. Message bodies and contact addresses are not
          exposed in this console.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Total conversations", data?.summary.total ?? 0],
          ["AI active", data?.summary.aiActive ?? 0],
          ["Human required", data?.summary.handoffRequired ?? 0],
          ["Open", data?.summary.byStatus.OPEN ?? 0],
          ["Resolved", data?.summary.byStatus.RESOLVED ?? 0],
        ].map(([label, value]) => (
          <div
            className="rounded-xl border border-hairline bg-white p-4 shadow-card"
            key={String(label)}
          >
            <p className="text-xs uppercase tracking-wider text-muted">
              {label}
            </p>
            <p className="mt-2 text-2xl font-semibold text-forest">{value}</p>
          </div>
        ))}
      </section>

      <form
        className="grid gap-3 rounded-xl border border-hairline bg-white p-4 shadow-card md:grid-cols-[1fr_220px_auto_auto]"
        onSubmit={submit}
      >
        <input
          className="rounded-lg border border-hairline px-4 py-2.5 text-sm"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Subject or organisation"
          value={search}
        />

        <select
          className="rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm"
          onChange={(event) => setStatus(event.target.value)}
          value={status}
        >
          {STATUSES.map((entry) => (
            <option key={entry || "ALL"} value={entry}>
              {entry ? entry.replaceAll("_", " ") : "All statuses"}
            </option>
          ))}
        </select>

        <button
          className="rounded-lg bg-forest px-5 py-2.5 text-sm font-semibold text-white"
          type="submit"
        >
          Apply
        </button>

        <button
          className="rounded-lg border border-hairline px-5 py-2.5 text-sm font-semibold text-forest"
          onClick={() => {
            setLoading(true);
            setSearch("");
            setStatus("");
            setActiveSearch("");
            setActiveStatus("");
          }}
          type="button"
        >
          Reset
        </button>
      </form>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading communications…</p>
      ) : !data?.conversations.length ? (
        <div className="rounded-xl border border-hairline bg-white p-8 text-center shadow-card">
          <p className="font-semibold text-forest">
            No conversations found.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-hairline bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] text-left text-sm">
              <thead className="border-b border-hairline bg-warm-white text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-4">Conversation</th>
                  <th className="px-5 py-4">Organisation</th>
                  <th className="px-5 py-4">Channel</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4">Assigned to</th>
                  <th className="px-5 py-4">Messages</th>
                  <th className="px-5 py-4">Identity</th>
                  <th className="px-5 py-4">Last activity</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-hairline">
                {data.conversations.map((conversation) => (
                  <tr
                    className="align-top hover:bg-warm-white/60"
                    key={conversation.id}
                  >
                    <td className="px-5 py-4">
                      <p className="font-semibold text-forest">
                        {conversation.subject ?? "No subject"}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-muted">
                        {conversation.id.slice(0, 8)}
                      </p>
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {conversation.organisation.name}
                    </td>

                    <td className="px-5 py-4 text-xs font-semibold text-forest">
                      {conversation.channel.replaceAll("_", " ")}
                    </td>

                    <td className="px-5 py-4 text-xs font-semibold text-forest">
                      {conversation.status.replaceAll("_", " ")}
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {conversation.assignedMember?.user.displayName ??
                        conversation.assignedAIEmployee?.name ??
                        "Unassigned"}
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {conversation._count.messages}
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {conversation.identityLevel}
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {conversation.lastMessageAt
                        ? new Date(
                            conversation.lastMessageAt,
                          ).toLocaleString()
                        : "No messages"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlatformAdminCommunicationsPage() {
  return (
    <PlatformAdminShell>
      <CommunicationsContent />
    </PlatformAdminShell>
  );
}
