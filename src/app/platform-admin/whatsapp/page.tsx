"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PlatformAdminShell, usePlatformPermission } from "@/components/platform-admin/shell";
import { PLATFORM_PERMISSIONS } from "@/platform/platform-admin/permissions";

type SupportRequest = {
  id: string;
  reference: string;
  topic: string;
  summary: string;
  workflow: string | null;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  createdAt: string;
  resolutionNote: string | null;
  contact: { name: string | null; phone: string; hasAccount: boolean; canReplyFreely: boolean };
};

type Overview = {
  configuration: { enabled: boolean; sendingConfigured: boolean; webhookSecretConfigured: boolean; verifyTokenConfigured: boolean; statusTemplateConfigured: boolean };
  metrics: {
    contacts: { total: number; activeInPeriod: number };
    workflows: { started: number; completed: number; cancelled: number; inProgressNow: number; inProgressByWorkflow: Record<string, number> };
    propertySearches: { total: number; zeroResults: number; errors: number };
    serviceSearches: { total: number; zeroResults: number };
    customerRequests: { inquiries: number; viewings: number; serviceQuotes: number };
    registrations: { businesses: number; serviceProviders: number };
    listings: { draftsCreated: number; submitted: number; published: number; byStatus: Record<string, number>; averageReviewHours: number | null };
    failures: { mediaUploads: number; outboundMessages: number; processing: number; publicationNotVisible: number; rateLimited: number };
    unclearMessages: number;
    optOuts: number;
  };
  support: SupportRequest[];
  failedMessages: Array<{ id: string; type: string; status: string; error: string | null; attempts: number; receivedAt: string; phone: string }>;
  submissions: {
    listings: Array<{ id: string; reference: string; title: string; status: string; verificationStatus: string; professional: string | null; updatedAt: string }>;
    professionals: Array<{ id: string; reference: string; displayName: string; type: string; verificationStatus: string; createdAt: string }>;
    serviceProviders: Array<{ id: string; reference: string; displayName: string; type: string; verificationStatus: string; listed: boolean; createdAt: string }>;
  };
};

const label = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());

function Tile({ title, value, hint }: { title: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-white p-4 shadow-card">
      <p className="text-xs uppercase tracking-wider text-muted">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-forest">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function SupportRow({ request, canManage, onChanged }: { request: SupportRequest; canManage: boolean; onChanged: () => void }) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function update(body: Record<string, string>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/platform-admin/whatsapp/support/${request.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "The request could not be updated.");
      if (result.delivery?.skipped) setMessage(`Reply not sent: ${result.delivery.reason}`);
      else if (body.reply) setMessage("Reply queued for WhatsApp.");
      setReply("");
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The request could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="grid gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-forest">{request.reference} · {label(request.topic)}</p>
        <p className="text-xs text-muted">{label(request.status)} · {new Date(request.createdAt).toLocaleString()}</p>
      </div>
      <p className="whitespace-pre-wrap text-sm text-ink">{request.summary}</p>
      <p className="text-xs text-muted">
        {request.contact.name ?? "Unnamed contact"} · {request.contact.phone}
        {request.contact.hasAccount ? " · has NesAfric account" : ""}
        {request.workflow ? ` · was in: ${label(request.workflow)}` : ""}
      </p>
      {canManage && request.status !== "RESOLVED" ? (
        <div className="grid gap-2">
          <textarea
            className="min-h-20 rounded-lg border border-hairline px-3 py-2 text-sm"
            maxLength={1500}
            onChange={(event) => setReply(event.target.value)}
            placeholder={request.contact.canReplyFreely ? "Reply on WhatsApp…" : "Outside the 24-hour window: replies use the approved status template, if configured."}
            value={reply}
          />
          <div className="flex flex-wrap gap-2">
            <button className="rounded-lg bg-forest px-4 py-2 text-sm font-semibold text-white disabled:pointer-events-none disabled:border-hairline disabled:bg-surface disabled:text-slate-500" disabled={busy || !reply.trim()} onClick={() => update({ reply, status: "IN_PROGRESS" })} type="button">Send reply</button>
            <button className="rounded-lg border border-hairline px-4 py-2 text-sm font-semibold text-forest disabled:pointer-events-none disabled:border-hairline disabled:bg-surface disabled:text-slate-500" disabled={busy} onClick={() => update({ status: "RESOLVED", ...(reply.trim() ? { reply } : {}) })} type="button">Mark resolved</button>
          </div>
        </div>
      ) : null}
      {message ? <p className="text-xs text-muted" role="status">{message}</p> : null}
    </li>
  );
}

