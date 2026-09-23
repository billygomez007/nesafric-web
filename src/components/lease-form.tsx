"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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

type TenantOption = {
  id: string;
  tenant: {
    legalName: string;
    preferredName: string | null;
  };
  email: string | null;
};

const INPUT =
  "mt-2 h-11 w-full rounded-xl border border-hairline bg-white px-3.5 text-sm text-ink outline-none transition placeholder:text-muted focus:border-teal focus:ring-2 focus:ring-teal/10 disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted";

export function LeaseForm({
  initialPropertyId = "",
  initialUnitId = "",
  initialTenantId = "",
}: {
  initialPropertyId?: string;
  initialUnitId?: string;
  initialTenantId?: string;
}) {
  const router = useRouter();

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [propertyId, setPropertyId] = useState(initialPropertyId);
  const [unitId, setUnitId] = useState(initialUnitId);
  const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>(
    initialTenantId ? [initialTenantId] : [],
  );
  const [loadingUnits, setLoadingUnits] = useState(false);

  useEffect(() => {
    const organisationId = localStorage.getItem(
      "propertyos.activeOrganisationId",
    );

    if (!organisationId) {
      const timer = setTimeout(() => {
        setError("Choose an organisation before creating a lease.");
        setLoading(false);
      }, 0);

      return () => clearTimeout(timer);
    }

    Promise.all([
      fetch("/api/dashboard", {
        headers: { "x-organisation-id": organisationId },
      }),
      fetch("/api/tenants", {
        headers: { "x-organisation-id": organisationId },
      }),
    ])
      .then(async ([propertyResponse, tenantResponse]) => {
        if (!propertyResponse.ok || !tenantResponse.ok) {
          const failed = !propertyResponse.ok
            ? propertyResponse
            : tenantResponse;

          throw new Error(
            (await failed.json()).error?.message ??
              "Unable to load lease options.",
          );
        }

        setProperties((await propertyResponse.json()).properties);
        setTenants(await tenantResponse.json());
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to load lease options.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!propertyId) {
      setUnits([]);
      setUnitId("");
      return;
    }

    const organisationId = localStorage.getItem(
      "propertyos.activeOrganisationId",
    );

    if (!organisationId) return;

    fetch(`/api/properties?id=${encodeURIComponent(propertyId)}`, {
      headers: { "x-organisation-id": organisationId },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            (await response.json()).error?.message ?? "Unable to load units.",
          );
        }

        const property = await response.json();

        const nextUnits = [
          ...property.units,
          ...property.buildings.flatMap(
            (building: { units: UnitOption[] }) => building.units,
          ),
        ] as UnitOption[];

        setUnits(nextUnits);
        setUnitId((current) =>
          current && !nextUnits.some((unit) => unit.id === current)
            ? ""
            : current,
        );
      })
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : "Unable to load units.",
        ),
      )
      .finally(() => setLoadingUnits(false));
  }, [propertyId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const organisationId = localStorage.getItem(
      "propertyos.activeOrganisationId",
    );

    if (!organisationId) {
      setError("Choose an organisation before creating a lease.");
      return;
    }

    const form = new FormData(event.currentTarget);

    const tenantOrganisationIds = selectedTenantIds;

    const response = await fetch("/api/leases", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-organisation-id": organisationId,
      },
      body: JSON.stringify({
        referenceNumber: form.get("referenceNumber"),
        propertyId: form.get("propertyId"),
        unitId: unitId || undefined,
        tenantOrganisationIds,
        startDate: form.get("startDate"),
        endDate: form.get("endDate") || undefined,
        rentAmountMinor: String(
          Math.round(Number(form.get("rentAmount")) * 100),
        ),
        currencyCode: form.get("currencyCode"),
        rentFrequency: form.get("rentFrequency"),
        depositAmountMinor: form.get("depositAmount")
          ? String(Math.round(Number(form.get("depositAmount")) * 100))
          : undefined,
        notes: form.get("notes") || undefined,
      }),
    });

    if (!response.ok) {
      setError(
        (await response.json()).error?.message ?? "Unable to create lease.",
      );
      return;
    }

    const lease = await response.json();
    router.push(`/leases/${lease.id}`);
  }

  if (loading) {
    return (
      <div className="mt-6 rounded-2xl border border-hairline bg-white p-6 text-sm text-muted shadow-sm">
        Loading properties and tenants...
      </div>
    );
  }

  return (
    <form
      className="mt-6 overflow-hidden rounded-2xl border border-hairline bg-white shadow-sm"
      onSubmit={submit}
    >
      <div className="border-b border-hairline px-5 py-5 sm:px-6">
        <h2 className="text-lg font-semibold text-ink">Lease details</h2>
        <p className="mt-1 text-sm text-muted">
          Connect a property, tenant and rent structure into one lease record.
        </p>
      </div>

      <div className="grid gap-7 p-5 sm:p-6">
        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-teal">
            Property & tenant
          </p>

          <div className="mt-4 grid gap-5 md:grid-cols-2">
            <label className="text-sm font-medium text-ink">
              Lease reference
              <input
                className={INPUT}
                name="referenceNumber"
                placeholder="e.g. LEASE-2026-001"
                required
              />
            </label>

            <label className="text-sm font-medium text-ink">
              Property
              <select
                className={INPUT}
                name="propertyId"
                onChange={(event) => {
                  setUnits([]);
                  setUnitId("");
                  setLoadingUnits(Boolean(event.target.value));
                  setPropertyId(event.target.value);
                }}
                required
                value={propertyId}
              >
                <option value="">Select a property</option>

                {properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name} ({property.referenceNumber})
                  </option>
                ))}
              </select>
              {!properties.length && (
                <span className="mt-2 block text-xs text-amber-700">
                  No properties are available in this organisation.
                </span>
              )}
            </label>

            <label className="text-sm font-medium text-ink">
              Unit
              <span className="ml-1 font-normal text-muted">(optional)</span>
              <select
                className={INPUT}
                disabled={!propertyId || loadingUnits}
                name="unitId"
                onChange={(event) => setUnitId(event.target.value)}
                value={unitId}
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
              Tenants
              <select
                className="mt-2 min-h-32 w-full rounded-xl border border-hairline bg-white p-3 text-sm text-ink outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/10"
                multiple
                name="tenantOrganisationIds"
                onChange={(event) =>
                  setSelectedTenantIds(
                    Array.from(event.target.selectedOptions, (option) => option.value),
                  )
                }
                required
                value={selectedTenantIds}
              >
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.tenant.preferredName || tenant.tenant.legalName}
                    {tenant.email ? ` — ${tenant.email}` : ""}
                  </option>
                ))}
              </select>
              {!tenants.length && (
                <span className="mt-2 block text-xs text-amber-700">
                  No tenants are available in this organisation.
                </span>
              )}
              <span className="mt-2 block text-xs font-normal text-muted">
                Use Ctrl/Cmd to select multiple tenants.
              </span>
            </label>
          </div>
        </section>

        <div className="h-px bg-hairline" />

        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-teal">
            Lease term
          </p>

          <div className="mt-4 grid gap-5 md:grid-cols-2">
            <label className="text-sm font-medium text-ink">
              Start date
              <input className={INPUT} name="startDate" required type="date" />
            </label>

            <label className="text-sm font-medium text-ink">
              End date
              <span className="ml-1 font-normal text-muted">(optional)</span>
              <input className={INPUT} name="endDate" type="date" />
            </label>
          </div>
        </section>

        <div className="h-px bg-hairline" />

        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-teal">
            Financial terms
          </p>

          <div className="mt-4 grid gap-5 md:grid-cols-3">
            <label className="text-sm font-medium text-ink">
              Rent amount
              <input
                className={INPUT}
                min="0.01"
                name="rentAmount"
                required
                step="0.01"
                type="number"
              />
            </label>

            <label className="text-sm font-medium text-ink">
              Currency
              <input
                className={INPUT}
                defaultValue="GHS"
                name="currencyCode"
                required
              />
            </label>

            <label className="text-sm font-medium text-ink">
              Frequency
              <select className={INPUT} name="rentFrequency">
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="ANNUAL">Annual</option>
              </select>
            </label>
          </div>

          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <label className="text-sm font-medium text-ink">
              Deposit
              <span className="ml-1 font-normal text-muted">(optional)</span>
              <input
                className={INPUT}
                min="0"
                name="depositAmount"
                step="0.01"
                type="number"
              />
            </label>
          </div>
        </section>

        <div className="h-px bg-hairline" />

        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-teal">
            Notes
          </p>

          <label className="mt-4 block text-sm font-medium text-ink">
            Internal lease notes
            <textarea
              className="mt-2 min-h-28 w-full rounded-xl border border-hairline bg-white p-3.5 text-sm text-ink outline-none transition placeholder:text-muted focus:border-teal focus:ring-2 focus:ring-teal/10"
              name="notes"
              placeholder="Optional internal notes..."
              rows={4}
            />
          </label>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-hairline bg-warm-white px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
        <button
          className="rounded-xl border border-hairline bg-white px-5 py-2.5 text-sm font-semibold text-muted transition hover:border-forest/20 hover:text-ink"
          onClick={() => router.push("/leases")}
          type="button"
        >
          Cancel
        </button>

        <button
          className="rounded-xl bg-forest px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-light"
          type="submit"
        >
          Create lease
        </button>
      </div>
    </form>
  );
}
