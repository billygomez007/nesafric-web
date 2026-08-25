"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function TenantForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Choose an organisation before creating a tenant.");
    const response = await fetch("/api/tenants", { method: "POST", headers: { "content-type": "application/json", "x-organisation-id": organisationId }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    if (!response.ok) return setError((await response.json()).error?.message ?? "Unable to create tenant.");
    router.push("/tenants");
  }
  return <form className="mt-8 grid gap-4 rounded-xl border p-6" onSubmit={submit}>
    <label className="text-sm font-medium">Legal name<input className="mt-1 w-full rounded border p-3" name="legalName" required /></label>
    <label className="text-sm font-medium">Preferred name<input className="mt-1 w-full rounded border p-3" name="preferredName" /></label>
    <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Email<input className="mt-1 w-full rounded border p-3" name="email" type="email" /></label><label className="text-sm font-medium">Phone<input className="mt-1 w-full rounded border p-3" name="phone" /></label></div>
    <label className="text-sm font-medium">Notes<textarea className="mt-1 w-full rounded border p-3" name="notes" rows={3} /></label>
    {error && <p className="text-sm text-red-700">{error}</p>}<button className="rounded bg-slate-950 p-3 font-semibold text-white">Create tenant</button>
  </form>;
}
