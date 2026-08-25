"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function PropertyForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Choose an organisation before creating property assets.");
    const form = new FormData(event.currentTarget);
    const unitNames = String(form.get("unitNames") ?? "").split(",").map((name) => name.trim()).filter(Boolean).map((name) => ({ name }));
    const buildingName = String(form.get("buildingName") ?? "").trim();
    const response = await fetch("/api/properties", { method: "POST", headers: { "content-type": "application/json", "x-organisation-id": organisationId }, body: JSON.stringify({ name: form.get("name"), referenceNumber: form.get("referenceNumber"), category: form.get("category"), city: form.get("city") || undefined, addressLine1: form.get("addressLine1") || undefined, countryCode: "GH", currencyCode: "GHS", building: buildingName ? { name: buildingName, units: unitNames } : undefined, units: buildingName ? [] : unitNames }) });
    if (!response.ok) return setError((await response.json()).error?.message ?? "Unable to create property.");
    router.push("/properties");
  }
  return <form className="mt-8 grid gap-4 rounded-xl border p-6" onSubmit={submit}>
    <div className="grid grid-cols-2 gap-4"><label className="text-sm font-medium">Property name<input className="mt-1 w-full rounded border p-3" name="name" required /></label><label className="text-sm font-medium">Reference number<input className="mt-1 w-full rounded border p-3" name="referenceNumber" required /></label></div>
    <label className="text-sm font-medium">Category<select className="mt-1 w-full rounded border p-3" name="category"><option>Residential</option><option>Commercial</option><option>Industrial</option><option>Land</option><option>Hospitality</option><option>Mixed-use</option></select></label>
    <div className="grid grid-cols-2 gap-4"><label className="text-sm font-medium">City<input className="mt-1 w-full rounded border p-3" name="city" /></label><label className="text-sm font-medium">Address<input className="mt-1 w-full rounded border p-3" name="addressLine1" /></label></div>
    <label className="text-sm font-medium">Building name <span className="font-normal text-slate-500">(optional)</span><input className="mt-1 w-full rounded border p-3" name="buildingName" /></label>
    <label className="text-sm font-medium">Unit names <span className="font-normal text-slate-500">(optional, comma-separated)</span><input className="mt-1 w-full rounded border p-3" name="unitNames" placeholder="A1, A2, A3" /></label>
    {error && <p className="text-sm text-red-700">{error}</p>}
    <button className="rounded bg-slate-950 p-3 font-semibold text-white">Create property</button>
  </form>;
}
