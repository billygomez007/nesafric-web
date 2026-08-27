"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type AIMessage = {
  id: string;
  role: string;
  content: string;
  structuredContent: JsonValue | null;
  createdAt: string;
};
type AIProposal = {
  id: string;
  sessionId: string;
  toolKey: string;
  explanation: string;
  reason: string;
  expectedResult: string;
  affectedEntities: Array<{ type: string; id: string }>;
  actionLevel: string;
  requiredPermission: string;
  status: string;
  arguments: JsonValue;
  executionResult: JsonValue | null;
  failureCode: string | null;
  failureMessage: string | null;
  expiresAt: string | null;
  createdAt: string;
};
type AISession = {
  id: string;
  title: string | null;
  providerKey: string;
  modelKey: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostNano: string | null;
  lastActivityAt: string;
  messages: AIMessage[];
  actionProposals: AIProposal[];
};
type Signal = { key: string; severity: string; count: number; label: string; href: string };
type Portfolio = {
  properties: number;
  units: number;
  availableUnits: number;
  occupiedUnits: number;
  activeLeases: number;
  publishedListings: number;
  openMaintenance: number;
  pendingApplications: number;
  failedJobs: number;
  failedNotifications: number;
  generatedAt: string;
};
type CommandCenter = {
  portfolio: Portfolio;
  attention: { signals: Signal[]; generatedAt: string };
  brief: {
    date: string;
    headline: string;
    attention: Signal[];
    expiringLeases: number;
    overdueRent: {
      currencies: Array<{
        currencyCode: string;
        obligations: number;
        outstandingAmountMinor: string;
      }>;
    };
  };
};
type APIError = { error?: { message?: string } };

const headers = (organisationId: string, json = false) => ({
  "x-organisation-id": organisationId,
  ...(json ? { "content-type": "application/json" } : {}),
});

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({})) as APIError;
  return body.error?.message ?? fallback;
}

const severityStyle: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800",
  HIGH: "bg-orange-100 text-orange-800",
  MEDIUM: "bg-amber-100 text-amber-800",
  LOW: "bg-slate-100 text-slate-700",
};

const proposalStyle: Record<string, string> = {
  PROPOSED: "bg-amber-100 text-amber-800",
  EXECUTING: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-slate-100 text-slate-700",
  FAILED: "bg-red-100 text-red-800",
  EXPIRED: "bg-slate-100 text-slate-700",
};

