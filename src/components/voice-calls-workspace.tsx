"use client";

import { type FormEvent, useEffect, useState } from "react";

type Config = {
  phoneNumber: string | null; inboundEnabled: boolean; outboundEnabled: boolean; timezone: string;
  businessHoursStart: string; businessHoursEnd: string; maxRetryAttempts: number; retryDelaySeconds: number;
  maxOutboundCallsPerDay: number; recordingEnabled: boolean; consentRequired: boolean; status: string;
  sttProviderKey: string; ttsProviderKey: string; countryCode: string | null;
  openingDisclosureText: string | null; recordingDisclosureText: string | null; disclosureRequired: boolean;
  mediaStreamWsUrl: string | null; maxCallDurationSeconds: number; maxConsecutiveOutboundFailures: number;
  maxConcurrentCallsPerEmployee: number; maxConcurrentOutboundCalls: number; exhaustedMinutesBehavior: string;
};
type Analytics = {
  inboundCalls: number; outboundCalls: number; answeredCalls: number; failedCalls: number;
  averageDurationSeconds: number | null; humanHandoffs: number; enquiriesConvertedToLeads: number;
  viewingsCreated: number; maintenanceRequestsCreated: number; artisanContacts: number; providerAcceptanceRate: number | null;
};
type CallSummary = {
  id: string; direction: string; status: string; outcome: string; fromNumber: string; toNumber: string;
  createdAt: string; durationSeconds: number | null; transferStatus: string;
  conversation: { listingId: string | null; tenantOrganisationId: string | null; marketplaceLeadId: string | null; maintenanceRequestId: string | null; workOrderId: string | null };
};
type CallDetail = CallSummary & {
  transcriptText: string | null; aiSummary: string | null; recordingConsentStatus: string;
  aiEmployee: { id: string; name: string; role: string } | null;
  handoff: { id: string; status: string; reason: string; urgency: string } | null;
  events: Array<{ id: string; type: string; occurredAt: string }>;
  turns: Array<{ id: string; speaker: string; text: string; interrupted: boolean; sequence: number }>;
  streamingSession: { status: string; state: string; disconnectReason: string | null } | null;
  transferTargetNumber: string | null;
  sttSecondsUsed: number | null; ttsCharactersUsed: number | null;
};
type ContactPreference = { id: string; phoneNumber: string; doNotCall: boolean; reason: string | null };
type PhoneNumberRow = {
  id: string; e164Number: string; providerKey: string; purpose: string; label: string | null;
  inboundEnabled: boolean; outboundEnabled: boolean; status: string;
  assignedAIEmployee: { id: string; name: string; role: string } | null;
};
type Health = { status: string; telephonyReal: boolean; sttReal: boolean; ttsReal: boolean; bridgeConfigured: boolean; recentFailures?: number };
type OperationalSnapshot = {
  windowMinutes: number; activeCalls: number; activeMediaStreams: number; sttFailures: number; ttsFailures: number;
  handoffs: number; droppedCalls: number; averageDurationSeconds: number | null;
};

const STATUS_STYLES: Record<string, string> = {
  QUEUED: "bg-slate-100 text-slate-700", RINGING: "bg-amber-50 text-amber-800", IN_PROGRESS: "bg-blue-50 text-blue-800",
  COMPLETED: "bg-emerald-50 text-emerald-800", FAILED: "bg-red-50 text-red-800", NO_ANSWER: "bg-slate-100 text-slate-600",
  BUSY: "bg-slate-100 text-slate-600", CANCELED: "bg-slate-100 text-slate-500",
};

const HEALTH_STYLES: Record<string, string> = {
  MOCK_TEST: "bg-slate-100 text-slate-700", CONFIGURED: "bg-blue-50 text-blue-800", PARTIALLY_CONFIGURED: "bg-amber-50 text-amber-800",
  READY: "bg-emerald-50 text-emerald-800", DEGRADED: "bg-amber-100 text-amber-900", UNAVAILABLE: "bg-red-50 text-red-800",
};
const HEALTH_LABELS: Record<string, string> = {
  MOCK_TEST: "Mock / Test", CONFIGURED: "Configured", PARTIALLY_CONFIGURED: "Partially Configured",
  READY: "Ready", DEGRADED: "Degraded", UNAVAILABLE: "Unavailable",
};

