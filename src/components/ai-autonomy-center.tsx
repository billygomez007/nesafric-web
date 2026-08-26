"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Configuration = {
  enabled: boolean;
  automationPaused: boolean;
  defaultLevel: string;
  communicationAllowed: boolean;
} | null;
type Policy = { id: string; actionKey: string; level: string; enabled: boolean; scopeKey: string };
type Action = {
  actionKey: string;
  description: string;
  requiredPermission: string;
  autoExecuteEligible: boolean;
  prohibitedAutonomous: boolean;
};
type Activity = {
  id: string;
  type: string;
  status: string;
  severity: string;
  conditionKey: string;
  actionKey: string | null;
  policyDecision: string;
  reason: string;
  failureMessage: string | null;
  createdAt: string;
};
type State = {
  configuration: Configuration;
  policies: Policy[];
  activities: Activity[];
  actionCatalog: Action[];
  platform: { automationPaused: boolean; autoExecuteAllowlist: string[] };
};

const levels = ["DISABLED", "RECOMMEND_ONLY", "APPROVAL_REQUIRED", "AUTO_EXECUTE"];
const headers = (organisationId: string, json = false) => ({
  "x-organisation-id": organisationId,
  ...(json ? { "content-type": "application/json" } : {}),
});

async function responseError(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
  return body.error?.message ?? "The AI automation request failed.";
}

