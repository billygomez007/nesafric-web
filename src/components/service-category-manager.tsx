"use client";

import { FormEvent, useEffect, useState } from "react";

type Category = { id: string; key: string; name: string; description: string | null };

export function ServiceCategoryManager() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState("");
  async function load() {
    const response = await fetch("/api/providers/categories");
    if (!response.ok) throw new Error((await response.json()).error?.message ?? "Unable to load categories.");
    setCategories(await response.json());
  }
  useEffect(() => { const timer = setTimeout(() => void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load categories.")), 0); return () => clearTimeout(timer); }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Choose an organisation.");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/providers/categories", { method: "POST", headers: { "content-type": "application/json", "x-organisation-id": organisationId }, body: JSON.stringify({ key: data.get("key"), name: data.get("name"), description: data.get("description") || undefined }) });
    if (!response.ok) return setError((await response.json()).error?.message ?? "Unable to create category.");
    event.currentTarget.reset(); setError(""); await load();
  }
  return <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Service categories</h2><p className="mt-1 text-sm text-slate-500">Initial categories are seeded and authorised users can extend them.</p><div className="mt-4 flex flex-wrap gap-2">{categories.map((category) => <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm" key={category.id}>{category.name}</span>)}</div><form className="mt-5 grid gap-3 border-t pt-5 md:grid-cols-[1fr_1fr_2fr_auto]" onSubmit={create}><input className="rounded-lg border p-2 text-sm" name="key" placeholder="category-key" required /><input className="rounded-lg border p-2 text-sm" name="name" placeholder="Category name" required /><input className="rounded-lg border p-2 text-sm" name="description" placeholder="Description (optional)" /><button className="rounded-lg border px-4 py-2 text-sm font-semibold">Add category</button></form>{error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}</section>;
}
