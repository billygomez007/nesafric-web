"use client";

import { useState } from "react";
import { OnboardingForm } from "@/components/onboarding-form";
import { MarketplaceProfessionalOnboardingForm } from "@/components/marketplace-professional-onboarding-form";
import { ServiceProviderOnboardingForm } from "@/components/service-provider-onboarding-form";
import { trackCampaignEvent } from "@/components/marketing/campaign-tracking";
import { trackEvent } from "@/platform/analytics";

type Choice = "MANAGE" | "MARKET" | "SERVICES" | null;

export default function OnboardingPage() {
  const [choice, setChoice] = useState<Choice>(null);

  if (!choice) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-sm font-semibold text-ink">STEP 1 OF 2</p>
        <h1 className="mt-3 text-3xl font-semibold">What would you like to do on NesAfric?</h1>
        <p className="mt-2 text-muted">
          You can add another workspace later without creating another account — one identity, every side of NesAfric.
        </p>
        <div className="mt-8 grid gap-4">
          <button className="rounded-xl border p-6 text-left transition hover:border-teal" onClick={() => { trackCampaignEvent("manage_properties_selected"); trackEvent("onboarding_started", { onboarding_type: "manage_properties" }); setChoice("MANAGE"); }} type="button">
            <p className="font-semibold">Manage Properties</p>
            <p className="mt-2 text-sm text-muted">
              For property owners, landlords, property managers and developers operating properties. Enters NesAfric management (paid).
            </p>
          </button>
          <button className="rounded-xl border p-6 text-left transition hover:border-teal" onClick={() => { trackCampaignEvent("market_properties_selected"); trackCampaignEvent("professional_registration_started"); trackEvent("onboarding_started", { onboarding_type: "market_properties" }); setChoice("MARKET"); }} type="button">
            <p className="font-semibold">Market Properties</p>
            <p className="mt-2 text-sm text-muted">
              For agents, brokers, brokerages, real-estate companies and developers marketing property. Enters the NesAfric Real Estate Marketplace — free at launch.
            </p>
          </button>
          <button className="rounded-xl border p-6 text-left transition hover:border-teal" onClick={() => { trackEvent("offer_property_services_selected"); trackCampaignEvent("service_professional_registration_started"); trackEvent("onboarding_started", { onboarding_type: "offer_property_services" }); setChoice("SERVICES"); }} type="button">
            <p className="font-semibold">Offer Property Services</p>
            <p className="mt-2 text-sm text-muted">
              For artisans, contractors and property-service businesses that want to receive property-related work through NesAfric. Free at launch — mandatory identity verification applies before you can be publicly discovered or assigned work.
            </p>
          </button>
        </div>
      </main>
    );
  }

  if (choice === "MARKET") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-sm font-semibold text-ink">STEP 2 OF 2 — MARKET PROPERTIES</p>
        <h1 className="mt-3 text-3xl font-semibold">Set up your marketplace profile</h1>
        <p className="mt-2 text-muted">Free at launch. You can also set up NesAfric management later.</p>
        <MarketplaceProfessionalOnboardingForm />
        <button className="mt-4 text-sm font-semibold text-muted" onClick={() => setChoice(null)} type="button">← Back</button>
      </main>
    );
  }

  if (choice === "SERVICES") {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm font-semibold text-ink">STEP 2 OF 2 — OFFER PROPERTY SERVICES</p>
        <h1 className="mt-3 text-3xl font-semibold">Set up your service-professional profile</h1>
        <p className="mt-2 text-muted">Free at launch. Mandatory identity verification is required before your profile can be discovered publicly or receive NesAfric work assignments.</p>
        <ServiceProviderOnboardingForm />
        <button className="mt-4 text-sm font-semibold text-muted" onClick={() => setChoice(null)} type="button">← Back</button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-sm font-semibold text-ink">STEP 2 OF 2 — MANAGE PROPERTIES</p>
      <h1 className="mt-3 text-3xl font-semibold">Set up your organisation</h1>
      <p className="mt-2 text-muted">Ghana is available now. Its default operating currency is GHS.</p>
      <OnboardingForm />
      <button className="mt-4 text-sm font-semibold text-muted" onClick={() => setChoice(null)} type="button">← Back</button>
    </main>
  );
}