export function AIAutonomyCenter() {
  const [organisationId, setOrganisationId] = useState("");
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (orgId: string) => {
    const response = await fetch("/api/ai/autonomy", { headers: headers(orgId) });
    if (!response.ok) throw new Error(await responseError(response));
    setState(await response.json() as State);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const orgId = localStorage.getItem("propertyos.activeOrganisationId") ?? "";
      setOrganisationId(orgId);
      if (!orgId) {
        setError("Choose an organisation to manage AI automation.");
        return;
      }
      void load(orgId).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load AI automation."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function submit(path: string, body: unknown, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(path, {
        method: path.endsWith("/policies") ? "POST" : "PATCH",
        headers: headers(organisationId, true),
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await responseError(response));
      await load(organisationId);
      setNotice(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update AI automation.");
    } finally {
      setBusy(false);
    }
  }

  async function saveConfiguration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await submit("/api/ai/autonomy", {
      enabled: data.get("enabled") === "on",
      communicationAllowed: data.get("communicationAllowed") === "on",
      defaultLevel: data.get("defaultLevel"),
    }, "AI autonomy settings updated.");
  }

  async function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const optionalNumber = (key: string) => data.get(key) ? Number(data.get(key)) : undefined;
    await submit("/api/ai/autonomy/policies", {
      actionKey: data.get("actionKey"),
      enabled: true,
      level: data.get("level"),
      timezone: String(data.get("timezone") || "UTC"),
      executionWindowStartMinute: optionalNumber("executionWindowStartMinute"),
      executionWindowEndMinute: optionalNumber("executionWindowEndMinute"),
      maxExecutions: optionalNumber("maxExecutions"),
      frequencyWindowMinutes: optionalNumber("frequencyWindowMinutes"),
      escalationAfterMinutes: optionalNumber("escalationAfterMinutes"),
      minSeverity: data.get("minSeverity") || undefined,
    }, "Action policy saved.");
  }

  if (!state) return <p className="rounded-xl border bg-white p-6 text-slate-600">{error || "Loading AI automation..."}</p>;
  const configuration = state.configuration;

  return <div className="grid gap-6">
    {(error || notice) && <p className={`rounded-lg p-3 text-sm ${error ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{error || notice}</p>}
    {state.platform.automationPaused && <p className="rounded-xl border border-red-300 bg-red-50 p-4 font-semibold text-red-900">Platform AI automation is paused. Monitoring and read-only AI remain available.</p>}
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-xl font-semibold">Organisation controls</h2><p className="mt-1 text-sm text-slate-600">Platform safety rules always override these settings.</p></div>
        {configuration && <button className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${configuration.automationPaused ? "bg-emerald-700" : "bg-red-700"}`} disabled={busy} onClick={() => void submit("/api/ai/autonomy/pause", { paused: !configuration.automationPaused, reason: configuration.automationPaused ? "Authorised reactivation from AI settings." : "Emergency pause from AI settings." }, configuration.automationPaused ? "AI automation reactivated." : "AI automation paused.")}>{configuration.automationPaused ? "Reactivate automation" : "Pause AI automation"}</button>}
      </div>
      <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={saveConfiguration}>
        <label className="flex items-center gap-2"><input defaultChecked={configuration?.enabled ?? true} name="enabled" type="checkbox" />AI enabled</label>
        <label className="flex items-center gap-2"><input defaultChecked={configuration?.communicationAllowed ?? true} name="communicationAllowed" type="checkbox" />Allow configured communications</label>
        <label className="grid gap-1 text-sm">Default autonomy level<select className="rounded-lg border p-2" defaultValue={configuration?.defaultLevel ?? "RECOMMEND_ONLY"} name="defaultLevel">{levels.map((level) => <option key={level}>{level}</option>)}</select></label>
        <button className="self-end rounded-lg bg-slate-950 p-2 font-semibold text-white" disabled={busy}>Save organisation settings</button>
      </form>
    </section>
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">Action-specific policy</h2>
      <p className="mt-1 text-sm text-slate-600">Only explicitly allowlisted low-risk actions can be automatically executed.</p>
      <form className="mt-5 grid gap-3 sm:grid-cols-3" onSubmit={savePolicy}>
        <select className="rounded-lg border p-2 sm:col-span-2" name="actionKey" required>{state.actionCatalog.map((action) => <option key={action.actionKey} value={action.actionKey}>{action.description}{action.autoExecuteEligible ? " · auto eligible" : " · approval maximum"}</option>)}</select>
        <select className="rounded-lg border p-2" name="level">{levels.map((level) => <option key={level}>{level}</option>)}</select>
        <input className="rounded-lg border p-2" defaultValue="UTC" name="timezone" placeholder="Timezone" />
        <input className="rounded-lg border p-2" min={0} max={1439} name="executionWindowStartMinute" placeholder="Window start minute" type="number" />
        <input className="rounded-lg border p-2" min={0} max={1439} name="executionWindowEndMinute" placeholder="Window end minute" type="number" />
        <input className="rounded-lg border p-2" min={1} name="maxExecutions" placeholder="Max executions" type="number" />
        <input className="rounded-lg border p-2" min={1} name="frequencyWindowMinutes" placeholder="Frequency window minutes" type="number" />
        <input className="rounded-lg border p-2" min={1} name="escalationAfterMinutes" placeholder="Escalate after minutes" type="number" />
        <select className="rounded-lg border p-2" defaultValue="" name="minSeverity"><option value="">Any severity</option>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((severity) => <option key={severity}>{severity}</option>)}</select>
        <button className="rounded-lg bg-slate-950 p-2 font-semibold text-white" disabled={busy}>Save policy</button>
      </form>
      <div className="mt-5 grid gap-2">{state.policies.map((policy) => <div className="flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-sm" key={policy.id}><span className="font-semibold">{policy.actionKey}</span><span>{policy.level.replaceAll("_", " ")} · {policy.scopeKey}</span></div>)}</div>
    </section>
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">AI activity center</h2>
      <p className="mt-1 text-sm text-slate-600">Suggestions, approvals, autonomous results, policy blocks, failures, and escalations are preserved here.</p>
      <div className="mt-5 grid gap-3">{state.activities.length === 0 && <p className="text-sm text-slate-500">No proactive activity recorded.</p>}{state.activities.map((activity) => <article className="rounded-xl border p-4" key={activity.id}><div className="flex flex-wrap justify-between gap-2"><div><strong>{activity.type.replaceAll("_", " ")}</strong><span className="ml-2 text-sm text-slate-500">{activity.actionKey ?? activity.conditionKey}</span></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{activity.status} · {activity.severity}</span></div><p className="mt-2 text-sm">{activity.reason}</p><p className="mt-2 text-xs text-slate-500">Policy: {activity.policyDecision} · {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(activity.createdAt))}</p>{activity.failureMessage && <p className="mt-2 text-sm text-red-700">{activity.failureMessage}</p>}</article>)}</div>
    </section>
  </div>;
}
