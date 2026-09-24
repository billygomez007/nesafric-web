"use client";

import { FormEvent, useState } from "react";

type BuildingOption = {
  id: string;
  name: string;
};

const INPUT =
  "mt-2 h-11 w-full rounded-xl border border-hairline bg-white px-3.5 text-sm text-ink outline-none transition placeholder:text-muted focus:border-teal focus:ring-2 focus:ring-teal/10";

export function PropertyUnitForm({
  propertyId,
  buildings,
  onCreated,
  onCancel,
}: {
  propertyId: string;
  buildings: BuildingOption[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const organisationId = localStorage.getItem(
        "propertyos.activeOrganisationId",
      );
      if (!organisationId) {
        setError("Choose an organisation before adding a unit.");
        return;
      }

      const form = new FormData(event.currentTarget);
      const bedrooms = String(form.get("bedrooms") ?? "");
      const bathrooms = String(form.get("bathrooms") ?? "");

      const response = await fetch(
        `/api/properties/${encodeURIComponent(propertyId)}/units`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-organisation-id": organisationId,
          },
          body: JSON.stringify({
            name: form.get("name"),
            unitType: form.get("unitType") || undefined,
            floor: form.get("floor") || undefined,
            bedrooms: bedrooms ? Number(bedrooms) : undefined,
            bathrooms: bathrooms ? Number(bathrooms) : undefined,
            buildingId: form.get("buildingId") || undefined,
            status: form.get("status"),
          }),
        },
      );

      if (!response.ok) {
        setError(
          (await response.json()).error?.message ?? "Unable to add unit.",
        );
        return;
      }

      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to add unit.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-[0_12px_32px_rgba(16,45,42,0.06)]"
      onSubmit={submit}
    >
      <div className="border-b border-hairline px-5 py-4 sm:px-6">
        <h3 className="text-base font-semibold text-ink">Add unit</h3>
        <p className="mt-1 text-sm text-muted">
          Add a rentable or manageable space inside this property.
        </p>
      </div>

      <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
        <label className="text-sm font-medium text-ink">
          Unit name or number
          <input
            className={INPUT}
            name="name"
            placeholder="e.g. A1, Shop 3, Suite 402"
            required
          />
        </label>

        <label className="text-sm font-medium text-ink">
          Unit type
          <input
            className={INPUT}
            name="unitType"
            placeholder="e.g. Apartment, Shop, Office"
          />
        </label>

        <label className="text-sm font-medium text-ink">
          Building / block
          <select className={INPUT} name="buildingId">
            <option value="">No building / direct property unit</option>
            {buildings.map((building) => (
              <option key={building.id} value={building.id}>
                {building.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-medium text-ink">
          Floor
          <input className={INPUT} name="floor" placeholder="e.g. 2" />
        </label>

        <label className="text-sm font-medium text-ink">
          Bedrooms
          <input className={INPUT} min="0" name="bedrooms" type="number" />
        </label>

        <label className="text-sm font-medium text-ink">
          Bathrooms
          <input className={INPUT} min="0" name="bathrooms" type="number" />
        </label>

        <label className="text-sm font-medium text-ink sm:col-span-2">
          Status
          <select className={INPUT} defaultValue="AVAILABLE" name="status">
            <option value="AVAILABLE">Available</option>
            <option value="OCCUPIED">Occupied</option>
            <option value="RESERVED">Reserved</option>
            <option value="MAINTENANCE">Maintenance</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </label>

        {error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 sm:col-span-2">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex justify-end gap-3 border-t border-hairline bg-warm-white px-5 py-4 sm:px-6">
        <button
          className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition hover:text-ink"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="rounded-xl bg-forest px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-light disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600"
          disabled={submitting}
          type="submit"
        >
          {submitting ? "Adding..." : "Add unit"}
        </button>
      </div>
    </form>
  );
}
