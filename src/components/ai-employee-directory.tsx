"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Employee = {
  id: string;
  name: string;
  role: "RECEPTIONIST" | "PROPERTY_MANAGER";
  description: string | null;
  status: string;
  scope: string;
  properties: Array<{ property: { id: string; name: string } }>;
  portfolios: Array<{ portfolio: { id: string; name: string } }>;
  toolPermissions: Array<{ toolKey: string }>;
};
type Directory = {
  employees: Employee[];
  properties: Array<{ id: string; name: string }>;
  portfolios: Array<{ id: string; name: string }>;
  policies: Array<{ id: string; actionKey: string; level: string }>;
  toolCatalog: {
    read: Array<{ toolKey: string; description: string }>;
    actions: Array<{ actionKey: string; description: string; autoExecuteEligible: boolean }>;
  };
};

const headers = (organisationId: string, json = false) => ({ "x-organisation-id": organisationId, ...(json ? { "content-type": "application/json" } : {}) });
async function responseError(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
  return body.error?.message ?? "Unable to update AI employees.";
}

export function AIEmployeeDirectory() {
  const [organisationId, setOrganisationId] = useState("");
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (orgId: string) => {
    const response = await fetch("/api/ai/employees", { headers: headers(orgId) });
    if (!response.ok) throw new Error(await responseError(response));
    setDirectory(await response.json() as Directory);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const orgId = localStorage.getItem("propertyos.activeOrganisationId") ?? "";
      setOrganisationId(orgId);
      if (!orgId) return setError("Choose an organisation to manage AI employees.");
      void load(orgId).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load AI employees."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/ai/employees", {
        method: "POST",
        headers: headers(organisationId, true),
        body: JSON.stringify({
          name: data.get("name"),
          role: data.get("role"),
          description: data.get("description") || undefined,
          status: "ACTIVE",
          scope: data.get("scope"),
          portfolioIds: data.getAll("portfolioIds"),
          propertyIds: data.getAll("propertyIds"),
          responsibilities: String(data.get("responsibilities") || "").split("\n").map((item) => item.trim()).filter(Boolean),
          instructions: { greeting: data.get("greeting"), tone: data.get("tone"), officeHours: data.get("officeHours") },
          escalationConfiguration: { contact: data.get("escalationContact"), routeUncertainRequests: true },
          timezone: data.get("timezone") || "UTC",
          toolPermissions: data.getAll("toolPermissions"),
          autonomyPolicyIds: data.getAll("autonomyPolicyIds"),
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      event.currentTarget.reset();
      await load(organisationId);
      setNotice("AI employee created.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create AI employee.");
    } finally {
      setBusy(false);
    }
  }

  if (!directory) return <p className="rounded-xl border bg-white p-6">{error || "Loading AI employees..."}</p>;
  const tools = [...directory.toolCatalog.read.map((tool) => ({ key: tool.toolKey, label: tool.description })), ...directory.toolCatalog.actions.map((tool) => ({ key: tool.actionKey, label: `${tool.description}${tool.autoExecuteEligible ? " (auto eligible)" : " (approval maximum)"}` }))];
  return <div className="grid gap-6">
    {(error || notice) && <p className={`rounded-lg p-3 text-sm ${error ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{error || notice}</p>}
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">Your AI employees</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">{directory.employees.map((employee) => <Link className={`rounded-xl border-l-4 p-5 hover:shadow-md ${employee.role === "RECEPTIONIST" ? "border-l-violet-500" : "border-l-emerald-600"}`} href={`/ai/employees/${employee.id}`} key={employee.id}><div className="flex justify-between gap-3"><div><h3 className="text-lg font-semibold">{employee.name}</h3><p className="text-sm text-slate-600">AI {employee.role.replaceAll("_", " ")}</p></div><span className="text-xs font-semibold">{employee.status}</span></div><p className="mt-3 text-sm">{employee.description || "No description configured."}</p><p className="mt-3 text-xs text-slate-500">{employee.scope === "ORGANISATION" ? "Entire organisation" : `${employee.portfolios.length} portfolios · ${employee.properties.length} properties`} · {employee.toolPermissions.length} tools</p></Link>)}</div>
    </section>
    <form className="grid gap-5 rounded-2xl border bg-white p-6 shadow-sm" onSubmit={create}>
      <div><h2 className="text-xl font-semibold">Create AI employee</h2><p className="mt-1 text-sm text-slate-600">AI employees are scoped service identities, not authentication accounts.</p></div>
      <div className="grid gap-3 sm:grid-cols-2"><input className="rounded-lg border p-3" name="name" placeholder="Employee name" required /><select className="rounded-lg border p-3" name="role"><option value="RECEPTIONIST">AI Receptionist</option><option value="PROPERTY_MANAGER">AI Property Manager</option></select><textarea className="rounded-lg border p-3 sm:col-span-2" name="description" placeholder="Role description" rows={2} /><select className="rounded-lg border p-3" name="scope"><option value="ORGANISATION">Entire organisation</option><option value="SELECTED">Selected portfolios/properties</option></select><input className="rounded-lg border p-3" defaultValue="UTC" name="timezone" placeholder="IANA timezone" /></div>
      <fieldset><legend className="font-semibold">Assignments</legend><div className="mt-2 grid gap-2 sm:grid-cols-2"><div className="rounded-lg border p-3"><p className="text-sm font-medium">Portfolios</p>{directory.portfolios.map((portfolio) => <label className="mt-2 flex gap-2 text-sm" key={portfolio.id}><input name="portfolioIds" type="checkbox" value={portfolio.id} />{portfolio.name}</label>)}</div><div className="rounded-lg border p-3"><p className="text-sm font-medium">Properties</p>{directory.properties.map((property) => <label className="mt-2 flex gap-2 text-sm" key={property.id}><input name="propertyIds" type="checkbox" value={property.id} />{property.name}</label>)}</div></div></fieldset>
      <fieldset><legend className="font-semibold">Controlled tools and actions</legend><div className="mt-2 grid max-h-72 gap-2 overflow-auto rounded-lg border p-3 sm:grid-cols-2">{tools.map((tool) => <label className="flex items-start gap-2 text-sm" key={tool.key}><input className="mt-1" name="toolPermissions" type="checkbox" value={tool.key} /><span><strong>{tool.key}</strong><br /><span className="text-slate-500">{tool.label}</span></span></label>)}</div></fieldset>
      <fieldset><legend className="font-semibold">Linked autonomy policies</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{directory.policies.map((policy) => <label className="flex gap-2 rounded-lg border p-3 text-sm" key={policy.id}><input name="autonomyPolicyIds" type="checkbox" value={policy.id} />{policy.actionKey} · {policy.level.replaceAll("_", " ")}</label>)}</div></fieldset>
      <div className="grid gap-3 sm:grid-cols-2"><textarea className="rounded-lg border p-3" name="responsibilities" placeholder={"Responsibilities (one per line)"} rows={4} /><div className="grid gap-3"><input className="rounded-lg border p-3" name="greeting" placeholder="Preferred greeting" /><input className="rounded-lg border p-3" name="tone" placeholder="Communication tone" /><input className="rounded-lg border p-3" name="officeHours" placeholder="Office hours" /><input className="rounded-lg border p-3" name="escalationContact" placeholder="Escalation contact" /></div></div>
      <button className="rounded-lg bg-slate-950 p-3 font-semibold text-white" disabled={busy}>Create AI employee</button>
    </form>
  </div>;
}
