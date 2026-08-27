"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { trackCampaignEvent } from "@/components/marketing/campaign-tracking";

const TYPES = [
  ["INDIVIDUAL_AGENT", "Individual agent"],
  ["BROKER", "Broker"],
  ["BROKERAGE", "Brokerage"],
  ["REAL_ESTATE_COMPANY", "Real estate company"],
  ["DEVELOPER", "Developer"],
  ["PROPERTY_MARKETING_COMPANY", "Property marketing company"],
  ["OTHER", "Other"],
] as const;

export function MarketplaceProfessionalOnboardingForm() {
  const router = useRouter();
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/marketplace-professionals", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: form.get("displayName"), type: form.get("type"), countryCode: "GH" }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to create your marketplace profile.");
    localStorage.setItem("nesafric.activeMarketplaceProfessionalId", body.id);
    trackCampaignEvent(form.get("type") === "DEVELOPER" ? "developer_registration_completed" : "professional_registration_completed");
    router.push(`/pro/${body.id}`);
  }

  return (
    <form className="mt-8 grid gap-4 rounded-xl border p-6" onSubmit={submit}>
      <label className="text-sm font-medium">
        Business / display name
        <input className="mt-1 w-full rounded border p-3" name="displayName" placeholder="e.g. Golden Coast Brokerage" required />
      </label>
      <label className="text-sm font-medium">
        Professional type
        <select className="mt-1 w-full rounded border p-3" name="type">
          {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className="text-sm font-medium">Country<input className="mt-1 w-full rounded border bg-slate-50 p-3" readOnly value="Ghana (GH)" /></label>
        <label className="text-sm font-medium">Marketplace plan<input className="mt-1 w-full rounded border bg-slate-50 p-3" readOnly value="Free" /></label>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button className="rounded bg-brand p-3 font-semibold text-navy transition-colors hover:bg-brand-hover">Create marketplace profile</button>
      <p className="text-xs text-slate-500">Free at launch. This is completely separate from UmoAfric management — no property-management subscription is created.</p>
    </form>
  );
}
