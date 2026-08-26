"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Category = { id: string; key: string; name: string };
type Organisation = { id: string; name: string };

export function ProviderForm() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [type, setType] = useState("INDIVIDUAL");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    Promise.all([fetch("/api/providers/categories"), fetch("/api/organisations")]).then(async ([categoryResponse, organisationResponse]) => {
      if (!categoryResponse.ok) throw new Error("Unable to load service categories.");
      setCategories(await categoryResponse.json());
      if (organisationResponse.ok) setOrganisations(await organisationResponse.json());
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load provider options."));
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Choose an organisation before registering a provider.");
    const data = new FormData(event.currentTarget);
    setSaving(true); setError("");
    const providerResponse = await fetch("/api/providers", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type, companyOrganisationId: type === "COMPANY" ? data.get("companyOrganisationId") : undefined,
        displayName: data.get("displayName"), legalName: data.get("legalName") || undefined,
        contactEmail: data.get("contactEmail") || undefined, contactPhone: data.get("contactPhone") || undefined,
        biography: data.get("biography") || undefined, categoryIds: data.getAll("categoryIds"),
        serviceAreas: [
          ["COUNTRY", data.get("country")], ["REGION_STATE", data.get("region")], ["CITY", data.get("city")], ["DISTRICT", data.get("district")],
        ].filter(([, name]) => name).map(([areaType, name]) => ({ areaType, name })),
      }),
    });
    if (!providerResponse.ok) { setError((await providerResponse.json()).error?.message ?? "Unable to register provider."); setSaving(false); return; }
    const provider = await providerResponse.json();
    const directoryResponse = await fetch("/api/providers/directory", { method: "POST", headers: { "content-type": "application/json", "x-organisation-id": organisationId }, body: JSON.stringify({ providerId: provider.id }) });
    if (!directoryResponse.ok) { setError((await directoryResponse.json()).error?.message ?? "Provider created but could not be added to this directory."); setSaving(false); return; }
    router.push(`/providers/${provider.id}`);
  }
  return <form className="grid gap-5 rounded-2xl border bg-white p-6 shadow-sm" onSubmit={submit}><div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Provider type<select className="mt-1 w-full rounded-lg border p-3" value={type} onChange={(event) => setType(event.target.value)}><option value="INDIVIDUAL">Individual artisan</option><option value="COMPANY">Service company</option></select></label>{type === "COMPANY" && <label className="text-sm font-medium">Existing provider organisation<select className="mt-1 w-full rounded-lg border p-3" name="companyOrganisationId" required><option value="">Select organisation</option>{organisations.map((organisation) => <option key={organisation.id} value={organisation.id}>{organisation.name}</option>)}</select></label>}</div><div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Display name<input className="mt-1 w-full rounded-lg border p-3" name="displayName" required /></label><label className="text-sm font-medium">Legal name<input className="mt-1 w-full rounded-lg border p-3" name="legalName" /></label></div><div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Email<input className="mt-1 w-full rounded-lg border p-3" name="contactEmail" type="email" /></label><label className="text-sm font-medium">Phone<input className="mt-1 w-full rounded-lg border p-3" name="contactPhone" /></label></div><label className="text-sm font-medium">Profile / biography<textarea className="mt-1 w-full rounded-lg border p-3" name="biography" rows={3} /></label><fieldset className="rounded-xl border p-4"><legend className="px-1 text-sm font-semibold">Service categories</legend><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{categories.map((category) => <label className="flex items-center gap-2 text-sm" key={category.id}><input name="categoryIds" type="checkbox" value={category.id} />{category.name}</label>)}</div></fieldset><fieldset className="rounded-xl border p-4"><legend className="px-1 text-sm font-semibold">Service areas</legend><p className="mb-3 text-xs text-slate-500">Location fields are optional and remain country-neutral.</p><div className="grid gap-3 sm:grid-cols-2"><input className="rounded-lg border p-3 text-sm" name="country" placeholder="Country" /><input className="rounded-lg border p-3 text-sm" name="region" placeholder="Region / state" /><input className="rounded-lg border p-3 text-sm" name="city" placeholder="City" /><input className="rounded-lg border p-3 text-sm" name="district" placeholder="District" /></div></fieldset>{error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}<button className="rounded-lg bg-slate-950 p-3 font-semibold text-white disabled:opacity-50" disabled={saving}>{saving ? "Registering..." : "Register provider"}</button></form>;
}
