"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export function MarketplaceDevelopmentForm({ professionalId }: { professionalId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/developments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"), description: form.get("description") || undefined,
        countryCode: "GH", city: form.get("city") || undefined, region: form.get("region") || undefined,
      }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to create the development.");
    router.push(`/pro/${professionalId}/developments/${body.id}`);
  }

  return (
    <form className="mt-8 grid gap-4 rounded-xl border p-6" onSubmit={submit}>
      <label className="text-sm font-medium">Development name<input className="mt-1 w-full rounded border p-3" name="name" required /></label>
      <label className="text-sm font-medium">Description<textarea className="mt-1 w-full rounded border p-3" name="description" rows={3} /></label>
      <div className="grid grid-cols-2 gap-4">
        <label className="text-sm font-medium">City<input className="mt-1 w-full rounded border p-3" name="city" /></label>
        <label className="text-sm font-medium">Region<input className="mt-1 w-full rounded border p-3" name="region" /></label>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button className="rounded bg-slate-950 p-3 font-semibold text-white">Create development</button>
    </form>
  );
}
