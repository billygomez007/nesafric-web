"use client";

import { type FormEvent, useEffect, useState } from "react";

type Unit = { id: string; name: string; unitType: string | null; status: string; bedrooms: number | null; bathrooms: string | null; priceMinor: string | null; currencyCode: string | null };
type Development = { id: string; name: string; description: string | null; status: string; city: string | null; region: string | null; units: Unit[] };

const STATUS_STYLES: Record<string, string> = {
  AVAILABLE: "bg-emerald-50 text-emerald-800",
  RESERVED: "bg-amber-50 text-amber-800",
  SOLD: "bg-slate-200 text-slate-700",
  RENTED: "bg-slate-200 text-slate-700",
  UNAVAILABLE: "bg-red-50 text-red-800",
};

export function MarketplaceDevelopmentDetail({ professionalId, developmentId }: { professionalId: string; developmentId: string }) {
  const [development, setDevelopment] = useState<Development | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/developments/${developmentId}`);
    const body = await response.json();
    if (response.ok) setDevelopment(body);
    else setError(body.error?.message ?? "Unable to load this development.");
  }

  useEffect(() => {
    fetch(`/api/marketplace-professionals/${professionalId}/developments/${developmentId}`).then(async (response) => {
      const body = await response.json();
      if (response.ok) setDevelopment(body);
      else setError(body.error?.message ?? "Unable to load this development.");
    });
  }, [professionalId, developmentId]);

  async function addUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const priceMinor = form.get("price") ? String(Math.round(Number(form.get("price")) * 100)) : undefined;
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/developments/${developmentId}/units`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: form.get("name"), unitType: form.get("unitType") || undefined, priceMinor, currencyCode: priceMinor ? "GHS" : undefined }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to add that unit.");
    (event.target as HTMLFormElement).reset();
    await load();
  }

  async function updateStatus(unitId: string, status: string) {
    setError("");
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/developments/${developmentId}/units/${unitId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to update that unit.");
    await load();
  }

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>;
  if (!development) return <p className="text-slate-600">Loading…</p>;

  return (
    <div className="grid gap-6">
      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{development.name}</h1>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{development.status.replaceAll("_", " ")}</span>
        </div>
        <p className="mt-1 text-sm text-slate-500">{[development.city, development.region].filter(Boolean).join(", ") || "Location not set"}</p>
        {development.description && <p className="mt-3 text-slate-700">{development.description}</p>}
      </section>

      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="font-semibold">Add inventory</h2>
        <form className="mt-3 grid gap-3 sm:grid-cols-4" onSubmit={addUnit}>
          <input className="rounded border p-2 text-sm" name="name" placeholder="Unit 12" required />
          <input className="rounded border p-2 text-sm" name="unitType" placeholder="2-bedroom" />
          <input className="rounded border p-2 text-sm" min="0" name="price" placeholder="Price (GHS)" step="0.01" type="number" />
          <button className="rounded bg-slate-950 px-4 py-2 text-sm font-semibold text-white" type="submit">Add unit</button>
        </form>
      </section>

      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="font-semibold">Inventory ({development.units.length})</h2>
        {development.units.length === 0 ? <p className="mt-3 text-sm text-slate-500">No units yet.</p> : (
          <ul className="mt-3 divide-y">
            {development.units.map((unit) => (
              <li className="flex items-center justify-between py-3" key={unit.id}>
                <div>
                  <p className="font-medium">{unit.name}{unit.unitType ? ` · ${unit.unitType}` : ""}</p>
                  <p className="text-sm text-slate-500">{unit.priceMinor && unit.currencyCode ? new Intl.NumberFormat("en-GH", { style: "currency", currency: unit.currencyCode }).format(Number(unit.priceMinor) / 100) : "Price not set"}</p>
                </div>
                <select className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_STYLES[unit.status] ?? ""}`} defaultValue={unit.status} onChange={(event) => void updateStatus(unit.id, event.target.value)}>
                  <option value="AVAILABLE">Available</option>
                  <option value="RESERVED">Reserved</option>
                  <option value="SOLD">Sold</option>
                  <option value="RENTED">Rented</option>
                  <option value="UNAVAILABLE">Unavailable</option>
                </select>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
