"use client";

import { useState } from "react";
import { OnboardingForm } from "@/components/onboarding-form";
import { MarketplaceProfessionalOnboardingForm } from "@/components/marketplace-professional-onboarding-form";
import { trackCampaignEvent } from "@/components/marketing/campaign-tracking";

type Choice = "MANAGE" | "MARKET" | null;

export default function OnboardingPage() {
  const [choice, setChoice] = useState<Choice>(null);

  if (!choice) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-sm font-semibold text-emerald-700">STEP 1 OF 2</p>
        <h1 className="mt-3 text-3xl font-semibold">What do you want to do on Umo Afric?</h1>
        <p className="mt-2 text-slate-600">
          You can add the other workspace later without creating another account — one identity, both sides of Umo Afric.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <button className="rounded-xl border p-6 text-left transition hover:border-emerald-500" onClick={() => { trackCampaignEvent("manage_properties_selected"); setChoice("MANAGE"); }} type="button">
            <p className="font-semibold">Manage Properties</p>
            <p className="mt-2 text-sm text-slate-600">
              For landlords, property owners, property managers, property management companies, and developers managing their own portfolio. Enters PropertyOS management (paid).
            </p>
          </button>
          <button className="rounded-xl border p-6 text-left transition hover:border-emerald-500" onClick={() => { trackCampaignEvent("market_properties_selected"); trackCampaignEvent("professional_registration_started"); setChoice("MARKET"); }} type="button">
            <p className="font-semibold">Market Properties</p>
            <p className="mt-2 text-sm text-slate-600">
              For agents, brokers, brokerages, real-estate companies, developers, and property-marketing companies. Enters the Umo Afric Real Estate Marketplace — free at launch.
            </p>
          </button>
        </div>
      </main>
    );
  }

  if (choice === "MARKET") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-sm font-semibold text-emerald-700">STEP 2 OF 2 — MARKET PROPERTIES</p>
        <h1 className="mt-3 text-3xl font-semibold">Set up your marketplace profile</h1>
        <p className="mt-2 text-slate-600">Free at launch. You can also set up PropertyOS management later.</p>
        <MarketplaceProfessionalOnboardingForm />
        <button className="mt-4 text-sm font-semibold text-slate-600" onClick={() => setChoice(null)} type="button">← Back</button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-sm font-semibold text-emerald-700">STEP 2 OF 2 — MANAGE PROPERTIES</p>
      <h1 className="mt-3 text-3xl font-semibold">Set up your organisation</h1>
      <p className="mt-2 text-slate-600">Ghana is available now. Its default operating currency is GHS.</p>
      <OnboardingForm />
      <button className="mt-4 text-sm font-semibold text-slate-600" onClick={() => setChoice(null)} type="button">← Back</button>
    </main>
  );
}