/** The Voice/Calls workspace (item 17) — shared between PropertyOS (`/ai/voice`) and the
 * Marketplace Pro workspace, since both simply pass the relevant organisation id (a Marketplace
 * professional's is its hidden backing organisation) to the same org-scoped voice API. */
export function VoiceCallsWorkspace({ organisationId }: { organisationId: string }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [calls, setCalls] = useState<CallSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedCall, setSelectedCall] = useState<CallDetail | null>(null);
  const [preferences, setPreferences] = useState<ContactPreference[] | null>(null);
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumberRow[] | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [snapshot, setSnapshot] = useState<OperationalSnapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pageSize = 20;

  useEffect(() => {
    fetch(`/api/organisations/${organisationId}/voice/config`).then(async (r) => { if (r.ok) setConfig(await r.json()); });
    fetch(`/api/organisations/${organisationId}/voice/analytics`).then(async (r) => { if (r.ok) setAnalytics(await r.json()); });
    fetch(`/api/organisations/${organisationId}/voice/contact-preferences`).then(async (r) => { if (r.ok) setPreferences(await r.json()); });
    fetch(`/api/organisations/${organisationId}/voice/phone-numbers`).then(async (r) => { if (r.ok) setPhoneNumbers(await r.json()); });
    fetch(`/api/organisations/${organisationId}/voice/health`).then(async (r) => { if (r.ok) setHealth(await r.json()); });
    fetch(`/api/organisations/${organisationId}/voice/operational-snapshot`).then(async (r) => { if (r.ok) setSnapshot(await r.json()); });
  }, [organisationId]);

  useEffect(() => {
    fetch(`/api/organisations/${organisationId}/voice/calls?page=${page}&pageSize=${pageSize}`).then(async (r) => {
      const body = await r.json();
      if (r.ok) { setCalls(body.items); setTotal(body.total); } else setError(body.error?.message ?? "Unable to load calls.");
    });
  }, [organisationId, page]);

  async function openCall(callId: string) {
    setSelectedCall(null);
    const r = await fetch(`/api/organisations/${organisationId}/voice/calls/${callId}`);
    if (r.ok) setSelectedCall(await r.json());
  }

  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const body = {
      phoneNumber: form.get("phoneNumber") || undefined,
      inboundEnabled: form.get("inboundEnabled") === "on",
      outboundEnabled: form.get("outboundEnabled") === "on",
      timezone: form.get("timezone") || undefined,
      businessHoursStart: form.get("businessHoursStart") || undefined,
      businessHoursEnd: form.get("businessHoursEnd") || undefined,
      maxRetryAttempts: Number(form.get("maxRetryAttempts")),
      retryDelaySeconds: Number(form.get("retryDelaySeconds")),
      maxOutboundCallsPerDay: Number(form.get("maxOutboundCallsPerDay")),
      recordingEnabled: form.get("recordingEnabled") === "on",
      consentRequired: form.get("consentRequired") === "on",
      sttProviderKey: form.get("sttProviderKey") || undefined,
      ttsProviderKey: form.get("ttsProviderKey") || undefined,
      countryCode: form.get("countryCode") || undefined,
      openingDisclosureText: form.get("openingDisclosureText") || undefined,
      recordingDisclosureText: form.get("recordingDisclosureText") || undefined,
      disclosureRequired: form.get("disclosureRequired") === "on",
      mediaStreamWsUrl: form.get("mediaStreamWsUrl") || undefined,
      maxCallDurationSeconds: Number(form.get("maxCallDurationSeconds")),
      maxConcurrentCallsPerEmployee: Number(form.get("maxConcurrentCallsPerEmployee")),
      maxConcurrentOutboundCalls: Number(form.get("maxConcurrentOutboundCalls")),
      exhaustedMinutesBehavior: form.get("exhaustedMinutesBehavior") || undefined,
    };
    const response = await fetch(`/api/organisations/${organisationId}/voice/config`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const updated = await response.json();
    if (!response.ok) return setError(updated.error?.message ?? "Unable to save voice settings.");
    setConfig(updated); setNotice("Voice settings saved.");
  }

  async function addPhoneNumber(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/organisations/${organisationId}/voice/phone-numbers`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ e164Number: form.get("e164Number"), purpose: form.get("purpose"), label: form.get("label") || undefined }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to add phone number.");
    setNotice("Phone number added."); (event.target as HTMLFormElement).reset();
    setPhoneNumbers((current) => (current ? [body, ...current] : [body]));
  }

  async function addPreference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/organisations/${organisationId}/voice/contact-preferences`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: form.get("phoneNumber"), doNotCall: true, reason: form.get("reason") || undefined }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to add contact preference.");
    setNotice("Number added to the do-not-call list."); (event.target as HTMLFormElement).reset();
    setPreferences((current) => (current ? [body, ...current] : [body]));
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="grid gap-6">
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      {health && (
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-slate-600">Voice runtime health</span>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${HEALTH_STYLES[health.status] ?? "bg-slate-100 text-slate-700"}`}>{HEALTH_LABELS[health.status] ?? health.status}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <span className={`rounded-full px-2 py-0.5 ${health.telephonyReal ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>Telephony {health.telephonyReal ? "live" : "mock"}</span>
              <span className={`rounded-full px-2 py-0.5 ${health.sttReal ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>STT {health.sttReal ? "live" : "mock"}</span>
              <span className={`rounded-full px-2 py-0.5 ${health.ttsReal ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>TTS {health.ttsReal ? "live" : "mock"}</span>
              <span className={`rounded-full px-2 py-0.5 ${health.bridgeConfigured ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>Media bridge {health.bridgeConfigured ? "configured" : "not configured"}</span>
            </div>
          </div>
          {snapshot && (
            <div className="mt-4 grid grid-cols-3 gap-3 text-center sm:grid-cols-6">
              <div><p className="text-lg font-semibold">{snapshot.activeCalls}</p><p className="text-xs text-slate-500">Active calls</p></div>
              <div><p className="text-lg font-semibold">{snapshot.activeMediaStreams}</p><p className="text-xs text-slate-500">Active streams</p></div>
              <div><p className="text-lg font-semibold">{snapshot.sttFailures}</p><p className="text-xs text-slate-500">STT failures (1h)</p></div>
              <div><p className="text-lg font-semibold">{snapshot.ttsFailures}</p><p className="text-xs text-slate-500">TTS failures (1h)</p></div>
              <div><p className="text-lg font-semibold">{snapshot.handoffs}</p><p className="text-xs text-slate-500">Handoffs (1h)</p></div>
              <div><p className="text-lg font-semibold">{snapshot.droppedCalls}</p><p className="text-xs text-slate-500">Dropped (1h)</p></div>
            </div>
          )}
        </section>
      )}

      {analytics && (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Inbound calls</p><p className="mt-2 text-3xl font-semibold">{analytics.inboundCalls}</p></div>
          <div className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Outbound calls</p><p className="mt-2 text-3xl font-semibold">{analytics.outboundCalls}</p></div>
          <div className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Human handoffs</p><p className="mt-2 text-3xl font-semibold">{analytics.humanHandoffs}</p></div>
          <div className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Avg. duration</p><p className="mt-2 text-3xl font-semibold">{analytics.averageDurationSeconds ? `${analytics.averageDurationSeconds}s` : "—"}</p></div>
          <div className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Leads from calls</p><p className="mt-2 text-2xl font-semibold">{analytics.enquiriesConvertedToLeads}</p></div>
          <div className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Viewings from calls</p><p className="mt-2 text-2xl font-semibold">{analytics.viewingsCreated}</p></div>
          <div className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Maintenance from calls</p><p className="mt-2 text-2xl font-semibold">{analytics.maintenanceRequestsCreated}</p></div>
          <div className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Provider acceptance</p><p className="mt-2 text-2xl font-semibold">{analytics.providerAcceptanceRate !== null ? `${Math.round(analytics.providerAcceptanceRate * 100)}%` : "—"}</p></div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section className="rounded-xl border bg-white shadow-sm">
          <h2 className="border-b p-5 font-semibold">Call history</h2>
          {!calls ? <p className="p-5 text-sm text-slate-500">Loading…</p> : calls.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">No calls yet. Once voice is configured, inbound and outbound calls will appear here.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {calls.map((call) => (
                <li key={call.id}>
                  <button className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-50" onClick={() => void openCall(call.id)} type="button">
                    <div>
                      <p className="font-medium">{call.direction === "INBOUND" ? call.fromNumber : call.toNumber}</p>
                      <p className="text-xs text-slate-500">{call.direction.toLowerCase()} · {new Date(call.createdAt).toLocaleString()} {call.durationSeconds ? `· ${call.durationSeconds}s` : ""}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[call.status] ?? "bg-slate-100 text-slate-700"}`}>{call.status.replaceAll("_", " ")}</span>
                      <span className="text-xs text-slate-500">{call.outcome.replaceAll("_", " ")}</span>
                      {call.transferStatus !== "NONE" && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-700">Transfer {call.transferStatus.toLowerCase()}</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {total > pageSize && (
            <div className="flex items-center justify-between border-t px-5 py-3 text-sm">
              <button className="font-medium text-slate-600 disabled:cursor-not-allowed disabled:text-slate-500" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} type="button">← Previous</button>
              <span className="text-slate-500">Page {page} of {totalPages}</span>
              <button className="font-medium text-slate-600 disabled:cursor-not-allowed disabled:text-slate-500" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} type="button">Next →</button>
            </div>
          )}
        </section>

        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Call detail</h2>
          {!selectedCall ? <p className="mt-3 text-sm text-slate-500">Select a call to see its transcript, summary, and outcome.</p> : (
            <div className="mt-3 grid gap-4">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-slate-500">AI employee</dt><dd className="font-medium">{selectedCall.aiEmployee?.name ?? "—"}</dd></div>
                <div><dt className="text-slate-500">Outcome</dt><dd className="font-medium">{selectedCall.outcome.replaceAll("_", " ")}</dd></div>
                <div><dt className="text-slate-500">Status</dt><dd className="font-medium">{selectedCall.status.replaceAll("_", " ")}</dd></div>
                <div><dt className="text-slate-500">Recording</dt><dd className="font-medium">{selectedCall.recordingConsentStatus.replaceAll("_", " ")}</dd></div>
              </dl>
              {selectedCall.handoff && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                  <p className="font-semibold text-amber-900">Handed off to a human</p>
                  <p className="mt-1 text-amber-800">{selectedCall.handoff.reason} ({selectedCall.handoff.urgency.toLowerCase()}, {selectedCall.handoff.status.toLowerCase()})</p>
                </div>
              )}
              {selectedCall.transferStatus !== "NONE" && (
                <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
                  Live transfer {selectedCall.transferStatus.toLowerCase()}{selectedCall.transferTargetNumber ? ` to ${selectedCall.transferTargetNumber}` : ""}.
                </div>
              )}
              {selectedCall.streamingSession && (
                <div className="rounded-lg border bg-slate-50 p-3 text-xs text-slate-600">
                  Realtime session: {selectedCall.streamingSession.status.toLowerCase()} · {selectedCall.streamingSession.state.toLowerCase()}
                  {selectedCall.streamingSession.disconnectReason ? ` (${selectedCall.streamingSession.disconnectReason})` : ""}
                </div>
              )}
              {selectedCall.aiSummary && <div><h3 className="text-xs font-semibold uppercase text-slate-500">Summary</h3><p className="mt-1 text-sm text-slate-700">{selectedCall.aiSummary}</p></div>}
              <div>
                <h3 className="text-xs font-semibold uppercase text-slate-500">Related</h3>
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                  {selectedCall.conversation.listingId && <span className="rounded-full bg-slate-100 px-2 py-0.5">Listing</span>}
                  {selectedCall.conversation.tenantOrganisationId && <span className="rounded-full bg-slate-100 px-2 py-0.5">Tenant</span>}
                  {selectedCall.conversation.marketplaceLeadId && <span className="rounded-full bg-slate-100 px-2 py-0.5">Lead</span>}
                  {selectedCall.conversation.workOrderId && <span className="rounded-full bg-slate-100 px-2 py-0.5">Work order</span>}
                  {!selectedCall.conversation.listingId && !selectedCall.conversation.tenantOrganisationId && !selectedCall.conversation.marketplaceLeadId && !selectedCall.conversation.workOrderId && <span className="text-slate-500">None</span>}
                </div>
              </div>
              {selectedCall.turns.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase text-slate-500">Turns</h3>
                  <div className="mt-1 grid max-h-56 gap-1 overflow-y-auto rounded-lg bg-slate-50 p-3 text-xs">
                    {selectedCall.turns.map((turn) => (
                      <p key={turn.id}><span className="font-semibold">{turn.speaker}:</span> {turn.text}{turn.interrupted ? " (interrupted)" : ""}</p>
                    ))}
                  </div>
                </div>
              )}
              {selectedCall.transcriptText && (
                <div>
                  <h3 className="text-xs font-semibold uppercase text-slate-500">Transcript</h3>
                  <pre className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{selectedCall.transcriptText}</pre>
                </div>
              )}
              <div className="text-xs text-slate-500">
                {selectedCall.sttSecondsUsed ? `STT: ${selectedCall.sttSecondsUsed.toFixed(1)}s` : ""}
                {selectedCall.ttsCharactersUsed ? ` · TTS: ${selectedCall.ttsCharactersUsed} chars` : ""}
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="font-semibold">Voice settings</h2>
        {!config ? <p className="mt-3 text-sm text-slate-500">Loading…</p> : (
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={saveConfig}>
            <label className="text-sm">Phone number<input className="mt-1 w-full rounded border p-2 text-sm" defaultValue={config.phoneNumber ?? ""} name="phoneNumber" placeholder="+233…" /></label>
            <label className="text-sm">Timezone<input className="mt-1 w-full rounded border p-2 text-sm" defaultValue={config.timezone} name="timezone" /></label>
            <label className="text-sm">Business hours start<input className="mt-1 w-full rounded border p-2 text-sm" defaultValue={config.businessHoursStart} name="businessHoursStart" placeholder="08:00" /></label>
            <label className="text-sm">Business hours end<input className="mt-1 w-full rounded border p-2 text-sm" defaultValue={config.businessHoursEnd} name="businessHoursEnd" placeholder="18:00" /></label>
            <label className="text-sm">Max retry attempts<input className="mt-1 w-full rounded border p-2 text-sm" defaultValue={config.maxRetryAttempts} min={0} name="maxRetryAttempts" type="number" /></label>
            <label className="text-sm">Retry delay (seconds)<input className="mt-1 w-full rounded border p-2 text-sm" defaultValue={config.retryDelaySeconds} min={30} name="retryDelaySeconds" type="number" /></label>
            <label className="text-sm">Max outbound calls / day<input className="mt-1 w-full rounded border p-2 text-sm" defaultValue={config.maxOutboundCallsPerDay} min={0} name="maxOutboundCallsPerDay" type="number" /></label>
            <label className="text-sm">Media bridge WS URL<input className="mt-1 w-full rounded border p-2 text-sm" defaultValue={config.mediaStreamWsUrl ?? ""} name="mediaStreamWsUrl" placeholder="wss://voice-bridge.example.com" /></label>
            <label className="text-sm">Max call duration (seconds)<input className="mt-1 w-full rounded border p-2 text-sm" defaultValue={config.maxCallDurationSeconds} min={30} name="maxCallDurationSeconds" type="number" /></label>
            <label className="text-sm">Max concurrent calls / AI employee<input className="mt-1 w-full rounded border p-2 text-sm" defaultValue={config.maxConcurrentCallsPerEmployee} min={1} name="maxConcurrentCallsPerEmployee" type="number" /></label>
            <label className="text-sm">Max concurrent outbound calls<input className="mt-1 w-full rounded border p-2 text-sm" defaultValue={config.maxConcurrentOutboundCalls} min={1} name="maxConcurrentOutboundCalls" type="number" /></label>
            <label className="text-sm">When voice minutes are exhausted<select className="mt-1 w-full rounded border p-2 text-sm" defaultValue={config.exhaustedMinutesBehavior} name="exhaustedMinutesBehavior"><option value="HANDOFF">Route to human</option><option value="AI_ANYWAY">Let AI keep answering (grace)</option></select></label>
            <label className="text-sm">STT provider<input className="mt-1 w-full rounded border p-2 text-sm" defaultValue={config.sttProviderKey} name="sttProviderKey" /></label>
            <label className="text-sm">TTS provider<input className="mt-1 w-full rounded border p-2 text-sm" defaultValue={config.ttsProviderKey} name="ttsProviderKey" /></label>
            <label className="text-sm">Country code<input className="mt-1 w-full rounded border p-2 text-sm" defaultValue={config.countryCode ?? ""} maxLength={2} name="countryCode" placeholder="GH" /></label>
            <label className="text-sm sm:col-span-2">Opening disclosure<textarea className="mt-1 w-full rounded border p-2 text-sm" defaultValue={config.openingDisclosureText ?? ""} name="openingDisclosureText" placeholder="This call is being handled by UmoAfric's AI receptionist." rows={2} /></label>
            <label className="text-sm sm:col-span-2">Recording disclosure<textarea className="mt-1 w-full rounded border p-2 text-sm" defaultValue={config.recordingDisclosureText ?? ""} name="recordingDisclosureText" placeholder="This call may be recorded for quality and training purposes." rows={2} /></label>
            <div className="grid content-center gap-2 text-sm">
              <label className="flex items-center gap-2"><input defaultChecked={config.inboundEnabled} name="inboundEnabled" type="checkbox" /> Inbound voice enabled</label>
              <label className="flex items-center gap-2"><input defaultChecked={config.outboundEnabled} name="outboundEnabled" type="checkbox" /> Outbound voice enabled</label>
              <label className="flex items-center gap-2"><input defaultChecked={config.recordingEnabled} name="recordingEnabled" type="checkbox" /> Recording enabled</label>
              <label className="flex items-center gap-2"><input defaultChecked={config.consentRequired} name="consentRequired" type="checkbox" /> Consent required before recording</label>
              <label className="flex items-center gap-2"><input defaultChecked={config.disclosureRequired} name="disclosureRequired" type="checkbox" /> Announce opening disclosure</label>
            </div>
            <button className="justify-self-start rounded bg-slate-950 px-4 py-2 text-sm font-semibold text-white sm:col-span-2" type="submit">Save voice settings</button>
          </form>
        )}
        <p className="mt-3 text-xs text-slate-500">Provider: {config?.status ?? "—"}. Deterministic test transport is used until production telephony credentials are configured.</p>
      </section>

      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="font-semibold">Phone numbers</h2>
        <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={addPhoneNumber}>
          <input className="rounded border p-2 text-sm" name="e164Number" placeholder="+233…" required />
          <select className="rounded border p-2 text-sm" name="purpose">
            <option value="GENERAL_OFFICE">General office</option>
            <option value="TENANT_SUPPORT">Tenant support</option>
            <option value="SALES">Sales</option>
            <option value="DEVELOPMENT">Development</option>
          </select>
          <input className="rounded border p-2 text-sm" name="label" placeholder="Label (optional)" />
          <button className="rounded bg-slate-950 px-4 py-2 text-sm font-semibold text-white" type="submit">Add</button>
        </form>
        {phoneNumbers && phoneNumbers.length > 0 && (
          <ul className="mt-3 grid gap-1.5 text-sm">
            {phoneNumbers.map((number) => (
              <li className="flex items-center justify-between rounded border px-3 py-1.5" key={number.id}>
                <span>{number.e164Number} <span className="text-xs text-slate-500">· {number.purpose.toLowerCase().replaceAll("_", " ")}{number.label ? ` · ${number.label}` : ""}</span></span>
                <span className="text-xs text-slate-500">{number.assignedAIEmployee?.name ?? "Unassigned"} · {number.status.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="font-semibold">Do-not-call list</h2>
        <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={addPreference}>
          <input className="rounded border p-2 text-sm" name="phoneNumber" placeholder="+233…" required />
          <input className="rounded border p-2 text-sm" name="reason" placeholder="Reason (optional)" />
          <button className="rounded bg-slate-950 px-4 py-2 text-sm font-semibold text-white" type="submit">Add</button>
        </form>
        {preferences && preferences.length > 0 && (
          <ul className="mt-3 grid gap-1.5 text-sm">
            {preferences.map((preference) => (
              <li className="flex items-center justify-between rounded border px-3 py-1.5" key={preference.id}>
                <span>{preference.phoneNumber}</span>
                <span className="text-xs text-slate-500">{preference.reason ?? "No reason given"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