function WhatsAppAssistantContent() {
  const canManage = usePlatformPermission(PLATFORM_PERMISSIONS.whatsAppSupportManage);
  const [data, setData] = useState<Overview | null>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/platform-admin/whatsapp?days=${days}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? "Unable to load the WhatsApp assistant overview.");
        setData(body as Overview);
        setError("");
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Unable to load the WhatsApp assistant overview.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [days, reloadKey]);

  const metrics = data?.metrics;
  const config = data?.configuration;
  const configProblems = config ? [
    !config.enabled && "The assistant is disabled (WHATSAPP_ASSISTANT_ENABLED).",
    !config.webhookSecretConfigured && "WHATSAPP_APP_SECRET is missing — every webhook is rejected.",
    !config.sendingConfigured && "Sending is not configured (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID).",
    !config.statusTemplateConfigured && "No approved status template: notifications outside the 24-hour window are skipped.",
  ].filter(Boolean) as string[] : [];

  return (
    <div className="grid gap-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Conversational marketplace</p>
          <h2 className="mt-2 text-2xl font-semibold text-forest">WhatsApp Assistant</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Activity, review pipeline and support requests from NesAfric&apos;s WhatsApp number. Every figure is counted from recorded events.
            Listings, businesses and providers submitted on WhatsApp are reviewed in the existing queues.
          </p>
        </div>
        <select aria-label="Period" className="rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm" onChange={(event) => { setLoading(true); setDays(Number(event.target.value)); }} value={days}>
          {[7, 30, 90].map((value) => <option key={value} value={value}>Last {value} days</option>)}
        </select>
      </section>

      {error ? <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p> : null}
      {configProblems.length ? (
        <ul className="grid gap-1 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {configProblems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      ) : null}

      {loading && !data ? <p className="text-sm text-muted">Loading…</p> : null}

      {metrics ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile title="Active contacts" value={metrics.contacts.activeInPeriod} hint={`${metrics.contacts.total} all time`} />
            <Tile title="Workflows started" value={metrics.workflows.started} hint={`${metrics.workflows.completed} completed · ${metrics.workflows.cancelled} cancelled · ${metrics.workflows.inProgressNow} open now`} />
            <Tile title="Property searches" value={metrics.propertySearches.total} hint={`${metrics.propertySearches.zeroResults} with no results · ${metrics.propertySearches.errors} errors`} />
            <Tile title="Service searches" value={metrics.serviceSearches.total} hint={`${metrics.serviceSearches.zeroResults} with no results`} />
            <Tile title="Inquiries / viewings / quotes" value={`${metrics.customerRequests.inquiries} / ${metrics.customerRequests.viewings} / ${metrics.customerRequests.serviceQuotes}`} />
            <Tile title="Registrations" value={metrics.registrations.businesses + metrics.registrations.serviceProviders} hint={`${metrics.registrations.businesses} real estate · ${metrics.registrations.serviceProviders} service providers`} />
            <Tile title="Listings submitted" value={metrics.listings.submitted} hint={`${metrics.listings.byStatus.PENDING_REVIEW ?? 0} awaiting review · ${metrics.listings.published} published${metrics.listings.averageReviewHours !== null ? ` · avg review ${metrics.listings.averageReviewHours}h` : ""}`} />
            <Tile title="Failures" value={metrics.failures.mediaUploads + metrics.failures.outboundMessages + metrics.failures.processing} hint={`${metrics.failures.mediaUploads} media · ${metrics.failures.outboundMessages} outbound · ${metrics.failures.processing} processing`} />
          </section>

          <section className="overflow-hidden rounded-xl border border-hairline bg-white shadow-card">
            <h3 className="border-b border-hairline px-5 py-4 font-semibold text-forest">Support requests ({data!.support.length})</h3>
            {data!.support.length ? (
              <ul className="divide-y divide-hairline">
                {data!.support.map((request) => <SupportRow canManage={canManage} key={request.id} onChanged={reload} request={request} />)}
              </ul>
            ) : <p className="p-5 text-sm text-muted">No open support requests.</p>}
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            {([
              ["Listings from WhatsApp", data!.submissions.listings.map((item) => ({ key: item.id, title: item.title, meta: `${item.reference} · ${label(item.status)} · ${item.professional ?? ""}` })), "/platform-admin/verification"],
              ["Businesses from WhatsApp", data!.submissions.professionals.map((item) => ({ key: item.id, title: item.displayName, meta: `${item.reference} · ${label(item.type)} · ${label(item.verificationStatus)}` })), "/platform-admin/professionals"],
              ["Service providers from WhatsApp", data!.submissions.serviceProviders.map((item) => ({ key: item.id, title: item.displayName, meta: `${item.reference} · ${label(item.verificationStatus)}${item.listed ? " · public" : " · not public"}` })), "/platform-admin/service-providers"],
            ] as const).map(([title, rows, href]) => (
              <div className="overflow-hidden rounded-xl border border-hairline bg-white shadow-card" key={title}>
                <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
                  <h3 className="font-semibold text-forest">{title}</h3>
                  <Link className="text-xs font-semibold text-forest underline" href={href}>Review queue</Link>
                </div>
                {rows.length ? (
                  <ul className="divide-y divide-hairline">
                    {rows.map((row) => (
                      <li className="px-5 py-3" key={row.key}>
                        <p className="text-sm font-medium text-ink">{row.title}</p>
                        <p className="text-xs text-muted">{row.meta}</p>
                      </li>
                    ))}
                  </ul>
                ) : <p className="p-5 text-sm text-muted">None yet.</p>}
              </div>
            ))}
          </section>

          <section className="overflow-hidden rounded-xl border border-hairline bg-white shadow-card">
            <h3 className="border-b border-hairline px-5 py-4 font-semibold text-forest">Messages needing attention</h3>
            {data!.failedMessages.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-hairline bg-warm-white text-xs uppercase tracking-wider text-muted">
                    <tr><th className="px-5 py-3">Received</th><th className="px-5 py-3">Contact</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Error</th></tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {data!.failedMessages.map((failure) => (
                      <tr key={failure.id}>
                        <td className="px-5 py-3 text-xs text-muted">{new Date(failure.receivedAt).toLocaleString()}</td>
                        <td className="px-5 py-3 text-xs text-muted">{failure.phone}</td>
                        <td className="px-5 py-3 text-xs">{failure.type}</td>
                        <td className="px-5 py-3 text-xs font-semibold text-forest">{label(failure.status)} ({failure.attempts} attempts)</td>
                        <td className="px-5 py-3 text-xs text-muted">{failure.error ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="p-5 text-sm text-muted">No failed or rate-limited messages in this period.</p>}
          </section>
        </>
      ) : null}
    </div>
  );
}

export default function PlatformAdminWhatsAppPage() {
  return (
    <PlatformAdminShell>
      <WhatsAppAssistantContent />
    </PlatformAdminShell>
  );
}
