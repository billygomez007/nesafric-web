"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type PropertyOption = {
  id: string;
  name: string;
  referenceNumber: string;
};

type UnitOption = {
  id: string;
  name: string;
  status: string;
};

type LeaseOption = {
  id: string;
  referenceNumber: string;
  status: string;
  property: {
    id?: string;
    name: string;
  };
  unit: {
    id?: string;
    name: string;
  } | null;
  parties: Array<{
    tenantOrganisation: {
      tenant: {
        legalName: string;
        preferredName: string | null;
      };
    };
  }>;
};

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

type CreateFormState = {
  leaseId: string;
  propertyId: string;
  unitId: string;
  type: string;
  name: string;
  description: string;
  calculationType: "FIXED" | "VARIABLE";
  amountMajor: string;
  currencyCode: string;
  frequency: string;
  billingMode: "SEPARATE" | "INCLUDED_IN_RENT";
  startDate: string;
  endDate: string;
  dueDay: string;
  notifyTenant: boolean;
  reminderDaysBefore: string;
};

type EditFormState = {
  name: string;
  description: string;
  amountMajor: string;
  endDate: string;
  dueDay: string;
  notifyTenant: boolean;
  reminderDaysBefore: string;
  status: "ACTIVE" | "PAUSED" | "ENDED";
};

type DialogState =
  | {
      type: "archive";
      definition: RecurringChargeDefinition;
    }
  | {
      type: "finalise";
      obligation: ChargeObligation;
    }
  | {
      type: "waive";
      obligation: ChargeObligation;
    }
  | null;

const INPUT =
  "mt-2 h-11 w-full rounded-xl border border-hairline bg-white px-3.5 text-sm text-ink outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/10 disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted";

const TEXTAREA =
  "mt-2 min-h-24 w-full resize-y rounded-xl border border-hairline bg-white px-3.5 py-3 text-sm text-ink outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/10";

const initialForm: CreateFormState = {
  leaseId: "",
  propertyId: "",
  unitId: "",
  type: "SERVICE_CHARGE",
  name: "",
  description: "",
  calculationType: "FIXED",
  amountMajor: "",
  currencyCode: "GHS",
  frequency: "MONTHLY",
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

function organisationId() {
  return window.localStorage.getItem("propertyos.activeOrganisationId");
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function currency(amountMinor: string | null, currencyCode: string) {
  if (amountMinor === null) return "Variable";

  const amount = Number(amountMinor) / 100;

  if (!Number.isFinite(amount)) return amountMinor;

  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: currencyCode,
  }).format(amount);
}

function majorToMinor(value: string) {
  return String(Math.round(Number(value) * 100));
}

