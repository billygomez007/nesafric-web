"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type RecurringChargeDefinition = {
  id: string;
  leaseId: string;
  propertyId: string;
  unitId: string | null;
  type: string;
  name: string;
  description: string | null;
  calculationType: "FIXED" | "VARIABLE";
  amountMinor: string | null;
  currencyCode: string;
  frequency:
    | "ONE_TIME"
    | "WEEKLY"
    | "MONTHLY"
    | "QUARTERLY"
    | "SEMI_ANNUALLY"
    | "ANNUALLY"
    | "CUSTOM";
  customFrequency: string | null;
  billingMode: "SEPARATE" | "INCLUDED_IN_RENT";
  startDate: string;
  endDate: string | null;
  dueDay: number | null;
  notifyTenant: boolean;
  reminderDaysBefore: number | null;
  status: "ACTIVE" | "PAUSED" | "ENDED";
  archivedAt?: string | null;
  property?: { id: string; name?: string | null } | null;
  unit?: { id: string; name?: string | null; label?: string | null } | null;
  lease?: { id: string; reference?: string | null } | null;
};

type ChargeObligation = {
  id: string;
  recurringChargeDefinitionId: string | null;
  leaseId: string;
  propertyId: string;
  tenantOrganisationId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  amountMinor: string | null;
  currencyCode: string;
  status: string;
  finalisedAt: string | null;
  waivedAmountMinor?: string | null;
};

type FormState = {
  leaseId: string;
  propertyId: string;
  unitId: string;
  type: string;
  name: string;
  description: string;
  calculationType: "FIXED" | "VARIABLE";
  amountMinor: string;
  currencyCode: string;
  frequency: string;
  customFrequency: string;
  billingMode: "SEPARATE" | "INCLUDED_IN_RENT";
  startDate: string;
  endDate: string;
  dueDay: string;
  notifyTenant: boolean;
  reminderDaysBefore: string;
};

const initialForm: FormState = {
  leaseId: "",
  propertyId: "",
  unitId: "",
  type: "SERVICE_CHARGE",
  name: "",
  description: "",
  calculationType: "FIXED",
  amountMinor: "",
  currencyCode: "GHS",
  frequency: "MONTHLY",
  customFrequency: "",
  billingMode: "SEPARATE",
  startDate: new Date().toISOString().slice(0, 10),
  endDate: "",
  dueDay: "1",
  notifyTenant: true,
  reminderDaysBefore: "3",
};

const chargeTypes = [
  "SERVICE_CHARGE",
  "WASTE_COLLECTION",
  "ELECTRICITY",
  "WATER",
  "GAS",
  "SECURITY",
  "CLEANING",
  "PARKING",
  "INTERNET",
  "GENERATOR_FUEL",
  "MAINTENANCE_LEVY",
  "COMMON_AREA",
  "ASSOCIATION_FEE",
  "OTHER",
];

const frequencies = [
  "ONE_TIME",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "SEMI_ANNUALLY",
  "ANNUALLY",
];

function activeOrganisationId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("propertyos.activeOrganisationId");
}

function money(amountMinor: string | null, currencyCode: string) {
  if (amountMinor === null) return "Variable";
  const amount = Number(amountMinor) / 100;
  if (!Number.isFinite(amount)) return amountMinor;
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: currencyCode,
  }).format(amount);
}

function formatLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function RecurringChargeWorkspace() {
  const [definitions, setDefinitions] = useState<RecurringChargeDefinition[]>([]);
  const [obligations, setObligations] = useState<ChargeObligation[]>([]);
  const [form, setForm] = useState<FormState>(initialForm);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const selectedDefinition = useMemo(
    () => definitions.find((item) => item.id === selectedDefinitionId) ?? null,
    [definitions, selectedDefinitionId],
  );

  const headers = useCallback(() => {
    const organisationId = activeOrganisationId();
    if (!organisationId) {
      throw new Error("Choose an organisation before managing recurring charges.");
    }
    return {
      "content-type": "application/json",
      "x-organisation-id": organisationId,
    };
  }, []);

  const request = useCallback(
    async (url: string, init?: RequestInit) => {
      const response = await fetch(url, {
        ...init,
        headers: {
          ...headers(),
          ...(init?.headers ?? {}),
        },
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          body && typeof body === "object" && "message" in body
            ? String(body.message)
            : `Request failed (${response.status}).`;
        throw new Error(message);
      }

      return body;
    },
    [headers],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [definitionData, obligationData] = await Promise.all([
        request("/api/recurring-charges"),
        request("/api/charge-obligations"),
      ]);

      setDefinitions(Array.isArray(definitionData) ? definitionData : []);
      setObligations(Array.isArray(obligationData) ? obligationData : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load recurring charges.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [load]);

  async function createDefinition(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        leaseId: form.leaseId,
        propertyId: form.propertyId,
        unitId: form.unitId || null,
        type: form.type,
        name: form.name,
        description: form.description || null,
        calculationType: form.calculationType,
        amountMinor:
          form.calculationType === "FIXED" ? form.amountMinor : null,
        currencyCode: form.currencyCode.toUpperCase(),
        frequency: form.frequency,
        customFrequency: null,
        billingMode: form.billingMode,
        startDate: form.startDate,
        endDate: form.endDate || null,
        dueDay: form.dueDay ? Number(form.dueDay) : null,
        notifyTenant: form.notifyTenant,
        reminderDaysBefore: form.reminderDaysBefore
          ? Number(form.reminderDaysBefore)
          : null,
      };

      await request("/api/recurring-charges", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setSuccess("Recurring charge created.");
      setForm(initialForm);
      setShowCreate(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create recurring charge.");
    } finally {
      setBusy(false);
    }
  }

  async function archiveDefinition(id: string) {
    if (!window.confirm("Archive this recurring charge definition?")) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await request(`/api/recurring-charges/${id}`, { method: "DELETE" });
      setSuccess("Recurring charge archived.");
      if (selectedDefinitionId === id) setSelectedDefinitionId(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to archive recurring charge.");
    } finally {
      setBusy(false);
    }
  }

  async function generateObligations(id: string) {
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await request(`/api/recurring-charges/${id}/generate`, {
        method: "POST",
        body: JSON.stringify({ throughDate: new Date().toISOString() }),
      });
      setSuccess("Obligation generation completed. Existing periods were not duplicated.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to generate obligations.");
    } finally {
      setBusy(false);
    }
  }

  async function finaliseObligation(id: string) {
    const amountMajor = window.prompt("Enter the final amount in major currency units.");
    if (!amountMajor) return;

    const value = Number(amountMajor);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a valid amount greater than zero.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await request(`/api/charge-obligations/${id}/finalise`, {
        method: "POST",
        body: JSON.stringify({ amountMinor: String(Math.round(value * 100)) }),
      });
      setSuccess("Variable charge finalised.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to finalise charge.");
    } finally {
      setBusy(false);
    }
  }

  async function waiveObligation(id: string) {
    const amountMajor = window.prompt("Enter the amount to waive in major currency units.");
    if (!amountMajor) return;

    const reason = window.prompt("Enter the waiver reason.");
    if (!reason || reason.trim().length < 2) return;

    const value = Number(amountMajor);
    if (!Number.isFinite(value) || value < 0) {
      setError("Enter a valid waiver amount.");
      return;
    }

    if (!window.confirm("Confirm this waiver?")) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await request(`/api/charge-obligations/${id}/waive`, {
        method: "POST",
        body: JSON.stringify({
          amountMinor: String(Math.round(value * 100)),
          reason: reason.trim(),
        }),
      });
      setSuccess("Charge waiver recorded.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to waive charge.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Recurring charges</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage service charges and other repeating obligations linked to leases.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreate((value) => !value)}
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white"
        >
          {showCreate ? "Close form" : "Create recurring charge"}
        </button>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {success ? (
        <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">
          {success}
        </div>
      ) : null}

      {showCreate ? (
        <form onSubmit={createDefinition} className="grid gap-4 rounded-2xl border bg-white p-5 shadow-sm md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span>Name</span>
            <input
              required
              minLength={2}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className="w-full rounded-lg border px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span>Charge type</span>
            <select
              value={form.type}
              onChange={(event) => setForm({ ...form, type: event.target.value })}
              className="w-full rounded-lg border px-3 py-2"
            >
              {chargeTypes.map((value) => (
                <option key={value} value={value}>
                  {formatLabel(value)}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span>Lease ID</span>
            <input
              required
              value={form.leaseId}
              onChange={(event) => setForm({ ...form, leaseId: event.target.value })}
              className="w-full rounded-lg border px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span>Property ID</span>
            <input
              required
              value={form.propertyId}
              onChange={(event) => setForm({ ...form, propertyId: event.target.value })}
              className="w-full rounded-lg border px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span>Unit ID (optional)</span>
            <input
              value={form.unitId}
              onChange={(event) => setForm({ ...form, unitId: event.target.value })}
              className="w-full rounded-lg border px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span>Calculation</span>
            <select
              value={form.calculationType}
              onChange={(event) =>
                setForm({
                  ...form,
                  calculationType: event.target.value as "FIXED" | "VARIABLE",
                  amountMinor: event.target.value === "VARIABLE" ? "" : form.amountMinor,
                })
              }
              className="w-full rounded-lg border px-3 py-2"
            >
              <option value="FIXED">Fixed</option>
              <option value="VARIABLE">Variable</option>
            </select>
          </label>

          {form.calculationType === "FIXED" ? (
            <label className="space-y-1 text-sm">
              <span>Amount in minor units</span>
              <input
                required
                inputMode="numeric"
                pattern="\d+"
                value={form.amountMinor}
                onChange={(event) => setForm({ ...form, amountMinor: event.target.value })}
                className="w-full rounded-lg border px-3 py-2"
              />
            </label>
          ) : null}

          <label className="space-y-1 text-sm">
            <span>Currency</span>
            <input
              required
              minLength={3}
              maxLength={3}
              value={form.currencyCode}
              onChange={(event) => setForm({ ...form, currencyCode: event.target.value })}
              className="w-full rounded-lg border px-3 py-2 uppercase"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span>Frequency</span>
            <select
              value={form.frequency}
              onChange={(event) => setForm({ ...form, frequency: event.target.value })}
              className="w-full rounded-lg border px-3 py-2"
            >
              {frequencies.map((value) => (
                <option key={value} value={value}>
                  {formatLabel(value)}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span>Billing mode</span>
            <select
              value={form.billingMode}
              onChange={(event) =>
                setForm({
                  ...form,
                  billingMode: event.target.value as "SEPARATE" | "INCLUDED_IN_RENT",
                })
              }
              className="w-full rounded-lg border px-3 py-2"
            >
              <option value="SEPARATE">Separate</option>
              <option value="INCLUDED_IN_RENT">Included in rent</option>
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span>Start date</span>
            <input
              required
              type="date"
              value={form.startDate}
              onChange={(event) => setForm({ ...form, startDate: event.target.value })}
              className="w-full rounded-lg border px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span>End date (optional)</span>
            <input
              type="date"
              value={form.endDate}
              onChange={(event) => setForm({ ...form, endDate: event.target.value })}
              className="w-full rounded-lg border px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span>Due day</span>
            <input
              type="number"
              min={1}
              max={31}
              value={form.dueDay}
              onChange={(event) => setForm({ ...form, dueDay: event.target.value })}
              className="w-full rounded-lg border px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span>Reminder days before</span>
            <input
              type="number"
              min={0}
              max={90}
              value={form.reminderDaysBefore}
              onChange={(event) =>
                setForm({ ...form, reminderDaysBefore: event.target.value })
              }
              className="w-full rounded-lg border px-3 py-2"
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.notifyTenant}
              onChange={(event) =>
                setForm({ ...form, notifyTenant: event.target.checked })
              }
            />
            Notify tenant
          </label>

          <label className="space-y-1 text-sm md:col-span-2">
            <span>Description</span>
            <textarea
              maxLength={1000}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              className="min-h-24 w-full rounded-lg border px-3 py-2"
            />
          </label>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Saving..." : "Create recurring charge"}
            </button>
          </div>
        </form>
      ) : null}

      <section className="rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-5">
          <h2 className="font-semibold">Charge definitions</h2>
        </div>

        {loading ? (
          <p className="p-5 text-sm text-muted-foreground">Loading recurring charges...</p>
        ) : definitions.length === 0 ? (
          <div className="p-8 text-center">
            <h3 className="font-medium">No recurring charges yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first recurring service charge or lease obligation.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Frequency</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Start</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {definitions.map((definition) => (
                  <tr key={definition.id}>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className="font-medium hover:underline"
                        onClick={() => setSelectedDefinitionId(definition.id)}
                      >
                        {definition.name}
                      </button>
                    </td>
                    <td className="px-4 py-3">{formatLabel(definition.type)}</td>
                    <td className="px-4 py-3">
                      {money(definition.amountMinor, definition.currencyCode)}
                    </td>
                    <td className="px-4 py-3">{formatLabel(definition.frequency)}</td>
                    <td className="px-4 py-3">{formatLabel(definition.status)}</td>
                    <td className="px-4 py-3">
                      {new Date(definition.startDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void generateObligations(definition.id)}
                          className="rounded-md border px-2.5 py-1.5 text-xs"
                        >
                          Generate
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void archiveDefinition(definition.id)}
                          className="rounded-md border px-2.5 py-1.5 text-xs"
                        >
                          Archive
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedDefinition ? (
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">{selectedDefinition.name}</h2>
              <p className="text-sm text-muted-foreground">
                {formatLabel(selectedDefinition.type)} ·{" "}
                {formatLabel(selectedDefinition.frequency)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedDefinitionId(null)}
              className="rounded-md border px-3 py-1.5 text-xs"
            >
              Close
            </button>
          </div>

          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="font-medium">
                {money(selectedDefinition.amountMinor, selectedDefinition.currencyCode)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Billing</dt>
              <dd className="font-medium">{formatLabel(selectedDefinition.billingMode)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Due day</dt>
              <dd className="font-medium">{selectedDefinition.dueDay ?? "Period start"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Tenant reminders</dt>
              <dd className="font-medium">
                {selectedDefinition.notifyTenant ? "Enabled" : "Disabled"}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-5">
          <h2 className="font-semibold">Charge obligations</h2>
        </div>

        {obligations.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">No generated obligations yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[950px] text-left text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3">Due</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {obligations.map((obligation) => (
                  <tr key={obligation.id}>
                    <td className="px-4 py-3">
                      {new Date(obligation.periodStart).toLocaleDateString()} –{" "}
                      {new Date(obligation.periodEnd).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {new Date(obligation.dueDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {money(obligation.amountMinor, obligation.currencyCode)}
                    </td>
                    <td className="px-4 py-3">{formatLabel(obligation.status)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {obligation.amountMinor === null || obligation.finalisedAt === null ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void finaliseObligation(obligation.id)}
                            className="rounded-md border px-2.5 py-1.5 text-xs"
                          >
                            Finalise
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void waiveObligation(obligation.id)}
                          className="rounded-md border px-2.5 py-1.5 text-xs"
                        >
                          Waive
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