function JsonDetails({ value }: { value: JsonValue }) {
  return (
    <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-xs whitespace-pre-wrap text-slate-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function entityHref(entity: { type: string; id: string }) {
  if (entity.type === "property") return `/maintenance/properties/${entity.id}`;
  if (entity.type === "tenant") return `/tenants/${entity.id}`;
  if (entity.type === "lease") return `/leases/${entity.id}`;
  if (entity.type === "maintenance_request") return `/maintenance/${entity.id}`;
  if (entity.type === "work_order") return "/maintenance";
  if (entity.type === "provider") return `/providers/${entity.id}`;
  if (entity.type === "listing") return `/listings/${entity.id}`;
  if (entity.type === "lead") return `/leasing/leads/${entity.id}`;
  if (entity.type === "viewing") return `/leasing/viewings/${entity.id}`;
  return undefined;
}

export function AIPropertyManager() {
  const [organisationId, setOrganisationId] = useState("");
  const [commandCenter, setCommandCenter] = useState<CommandCenter | null>(null);
  const [commandCenterAllowed, setCommandCenterAllowed] = useState(true);
  const [sessions, setSessions] = useState<AISession[] | null>(null);
  const [sessionsAllowed, setSessionsAllowed] = useState(true);
  const [proposals, setProposals] = useState<AIProposal[] | null>(null);
  const [proposalsAllowed, setProposalsAllowed] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const loadSessions = useCallback(async (orgId: string, preferredId?: string) => {
    const response = await fetch("/api/ai/sessions", { headers: headers(orgId) });
    if (response.status === 403) {
      setSessionsAllowed(false);
      setSessions([]);
      return;
    }
    if (!response.ok) throw new Error(await responseError(response, "Unable to load AI sessions."));
    const next = await response.json() as AISession[];
    setSessions(next);
    setSelectedId((current) => {
      const candidate = preferredId ?? current;
      return next.some((session) => session.id === candidate) ? candidate : (next[0]?.id ?? "");
    });
  }, []);

  const loadProposals = useCallback(async (orgId: string) => {
    const response = await fetch("/api/ai/proposals", { headers: headers(orgId) });
    if (response.status === 403) {
      setProposalsAllowed(false);
      setProposals([]);
      return;
    }
    if (!response.ok) throw new Error(await responseError(response, "Unable to load action proposals."));
    setProposals(await response.json() as AIProposal[]);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const orgId = localStorage.getItem("propertyos.activeOrganisationId") ?? "";
      if (!orgId) {
        setError("Choose an organisation to open the AI workspace.");
        return;
      }
      setOrganisationId(orgId);
      void Promise.all([
        loadSessions(orgId),
        loadProposals(orgId),
        fetch("/api/ai/command-center", { headers: headers(orgId) }).then(async (response) => {
          if (response.status === 403) {
            setCommandCenterAllowed(false);
            return;
          }
          if (!response.ok) throw new Error(await responseError(response, "Unable to load the command center."));
          setCommandCenter(await response.json() as CommandCenter);
        }),
      ]).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load the AI workspace."));
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadProposals, loadSessions]);

  const selected = useMemo(
    () => sessions?.find((session) => session.id === selectedId) ?? null,
    [selectedId, sessions],
  );
  const visibleProposals = proposalsAllowed
    ? (proposals ?? [])
    : (sessions ?? []).flatMap((session) => session.actionProposals);

  async function createSession() {
    setBusy("session");
    setError("");
    try {
      const response = await fetch("/api/ai/sessions", {
        method: "POST",
        headers: headers(organisationId, true),
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error(await responseError(response, "Unable to start a conversation."));
      const created = await response.json() as AISession;
      await loadSessions(organisationId, created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start a conversation.");
    } finally {
      setBusy("");
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const content = message.trim();
    if (!content || !selected) return;
    setBusy("message");
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/ai/sessions/${selected.id}/messages`, {
        method: "POST",
        headers: headers(organisationId, true),
        body: JSON.stringify({ message: content }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Unable to send the message."));
      const result = await response.json() as { providerUnavailable?: boolean };
      if (result.providerUnavailable) {
        setNotice("The configured AI provider is unavailable. PropertyOS used its deterministic fallback.");
      }
      setMessage("");
      await loadSessions(organisationId, selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to send the message.");
    } finally {
      setBusy("");
    }
  }

  async function decideProposal(proposalId: string, decision: "APPROVE" | "REJECT") {
    const reason = decisionReasons[proposalId]?.trim() ?? "";
    if (reason.length < 3) return;
    setBusy(proposalId);
    setError("");
    try {
      const response = await fetch(`/api/ai/proposals/${proposalId}`, {
        method: "PATCH",
        headers: headers(organisationId, true),
        body: JSON.stringify({ decision, reason }),
      });
      if (!response.ok) {
        await Promise.all([loadSessions(organisationId, selectedId), loadProposals(organisationId)]);
        throw new Error(await responseError(response, "Unable to decide the proposal."));
      }
      await Promise.all([loadSessions(organisationId, selectedId), loadProposals(organisationId)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to decide the proposal.");
    } finally {
      setBusy("");
    }
  }

  if (error && !sessions) {
    return <p className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</p>;
  }
  if (!sessions) {
    return <p className="rounded-xl border bg-white p-6 text-slate-600">Loading AI workspace...</p>;
  }

  const metrics = commandCenter ? [
    ["Properties", commandCenter.portfolio.properties],
    ["Units", commandCenter.portfolio.units],
    ["Occupied", commandCenter.portfolio.occupiedUnits],
    ["Available", commandCenter.portfolio.availableUnits],
    ["Active leases", commandCenter.portfolio.activeLeases],
    ["Open maintenance", commandCenter.portfolio.openMaintenance],
    ["Applications", commandCenter.portfolio.pendingApplications],
    ["Published listings", commandCenter.portfolio.publishedListings],
  ] as const : [];

  return (
    <div className="grid gap-8">
      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
      {notice && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">{notice}</p>}

      {commandCenterAllowed && commandCenter && (
        <>
          <section>
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Command center</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Updated {new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(commandCenter.portfolio.generatedAt))}
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              {metrics.map(([label, value]) => (
                <div className="rounded-2xl border bg-white p-4 shadow-sm" key={label}>
                  <p className="text-sm text-slate-500">{label}</p>
                  <p className="mt-1 text-2xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border bg-white p-5 shadow-sm">
              <h2 className="text-xl font-semibold">Needs attention</h2>
              {commandCenter.attention.signals.length ? (
                <div className="mt-4 grid gap-3">
                  {commandCenter.attention.signals.map((signal) => (
                    <Link className="flex items-center justify-between gap-3 rounded-xl border p-3 transition hover:border-emerald-500" href={signal.href} key={signal.key}>
                      <div>
                        <p className="font-medium">{signal.label}</p>
                        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${severityStyle[signal.severity] ?? severityStyle.LOW}`}>
                          {signal.severity}
                        </span>
                      </div>
                      <span className="text-2xl font-semibold">{signal.count}</span>
                    </Link>
                  ))}
                </div>
              ) : <p className="mt-4 text-sm text-slate-600">No operational exceptions need attention.</p>}
            </section>

            <section className="rounded-2xl border bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-emerald-700">DAILY BRIEF · {commandCenter.brief.date}</p>
              <h2 className="mt-2 text-xl font-semibold">{commandCenter.brief.headline}</h2>
              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-500">Expiring leases</dt><dd className="mt-1 text-xl font-semibold">{commandCenter.brief.expiringLeases}</dd></div>
                <div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-500">Overdue obligations</dt><dd className="mt-1 text-xl font-semibold">{commandCenter.brief.overdueRent.currencies.reduce((sum, row) => sum + row.obligations, 0)}</dd></div>
              </dl>
              {commandCenter.brief.overdueRent.currencies.length > 0 && (
                <div className="mt-4 border-t pt-4">
                  <p className="text-sm font-semibold">Outstanding rent</p>
                  <ul className="mt-2 space-y-1 text-sm text-slate-600">
                    {commandCenter.brief.overdueRent.currencies.map((row) => (
                      <li className="flex justify-between gap-4" key={row.currencyCode}>
                        <span>{row.currencyCode} · {row.obligations} obligations</span>
                        <span>{new Intl.NumberFormat("en-GH", { style: "currency", currency: row.currencyCode }).format(Number(row.outstandingAmountMinor) / 100)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {proposals !== null && (
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-xl font-semibold">Organisation action proposals</h2>
            <p className="mt-1 text-sm text-slate-500">Pending and historical proposals across this organisation.</p>
          </div>
          {visibleProposals.length > 0 ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {visibleProposals.map((proposal) => (
                <article className="rounded-xl border p-4" key={proposal.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">{proposal.toolKey}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(proposal.createdAt))}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${proposalStyle[proposal.status] ?? proposalStyle.REJECTED}`}>{proposal.status}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-purple-100 px-2 py-1 font-semibold text-purple-800">{proposal.actionLevel.replaceAll("_", " ")}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">Permission: {proposal.requiredPermission}</span>
                  </div>
                  <p className="mt-3 text-sm text-slate-700">{proposal.explanation}</p>
                  <p className="mt-1 text-xs text-slate-500">Reason: {proposal.reason}</p>
                  <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"><span className="font-semibold">Expected result:</span> {proposal.expectedResult}</p>
                  {proposal.affectedEntities.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {proposal.affectedEntities.map((entity) => {
                        const href = entityHref(entity);
                        const label = `${entity.type.replaceAll("_", " ")} · ${entity.id.slice(0, 8)}`;
                        return href
                          ? <Link className="rounded-lg border px-2 py-1 text-xs font-medium text-emerald-700" href={href} key={`${entity.type}:${entity.id}`}>{label}</Link>
                          : <span className="rounded-lg border px-2 py-1 text-xs text-slate-600" key={`${entity.type}:${entity.id}`}>{label}</span>;
                      })}
                    </div>
                  )}
                  <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Action arguments</summary><JsonDetails value={proposal.arguments} /></details>
                  {proposal.status === "PROPOSED" && proposalsAllowed && (
                    <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                      <input
                        className="rounded-lg border px-3 py-2 text-sm"
                        onChange={(event) => setDecisionReasons((current) => ({ ...current, [proposal.id]: event.target.value }))}
                        placeholder="Decision reason (required)"
                        value={decisionReasons[proposal.id] ?? ""}
                      />
                      <button className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={(decisionReasons[proposal.id]?.trim().length ?? 0) < 3 || busy === proposal.id} onClick={() => void decideProposal(proposal.id, "APPROVE")} type="button">Approve</button>
                      <button className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-500" disabled={(decisionReasons[proposal.id]?.trim().length ?? 0) < 3 || busy === proposal.id} onClick={() => void decideProposal(proposal.id, "REJECT")} type="button">Reject</button>
                    </div>
                  )}
                  {proposal.executionResult !== null && <div className="mt-3"><p className="text-sm font-semibold text-emerald-700">Execution result</p><JsonDetails value={proposal.executionResult} /></div>}
                  {proposal.failureMessage && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800"><span className="font-semibold">{proposal.failureCode ?? "Execution failed"}:</span> {proposal.failureMessage}</p>}
                </article>
              ))}
            </div>
          ) : <p className="mt-4 rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">No action proposals have been created.</p>}
        </section>
      )}

      {sessionsAllowed && <section className="grid min-h-[34rem] overflow-hidden rounded-2xl border bg-white shadow-sm lg:grid-cols-[16rem_1fr]">
        <aside className="border-b bg-slate-50 p-4 lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Conversations</h2>
            <button className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={busy === "session"} onClick={() => void createSession()} type="button">
              New
            </button>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto lg:grid">
            {sessions.map((session, index) => (
              <button
                className={`min-w-44 rounded-lg border p-3 text-left text-sm lg:min-w-0 ${session.id === selectedId ? "border-emerald-600 bg-white" : "border-transparent hover:bg-white"}`}
                key={session.id}
                onClick={() => setSelectedId(session.id)}
                type="button"
              >
                <span className="block truncate font-medium">{session.title || `Conversation ${sessions.length - index}`}</span>
                <span className="mt-1 block text-xs text-slate-500">{new Intl.DateTimeFormat("en-GH", { dateStyle: "medium" }).format(new Date(session.lastActivityAt))}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
          {selected ? (
            <>
              {(selected.providerKey === "fallback-deterministic" || selected.providerKey === "unavailable") && (
                <p className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
                  The configured provider is unavailable; deterministic responses are active.
                </p>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-b bg-slate-50 px-5 py-2 text-xs text-slate-600">
                <span>Provider: {selected.providerKey}</span>
                <span>Model: {selected.modelKey}</span>
                <span>Usage: {selected.inputTokens} input / {selected.outputTokens} output tokens</span>
                {selected.estimatedCostNano !== null && <span>Estimated cost: {selected.estimatedCostNano} nano-units</span>}
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
                {selected.messages.length ? selected.messages.map((item) => (
                  <article className={`max-w-3xl rounded-2xl p-4 ${item.role === "USER" ? "ml-auto bg-slate-950 text-white" : "border bg-white"}`} key={item.id}>
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-xs font-semibold ${item.role === "USER" ? "text-slate-300" : "text-emerald-700"}`}>{item.role === "USER" ? "YOU" : "PROPERTYOS AI"}</p>
                      {item.role !== "USER" && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                          {typeof item.structuredContent === "object" && item.structuredContent !== null && !Array.isArray(item.structuredContent) && item.structuredContent.kind === "PROPOSED_ACTION"
                            ? "PROPOSED ACTION · NOT EXECUTED"
                            : item.structuredContent !== null ? "INFORMATION" : "RECOMMENDATION"}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{item.content}</p>
                    {item.structuredContent !== null && <JsonDetails value={item.structuredContent} />}
                  </article>
                )) : <p className="text-center text-sm text-slate-500">Ask for a portfolio overview, daily brief, attention signals, rent, leases, or maintenance.</p>}

              </div>
              <form className="flex gap-2 border-t p-4" onSubmit={sendMessage}>
                <label className="sr-only" htmlFor="ai-message">Message PropertyOS AI</label>
                <textarea className="min-h-11 flex-1 resize-y rounded-xl border px-3 py-2 text-sm" id="ai-message" maxLength={4000} onChange={(event) => setMessage(event.target.value)} placeholder="Ask about your portfolio operations…" rows={2} value={message} />
                <button className="self-end rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={!message.trim() || busy === "message"} type="submit">Send</button>
              </form>
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div><p className="text-slate-600">No conversations yet.</p><button className="mt-3 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white" onClick={() => void createSession()} type="button">Start a conversation</button></div>
            </div>
          )}
        </div>
      </section>}
    </div>
  );
}