function minorToMajor(value: string | null) {
  if (!value) return "";
  return String(Number(value) / 100);
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-4"
      role="dialog"
    >
      <div className="w-full max-w-lg rounded-2xl border border-hairline bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <h2 className="font-semibold text-ink">{title}</h2>
          <button
            className="rounded-lg border border-hairline px-3 py-1.5 text-sm text-muted hover:bg-surface"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function RecurringChargeWorkspace() {
  const [definitions, setDefinitions] = useState<RecurringChargeDefinition[]>([]);
  const [obligations, setObligations] = useState<ChargeObligation[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [leases, setLeases] = useState<LeaseOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [form, setForm] = useState<CreateFormState>(initialForm);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogAmount, setDialogAmount] = useState("");
  const [waiverReason, setWaiverReason] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedDefinition = useMemo(
    () => definitions.find((item) => item.id === selectedDefinitionId) ?? null,
    [definitions, selectedDefinitionId],
  );

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const activeOrganisationId = organisationId();

    if (!activeOrganisationId) {
      throw new Error("Choose an organisation before managing recurring charges.");
    }

    const response = await fetch(url, {
      ...init,
      headers: {
        "x-organisation-id": activeOrganisationId,
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        payload.error &&
        typeof payload.error === "object" &&
        "message" in payload.error
          ? String(payload.error.message)
          : payload &&
              typeof payload === "object" &&
              "message" in payload
            ? String(payload.message)
            : `Request failed (${response.status}).`;

      throw new Error(message);
    }

    return payload;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const activeOrganisationId = organisationId();

      if (!activeOrganisationId) {
        throw new Error("Choose an organisation before managing recurring charges.");
      }

      const headers = { "x-organisation-id": activeOrganisationId };

      const [definitionResponse, obligationResponse, leaseResponse, dashboardResponse] =
        await Promise.all([
          fetch("/api/recurring-charges", { headers }),
          fetch("/api/charge-obligations", { headers }),
          fetch("/api/leases", { headers }),
          fetch("/api/dashboard", { headers }),
        ]);

      for (const response of [
        definitionResponse,
        obligationResponse,
        leaseResponse,
        dashboardResponse,
      ]) {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            payload?.error?.message ?? `Unable to load recurring-charge workspace (${response.status}).`,
          );
        }
      }

      const [definitionData, obligationData, leaseData, dashboardData] =
        await Promise.all([
          definitionResponse.json(),
          obligationResponse.json(),
          leaseResponse.json(),
          dashboardResponse.json(),
        ]);

      setDefinitions(Array.isArray(definitionData) ? definitionData : []);
      setObligations(Array.isArray(obligationData) ? obligationData : []);
      setLeases(Array.isArray(leaseData) ? leaseData : []);
      setProperties(
        Array.isArray(dashboardData?.properties) ? dashboardData.properties : [],
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load recurring-charge workspace.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!form.propertyId) {
      const timer = window.setTimeout(() => setUnits([]), 0);
      return () => window.clearTimeout(timer);
    }

    const activeOrganisationId = organisationId();

    if (!activeOrganisationId) return;

    const loadingTimer = window.setTimeout(() => {
      setLoadingUnits(true);
    }, 0);

    fetch(`/api/properties?id=${encodeURIComponent(form.propertyId)}`, {
      headers: { "x-organisation-id": activeOrganisationId },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            (await response.json()).error?.message ?? "Unable to load units.",
          );
        }

        const property = await response.json();

        setUnits([
          ...(property.units ?? []),
          ...(property.buildings ?? []).flatMap(
            (building: { units?: UnitOption[] }) => building.units ?? [],
          ),
        ]);
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "Unable to load units."),
      )
      .finally(() => setLoadingUnits(false));

    return () => window.clearTimeout(loadingTimer);
  }, [form.propertyId]);

  function selectLease(leaseId: string) {
    const lease = leases.find((item) => item.id === leaseId);

    if (!lease) {
      setForm({
        ...form,
        leaseId: "",
        propertyId: "",
        unitId: "",
      });
      return;
    }

    const matchingProperty = properties.find(
      (property) => property.name === lease.property.name,
    );

    setForm({
      ...form,
      leaseId,
      propertyId: lease.property.id ?? matchingProperty?.id ?? "",
      unitId: lease.unit?.id ?? "",
    });
  }

  async function createDefinition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!form.leaseId || !form.propertyId) {
      setError("Choose a lease and property before creating a recurring charge.");
      return;
    }

    if (
      form.calculationType === "FIXED" &&
      (!form.amountMajor || Number(form.amountMajor) < 0)
    ) {
      setError("Enter a valid fixed charge amount.");
      return;
    }

    setBusy(true);

    try {
      await request("/api/recurring-charges", {
        method: "POST",
        body: JSON.stringify({
          leaseId: form.leaseId,
          propertyId: form.propertyId,
          unitId: form.unitId || null,
          type: form.type,
          name: form.name,
          description: form.description || null,
          calculationType: form.calculationType,
          amountMinor:
            form.calculationType === "FIXED"
              ? majorToMinor(form.amountMajor)
              : null,
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
        }),
      });

      setSuccess("Recurring charge created.");
      setForm(initialForm);
      setUnits([]);
      setShowCreate(false);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to create recurring charge.",
      );
    } finally {
      setBusy(false);
    }
  }

  function openEdit(definition: RecurringChargeDefinition) {
    setSelectedDefinitionId(definition.id);
    setEditForm({
      name: definition.name,
      description: definition.description ?? "",
      amountMajor: minorToMajor(definition.amountMinor),
      endDate: definition.endDate?.slice(0, 10) ?? "",
      dueDay: definition.dueDay ? String(definition.dueDay) : "",
      notifyTenant: definition.notifyTenant,
      reminderDaysBefore:
        definition.reminderDaysBefore === null
          ? ""
          : String(definition.reminderDaysBefore),
      status: definition.status,
    });
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDefinition || !editForm) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await request(`/api/recurring-charges/${selectedDefinition.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editForm.name,
          description: editForm.description || null,
          ...(selectedDefinition.calculationType === "FIXED"
            ? { amountMinor: majorToMinor(editForm.amountMajor) }
            : {}),
          endDate: editForm.endDate || null,
          dueDay: editForm.dueDay ? Number(editForm.dueDay) : null,
          notifyTenant: editForm.notifyTenant,
          reminderDaysBefore: editForm.reminderDaysBefore
            ? Number(editForm.reminderDaysBefore)
            : null,
          status: editForm.status,
        }),
      });

      setSuccess("Recurring charge updated.");
      setEditForm(null);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to update recurring charge.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function generateObligations(definitionId: string) {
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await request(`/api/recurring-charges/${definitionId}/generate`, {
        method: "POST",
        body: JSON.stringify({
          throughDate: new Date().toISOString(),
        }),
      });

      setSuccess(
        "Obligation generation completed. Existing periods were not duplicated.",
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to generate obligations.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmArchive() {
    if (!dialog || dialog.type !== "archive") return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await request(`/api/recurring-charges/${dialog.definition.id}`, {
        method: "DELETE",
      });

      setSuccess("Recurring charge archived.");
      setDialog(null);
      setSelectedDefinitionId(null);
      setEditForm(null);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to archive recurring charge.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmFinalise(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!dialog || dialog.type !== "finalise") return;

    const value = Number(dialogAmount);

    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a valid final amount greater than zero.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await request(`/api/charge-obligations/${dialog.obligation.id}/finalise`, {
        method: "POST",
        body: JSON.stringify({
          amountMinor: majorToMinor(dialogAmount),
        }),
      });

      setSuccess("Variable charge finalised.");
      setDialog(null);
      setDialogAmount("");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to finalise charge.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmWaive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!dialog || dialog.type !== "waive") return;

    const value = Number(dialogAmount);

    if (!Number.isFinite(value) || value < 0) {
      setError("Enter a valid waiver amount.");
      return;
    }

    if (waiverReason.trim().length < 2) {
      setError("Enter a waiver reason.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await request(`/api/charge-obligations/${dialog.obligation.id}/waive`, {
        method: "POST",
        body: JSON.stringify({
          amountMinor: majorToMinor(dialogAmount),
          reason: waiverReason.trim(),
        }),
      });

      setSuccess("Charge waiver recorded.");
      setDialog(null);
      setDialogAmount("");
      setWaiverReason("");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to waive charge.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {(error || success) && (
        <div
          className={`rounded-xl border p-4 text-sm ${
            error
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-teal/20 bg-teal/10 text-forest"
          }`}
          role={error ? "alert" : "status"}
        >
          {error || success}
        </div>
      )}

      <section className="flex flex-col gap-4 rounded-2xl border border-hairline bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">
            Recurring charge management
          </h2>
          <p className="mt-1 text-sm text-muted">
            Create lease-linked charges and manage the obligations they generate.
          </p>
        </div>

        <button
          className="rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-light"
          onClick={() => setShowCreate((value) => !value)}
          type="button"
        >
          {showCreate ? "Close form" : "+ Create recurring charge"}
        </button>
      </section>

      {showCreate && (
        <form
          className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-sm"
          onSubmit={createDefinition}
        >
          <div className="border-b border-hairline px-5 py-4 sm:px-6">
            <h2 className="font-semibold text-ink">Charge definition</h2>
            <p className="mt-1 text-sm text-muted">
              Link the charge to an existing lease and configure how obligations are generated.
            </p>
          </div>

          <div className="grid gap-6 p-5 sm:p-6">
            <div className="grid gap-5 md:grid-cols-2">
              <label className="text-sm font-medium text-ink">
                Lease
                <select
                  className={INPUT}
                  onChange={(event) => selectLease(event.target.value)}
                  required
                  value={form.leaseId}
                >
                  <option value="">Select a lease</option>
                  {leases.map((lease) => (
                    <option key={lease.id} value={lease.id}>
                      {lease.referenceNumber} · {lease.property.name}
                      {lease.parties.length
                        ? ` · ${
                            lease.parties[0].tenantOrganisation.tenant
                              .preferredName ||
                            lease.parties[0].tenantOrganisation.tenant.legalName
                          }`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-medium text-ink">
                Property
                <select
                  className={INPUT}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      propertyId: event.target.value,
                      unitId: "",
                    })
                  }
                  required
                  value={form.propertyId}
                >
                  <option value="">Select a property</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name} ({property.referenceNumber})
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-medium text-ink">
                Unit
                <span className="ml-1 font-normal text-muted">(optional)</span>
                <select
                  className={INPUT}
                  disabled={!form.propertyId || loadingUnits}
                  onChange={(event) =>
                    setForm({ ...form, unitId: event.target.value })
                  }
                  value={form.unitId}
                >
                  <option value="">
                    {loadingUnits ? "Loading units..." : "No unit"}
                  </option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name} ({unit.status.toLowerCase()})
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-medium text-ink">
                Charge name
                <input
                  className={INPUT}
                  minLength={2}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  required
                  value={form.name}
                />
              </label>

              <label className="text-sm font-medium text-ink">
                Charge type
                <select
                  className={INPUT}
                  onChange={(event) =>
                    setForm({ ...form, type: event.target.value })
                  }
                  value={form.type}
                >
                  {chargeTypes.map((value) => (
                    <option key={value} value={value}>
                      {titleCase(value)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-medium text-ink">
                Calculation
                <select
                  className={INPUT}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      calculationType: event.target.value as
                        | "FIXED"
                        | "VARIABLE",
                      amountMajor:
                        event.target.value === "VARIABLE"
                          ? ""
                          : form.amountMajor,
                    })
                  }
                  value={form.calculationType}
                >
                  <option value="FIXED">Fixed</option>
                  <option value="VARIABLE">Variable</option>
                </select>
              </label>

              {form.calculationType === "FIXED" && (
                <label className="text-sm font-medium text-ink">
                  Amount
                  <input
                    className={INPUT}
                    min="0"
                    onChange={(event) =>
                      setForm({ ...form, amountMajor: event.target.value })
                    }
                    required
                    step="0.01"
                    type="number"
                    value={form.amountMajor}
                  />
                </label>
              )}

              <label className="text-sm font-medium text-ink">
                Currency
                <input
                  className={INPUT}
                  maxLength={3}
                  minLength={3}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      currencyCode: event.target.value.toUpperCase(),
                    })
                  }
                  required
                  value={form.currencyCode}
                />
              </label>

              <label className="text-sm font-medium text-ink">
                Frequency
                <select
                  className={INPUT}
                  onChange={(event) =>
                    setForm({ ...form, frequency: event.target.value })
                  }
                  value={form.frequency}
                >
                  {frequencies.map((value) => (
                    <option key={value} value={value}>
                      {titleCase(value)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-medium text-ink">
                Billing mode
                <select
                  className={INPUT}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      billingMode: event.target.value as
                        | "SEPARATE"
                        | "INCLUDED_IN_RENT",
                    })
                  }
                  value={form.billingMode}
                >
                  <option value="SEPARATE">Separate</option>
                  <option value="INCLUDED_IN_RENT">Included in rent</option>
                </select>
              </label>

              <label className="text-sm font-medium text-ink">
                Start date
                <input
                  className={INPUT}
                  onChange={(event) =>
                    setForm({ ...form, startDate: event.target.value })
                  }
                  required
                  type="date"
                  value={form.startDate}
                />
              </label>

              <label className="text-sm font-medium text-ink">
                End date
                <span className="ml-1 font-normal text-muted">(optional)</span>
                <input
                  className={INPUT}
                  onChange={(event) =>
                    setForm({ ...form, endDate: event.target.value })
                  }
                  type="date"
                  value={form.endDate}
                />
              </label>

              <label className="text-sm font-medium text-ink">
                Due day
                <input
                  className={INPUT}
                  max={31}
                  min={1}
                  onChange={(event) =>
                    setForm({ ...form, dueDay: event.target.value })
                  }
                  type="number"
                  value={form.dueDay}
                />
              </label>

              <label className="text-sm font-medium text-ink">
                Reminder days before
                <input
                  className={INPUT}
                  max={90}
                  min={0}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      reminderDaysBefore: event.target.value,
                    })
                  }
                  type="number"
                  value={form.reminderDaysBefore}
                />
              </label>
            </div>

            <label className="text-sm font-medium text-ink">
              Description
              <textarea
                className={TEXTAREA}
                maxLength={1000}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                value={form.description}
              />
            </label>

            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input
                checked={form.notifyTenant}
                onChange={(event) =>
                  setForm({ ...form, notifyTenant: event.target.checked })
                }
                type="checkbox"
              />
              Notify tenant
            </label>
          </div>

          <div className="flex justify-end border-t border-hairline px-5 py-4 sm:px-6">
            <button
              className="rounded-xl bg-forest px-5 py-2.5 text-sm font-semibold text-white"
              disabled={busy}
              type="submit"
            >
              {busy ? "Saving..." : "Create recurring charge"}
            </button>
          </div>
        </form>
      )}

      <section className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-sm">
        <div className="border-b border-hairline p-5">
          <h2 className="font-semibold text-ink">Charge definitions</h2>
        </div>

        {loading ? (
          <p className="p-6 text-sm text-muted">Loading recurring charges...</p>
        ) : definitions.length === 0 ? (
          <div className="p-10 text-center">
            <h3 className="font-semibold text-ink">No recurring charges yet</h3>
            <p className="mt-2 text-sm text-muted">
              Create the first lease-linked recurring charge for this organisation.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-hairline bg-surface">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Frequency</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {definitions.map((definition) => (
                  <tr key={definition.id}>
                    <td className="px-4 py-3 font-medium text-ink">
                      {definition.name}
                    </td>
                    <td className="px-4 py-3">{titleCase(definition.type)}</td>
                    <td className="px-4 py-3">
                      {currency(definition.amountMinor, definition.currencyCode)}
                    </td>
                    <td className="px-4 py-3">
                      {titleCase(definition.frequency)}
                    </td>
                    <td className="px-4 py-3">
                      {titleCase(definition.status)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-semibold hover:bg-surface"
                          onClick={() => openEdit(definition)}
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-semibold hover:bg-surface"
                          disabled={busy}
                          onClick={() =>
                            void generateObligations(definition.id)
                          }
                          type="button"
                        >
                          Generate
                        </button>
                        <button
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                          disabled={busy}
                          onClick={() =>
                            setDialog({
                              type: "archive",
                              definition,
                            })
                          }
                          type="button"
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

      {selectedDefinition && editForm && (
        <form
          className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-sm"
          onSubmit={saveEdit}
        >
          <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
            <div>
              <h2 className="font-semibold text-ink">
                Edit {selectedDefinition.name}
              </h2>
              <p className="mt-1 text-sm text-muted">
                Changes apply to the recurring definition. Historical obligation snapshots remain unchanged.
              </p>
            </div>
            <button
              className="rounded-lg border border-hairline px-3 py-1.5 text-sm"
              onClick={() => {
                setEditForm(null);
                setSelectedDefinitionId(null);
              }}
              type="button"
            >
              Close
            </button>
          </div>

          <div className="grid gap-5 p-5 md:grid-cols-2">
            <label className="text-sm font-medium text-ink">
              Name
              <input
                className={INPUT}
                minLength={2}
                onChange={(event) =>
                  setEditForm({
                    ...editForm,
                    name: event.target.value,
                  })
                }
                required
                value={editForm.name}
              />
            </label>

            {selectedDefinition.calculationType === "FIXED" && (
              <label className="text-sm font-medium text-ink">
                Amount
                <input
                  className={INPUT}
                  min="0"
                  onChange={(event) =>
                    setEditForm({
                      ...editForm,
                      amountMajor: event.target.value,
                    })
                  }
                  step="0.01"
                  type="number"
                  value={editForm.amountMajor}
                />
              </label>
            )}

            <label className="text-sm font-medium text-ink">
              End date
              <input
                className={INPUT}
                onChange={(event) =>
                  setEditForm({
                    ...editForm,
                    endDate: event.target.value,
                  })
                }
                type="date"
                value={editForm.endDate}
              />
            </label>

            <label className="text-sm font-medium text-ink">
              Due day
              <input
                className={INPUT}
                max={31}
                min={1}
                onChange={(event) =>
                  setEditForm({
                    ...editForm,
                    dueDay: event.target.value,
                  })
                }
                type="number"
                value={editForm.dueDay}
              />
            </label>

            <label className="text-sm font-medium text-ink">
              Reminder days before
              <input
                className={INPUT}
                max={90}
                min={0}
                onChange={(event) =>
                  setEditForm({
                    ...editForm,
                    reminderDaysBefore: event.target.value,
                  })
                }
                type="number"
                value={editForm.reminderDaysBefore}
              />
            </label>

            <label className="text-sm font-medium text-ink">
              Status
              <select
                className={INPUT}
                onChange={(event) =>
                  setEditForm({
                    ...editForm,
                    status: event.target.value as
                      | "ACTIVE"
                      | "PAUSED"
                      | "ENDED",
                  })
                }
                value={editForm.status}
              >
                <option value="ACTIVE">Active</option>
                <option value="PAUSED">Paused</option>
                <option value="ENDED">Ended</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input
                checked={editForm.notifyTenant}
                onChange={(event) =>
                  setEditForm({
                    ...editForm,
                    notifyTenant: event.target.checked,
                  })
                }
                type="checkbox"
              />
              Notify tenant
            </label>

            <label className="text-sm font-medium text-ink md:col-span-2">
              Description
              <textarea
                className={TEXTAREA}
                onChange={(event) =>
                  setEditForm({
                    ...editForm,
                    description: event.target.value,
                  })
                }
                value={editForm.description}
              />
            </label>
          </div>

          <div className="flex justify-end border-t border-hairline px-5 py-4">
            <button
              className="rounded-xl bg-forest px-5 py-2.5 text-sm font-semibold text-white"
              disabled={busy}
              type="submit"
            >
              {busy ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
      )}

      <section className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-sm">
        <div className="border-b border-hairline p-5">
          <h2 className="font-semibold text-ink">Charge obligations</h2>
        </div>

        {obligations.length === 0 ? (
          <p className="p-6 text-sm text-muted">
            No generated obligations yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[950px] text-left text-sm">
              <thead className="border-b border-hairline bg-surface">
                <tr>
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3">Due</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
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
                      {currency(obligation.amountMinor, obligation.currencyCode)}
                    </td>
                    <td className="px-4 py-3">
                      {titleCase(obligation.status)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {(obligation.amountMinor === null ||
                          obligation.finalisedAt === null) && (
                          <button
                            className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-semibold hover:bg-surface"
                            onClick={() => {
                              setDialogAmount("");
                              setDialog({
                                type: "finalise",
                                obligation,
                              });
                            }}
                            type="button"
                          >
                            Finalise
                          </button>
                        )}

                        <button
                          className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-semibold hover:bg-surface"
                          onClick={() => {
                            setDialogAmount("");
                            setWaiverReason("");
                            setDialog({
                              type: "waive",
                              obligation,
                            });
                          }}
                          type="button"
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

      {dialog?.type === "archive" && (
        <Modal
          onClose={() => setDialog(null)}
          title="Archive recurring charge"
        >
          <div className="p-5">
            <p className="text-sm leading-6 text-muted">
              Archive <strong className="text-ink">{dialog.definition.name}</strong>?
              Existing historical obligations are preserved.
            </p>

            <div className="mt-5 flex justify-end gap-3">
              <button
                className="rounded-xl border border-hairline px-4 py-2 text-sm font-semibold"
                onClick={() => setDialog(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white"
                disabled={busy}
                onClick={() => void confirmArchive()}
                type="button"
              >
                {busy ? "Archiving..." : "Archive charge"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {dialog?.type === "finalise" && (
        <Modal
          onClose={() => setDialog(null)}
          title="Finalise variable charge"
        >
          <form className="p-5" onSubmit={confirmFinalise}>
            <label className="text-sm font-medium text-ink">
              Final amount ({dialog.obligation.currencyCode})
              <input
                autoFocus
                className={INPUT}
                min="0.01"
                onChange={(event) => setDialogAmount(event.target.value)}
                required
                step="0.01"
                type="number"
                value={dialogAmount}
              />
            </label>

            <div className="mt-5 flex justify-end gap-3">
              <button
                className="rounded-xl border border-hairline px-4 py-2 text-sm font-semibold"
                onClick={() => setDialog(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-white"
                disabled={busy}
                type="submit"
              >
                {busy ? "Finalising..." : "Finalise charge"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {dialog?.type === "waive" && (
        <Modal onClose={() => setDialog(null)} title="Waive charge">
          <form className="grid gap-4 p-5" onSubmit={confirmWaive}>
            <label className="text-sm font-medium text-ink">
              Amount to waive ({dialog.obligation.currencyCode})
              <input
                autoFocus
                className={INPUT}
                min="0"
                onChange={(event) => setDialogAmount(event.target.value)}
                required
                step="0.01"
                type="number"
                value={dialogAmount}
              />
            </label>

            <label className="text-sm font-medium text-ink">
              Reason
              <textarea
                className={TEXTAREA}
                maxLength={500}
                minLength={2}
                onChange={(event) => setWaiverReason(event.target.value)}
                required
                value={waiverReason}
              />
            </label>

            <div className="flex justify-end gap-3">
              <button
                className="rounded-xl border border-hairline px-4 py-2 text-sm font-semibold"
                onClick={() => setDialog(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-white"
                disabled={busy}
                type="submit"
              >
                {busy ? "Saving..." : "Confirm waiver"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
