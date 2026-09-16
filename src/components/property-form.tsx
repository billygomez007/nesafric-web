"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

const INPUT =
  "mt-2 h-11 w-full rounded-xl border border-hairline bg-white px-3.5 text-sm text-ink outline-none transition placeholder:text-muted focus:border-teal focus:ring-2 focus:ring-teal/10";

export function PropertyForm() {
  const router = useRouter();
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const organisationId = localStorage.getItem(
      "propertyos.activeOrganisationId",
    );

    if (!organisationId) {
      setError("Choose an organisation before creating property assets.");
      return;
    }

    const form = new FormData(event.currentTarget);

    const unitNames = String(form.get("unitNames") ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({ name }));

    const buildingName = String(form.get("buildingName") ?? "").trim();

    const response = await fetch("/api/properties", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-organisation-id": organisationId,
      },
      body: JSON.stringify({
        name: form.get("name"),
        referenceNumber: form.get("referenceNumber"),
        category: form.get("category"),
        city: form.get("city") || undefined,
        addressLine1: form.get("addressLine1") || undefined,
        countryCode: "GH",
        currencyCode: "GHS",
        building: buildingName
          ? { name: buildingName, units: unitNames }
          : undefined,
        units: buildingName ? [] : unitNames,
      }),
    });

    if (!response.ok) {
      setError(
        (await response.json()).error?.message ?? "Unable to create property.",
      );
      return;
    }

    router.push("/properties");
  }

  return (
    <form
      className="rounded-2xl border border-hairline bg-white shadow-[0_8px_28px_rgba(16,45,42,0.035)]"
      onSubmit={submit}
    >
      <div className="border-b border-hairline px-5 py-4 sm:px-6">
        <h2 className="text-sm font-semibold text-ink">Property details</h2>
        <p className="mt-1 text-xs leading-5 text-muted">
          Add the basic information needed to create this property in NesAfric.
        </p>
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="text-sm font-medium text-ink">
            Property name
            <input className={INPUT} name="name" required />
          </label>

          <label className="text-sm font-medium text-ink">
            Reference number
            <input className={INPUT} name="referenceNumber" required />
          </label>
        </div>

        <label className="block text-sm font-medium text-ink">
          Category
          <select className={INPUT} name="category">
            <option>Residential</option>
            <option>Commercial</option>
            <option>Industrial</option>
            <option>Land</option>
            <option>Hospitality</option>
            <option>Mixed-use</option>
          </select>
        </label>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="text-sm font-medium text-ink">
            City
            <input className={INPUT} name="city" />
          </label>

          <label className="text-sm font-medium text-ink">
            Address
            <input className={INPUT} name="addressLine1" />
          </label>
        </div>

        <div className="rounded-xl bg-surface p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-teal">
            Optional structure
          </p>

          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink">
              Building name
              <span className="ml-1 font-normal text-muted">(optional)</span>
              <input className={INPUT} name="buildingName" />
            </label>

            <label className="text-sm font-medium text-ink">
              Unit names
              <span className="ml-1 font-normal text-muted">(optional)</span>
              <input
                className={INPUT}
                name="unitNames"
                placeholder="A1, A2, A3"
              />
            </label>
          </div>

          <p className="mt-3 text-xs leading-5 text-muted">
            Enter multiple unit names separated by commas.
          </p>
        </div>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-hairline px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
        <button
          className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition hover:bg-surface hover:text-ink"
          onClick={() => router.push("/properties")}
          type="button"
        >
          Cancel
        </button>

        <button
          className="rounded-xl bg-forest px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-light"
          type="submit"
        >
          Create property
        </button>
      </div>
    </form>
  );
}
