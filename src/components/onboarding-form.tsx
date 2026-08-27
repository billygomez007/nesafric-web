"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { trackCampaignEvent } from "@/components/marketing/campaign-tracking";

export function OnboardingForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/organisations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), type: form.get("type"), countryCode: "GH", defaultCurrencyCode: "GHS" }) });
    if (!response.ok) return setError((await response.json()).error?.message ?? "Unable to create organisation.");
    localStorage.setItem("propertyos.activeOrganisationId", (await response.json()).id);
    trackCampaignEvent("manage_properties_registration_completed");
    router.push("/dashboard");
  }
  return <form className="mt-8 grid gap-4 rounded-xl border p-6" onSubmit={submit}>
    <label className="text-sm font-medium">Organisation name<input className="mt-1 w-full rounded border p-3" name="name" required /></label>
    <label className="text-sm font-medium">Organisation type<select className="mt-1 w-full rounded border p-3" name="type"><option value="INDIVIDUAL_LANDLORD">Individual landlord</option><option value="PROPERTY_MANAGEMENT">Property management company</option><option value="REAL_ESTATE">Real estate company</option><option value="DEVELOPER">Property developer</option><option value="OTHER">Other</option></select></label>
    <div className="grid grid-cols-2 gap-4"><label className="text-sm font-medium">Country<input className="mt-1 w-full rounded border bg-slate-50 p-3" value="Ghana (GH)" readOnly /></label><label className="text-sm font-medium">Default currency<input className="mt-1 w-full rounded border bg-slate-50 p-3" value="GHS" readOnly /></label></div>
    {error && <p className="text-sm text-red-700">{error}</p>}
    <button className="rounded bg-slate-950 p-3 font-semibold text-white">Continue to property setup</button>
  </form>;
}
