"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const INPUT =
  "mt-2 h-11 w-full rounded-xl border border-hairline bg-white px-3.5 text-sm text-ink outline-none transition placeholder:text-muted focus:border-teal focus:ring-2 focus:ring-teal/10";

export function TenantForm() {
  const router = useRouter();
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const organisationId = localStorage.getItem(
      "propertyos.activeOrganisationId",
    );

    if (!organisationId) {
      setError("Choose an organisation before creating a tenant.");
      return;
    }

    const response = await fetch("/api/tenants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-organisation-id": organisationId,
      },
      body: JSON.stringify(
        Object.fromEntries(new FormData(event.currentTarget)),
      ),
    });

    if (!response.ok) {
      setError(
        (await response.json()).error?.message ?? "Unable to create tenant.",
      );
      return;
    }

    router.push("/tenants");
  }

  return (
    <form
      className="rounded-2xl border border-hairline bg-white shadow-[0_8px_28px_rgba(16,45,42,0.035)]"
      onSubmit={submit}
    >
      <div className="border-b border-hairline px-5 py-4 sm:px-6">
        <h2 className="text-sm font-semibold text-ink">Tenant information</h2>
        <p className="mt-1 text-xs leading-5 text-muted">
          Create a tenant profile that can later be connected to leases,
          payments and communication preferences.
        </p>
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="text-sm font-medium text-ink">
            Legal name
            <input className={INPUT} name="legalName" required />
          </label>

          <label className="text-sm font-medium text-ink">
            Preferred name
            <span className="ml-1 font-normal text-muted">(optional)</span>
            <input className={INPUT} name="preferredName" />
          </label>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="text-sm font-medium text-ink">
            Email
            <input className={INPUT} name="email" type="email" />
          </label>

          <label className="text-sm font-medium text-ink">
            Phone
            <input className={INPUT} name="phone" type="tel" />
          </label>
        </div>

        <label className="block text-sm font-medium text-ink">
          Notes
          <span className="ml-1 font-normal text-muted">(optional)</span>
          <textarea
            className="mt-2 min-h-28 w-full resize-y rounded-xl border border-hairline bg-white px-3.5 py-3 text-sm text-ink outline-none transition placeholder:text-muted focus:border-teal focus:ring-2 focus:ring-teal/10"
            name="notes"
            rows={4}
          />
        </label>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            {error}
          </p>
        )}
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
          className="rounded-xl bg-forest px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-light"
          type="submit"
        >
          Create tenant
        </button>
      </div>
    </form>
  );
}
