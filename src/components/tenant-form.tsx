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

const INPUT =
  "mt-2 h-11 w-full rounded-xl border border-hairline bg-white px-3.5 text-sm text-ink outline-none transition placeholder:text-muted focus:border-teal focus:ring-2 focus:ring-teal/10 disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted";

export function TenantForm({
  initialPropertyId = "",
  initialUnitId = "",
}: {
  initialPropertyId?: string;
  initialUnitId?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [propertyId, setPropertyId] = useState(initialPropertyId);
  const [unitId, setUnitId] = useState(initialUnitId);
  const [loadingUnits, setLoadingUnits] = useState(Boolean(initialPropertyId));

  useEffect(() => {
    const organisationId = localStorage.getItem(
      "propertyos.activeOrganisationId",
    );
    if (!organisationId) return;

    fetch("/api/properties", {
      headers: { "x-organisation-id": organisationId },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            (await response.json()).error?.message ??
              "Unable to load properties.",
          );
        }
        setProperties((await response.json()) as PropertyOption[]);
      })
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : "Unable to load properties.",
        ),
      );
  }, []);

  useEffect(() => {
    if (!propertyId) return;

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
    setError("");
    setSubmitting(true);

    try {
      const organisationId = localStorage.getItem(
        "propertyos.activeOrganisationId",
      );

      if (!organisationId) {
        setError("Choose an organisation before creating a tenant.");
        return;
      }

      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/tenants", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-organisation-id": organisationId,
        },
        body: JSON.stringify({
          legalName: form.get("legalName"),
          preferredName: form.get("preferredName") || undefined,
          email: form.get("email") || undefined,
          phone: form.get("phone") || undefined,
          notes: form.get("notes") || undefined,
        }),
      });

      if (!response.ok) {
        setError(
          (await response.json()).error?.message ?? "Unable to create tenant.",
        );
        return;
      }

      const created = await response.json();

      if (propertyId) {
        const params = new URLSearchParams({
          propertyId,
          tenantId: created.relationship.id,
        });
        if (unitId) params.set("unitId", unitId);
        router.push(`/leases/new?${params.toString()}`);
        return;
      }

      router.push("/tenants");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to create tenant.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="rounded-2xl border border-hairline bg-white shadow-[0_8px_28px_rgba(16,45,42,0.035)]"
      onSubmit={submit}
    >
      <div className="border-b border-hairline px-5 py-4 sm:px-6">
        <h2 className="text-sm font-semibold text-ink">Tenant information</h2>
        <p className="mt-1 text-xs leading-5 text-muted">
          Create the tenant profile, then connect it to the correct property
          and unit through a lease.
        </p>
      </div>

      <div className="space-y-7 p-5 sm:p-6">
        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal">
            Tenant profile
          </p>

          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink">
              Legal name
              <input className={INPUT} name="legalName" required />
            </label>

            <label className="text-sm font-medium text-ink">
              Preferred name
              <span className="ml-1 font-normal text-muted">(optional)</span>
              <input className={INPUT} name="preferredName" />
            </label>

            <label className="text-sm font-medium text-ink">
              Email
              <input className={INPUT} name="email" type="email" />
            </label>

            <label className="text-sm font-medium text-ink">
              Phone
              <input className={INPUT} name="phone" type="tel" />
            </label>
          </div>
        </section>

        <div className="h-px bg-hairline" />

        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal">
            Property placement
          </p>
          <p className="mt-1 text-sm text-muted">
            Optional. If selected, NesAfric will continue to lease creation
            after the tenant profile is saved.
          </p>

          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink">
              Property
              <select
                className={INPUT}
                onChange={(event) => {
                  const nextPropertyId = event.target.value;
                  setUnits([]);
                  setUnitId("");
                  setLoadingUnits(Boolean(nextPropertyId));
                  setPropertyId(nextPropertyId);
                }}
                value={propertyId}
              >
                <option value="">No property yet</option>
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name} ({property.referenceNumber})
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-medium text-ink">
              Unit
              <select
                className={INPUT}
                disabled={!propertyId || loadingUnits}
                onChange={(event) => setUnitId(event.target.value)}
                value={unitId}
              >
                <option value="">
                  {loadingUnits ? "Loading units..." : "No unit selected"}
                </option>
                {units.map((unit) => (
                  <option
                    disabled={
                      unit.status !== "AVAILABLE" &&
                      unit.id !== initialUnitId
                    }
                    key={unit.id}
                    value={unit.id}
                  >
                    {unit.name} ({unit.status.toLowerCase()})
                  </option>
                ))}
              </select>
            </label>
          </div>

          {propertyId ? (
            <div className="mt-4 rounded-xl border border-teal/15 bg-teal/5 p-4 text-sm text-ink">
              After the tenant is created, you will continue to the lease form
              with this property
              {unitId ? " and unit" : ""} already selected.
            </div>
          ) : null}
        </section>

        <div className="h-px bg-hairline" />

        <label className="block text-sm font-medium text-ink">
          Notes
          <span className="ml-1 font-normal text-muted">(optional)</span>
          <textarea
            className="mt-2 min-h-28 w-full resize-y rounded-xl border border-hairline bg-white px-3.5 py-3 text-sm text-ink outline-none transition placeholder:text-muted focus:border-teal focus:ring-2 focus:ring-teal/10"
            name="notes"
            rows={4}
          />
        </label>

        {error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-hairline px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
        <button
          className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition hover:bg-surface hover:text-ink"
          onClick={() => router.push("/tenants")}
          type="button"
        >
          Cancel
        </button>

        <button
          className="rounded-xl bg-forest px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-light disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600"
          disabled={submitting}
          type="submit"
        >
          {submitting
            ? "Creating..."
            : propertyId
              ? "Create tenant & continue"
              : "Create tenant"}
        </button>
      </div>
    </form>
  );
}
