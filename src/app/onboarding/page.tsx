"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { OnboardingForm } from "@/components/onboarding-form";
import { MarketplaceProfessionalOnboardingForm } from "@/components/marketplace-professional-onboarding-form";
import { ServiceProviderOnboardingForm } from "@/components/service-provider-onboarding-form";
import { trackCampaignEvent } from "@/components/marketing/campaign-tracking";
import { trackEvent } from "@/platform/analytics";

type Choice = "MANAGE" | "MARKET" | "SERVICES" | null;
type CampaignEvent = "manage_properties_selected" | "market_properties_selected" | "offer_property_services_selected";

const choices: Array<{ key: Exclude<Choice, null>; title: string; description: string; event: CampaignEvent }> = [
  { key: "MANAGE" as const, title: "Manage properties", description: "For owners, landlords, property managers and developers operating properties.", event: "manage_properties_selected" },
  { key: "MARKET" as const, title: "Market properties", description: "For agents, brokers, brokerages and developers marketing property through the NesAfric Marketplace.", event: "market_properties_selected" },
  { key: "SERVICES" as const, title: "Offer property services", description: "For artisans, contractors and service businesses receiving property-related work through NesAfric.", event: "offer_property_services_selected" },
];

const START_PARAM: Record<string, Exclude<Choice, null>> = { manage: "MANAGE", market: "MARKET", services: "SERVICES" };

export default function OnboardingPage() {
  const [choice, setChoice] = useState<Choice>(null);
  // `?start=manage|market|services` opens one setup directly (used by the mobile app's role cards).
  useEffect(() => {
    const start = START_PARAM[new URLSearchParams(window.location.search).get("start") ?? ""];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL after hydration
    if (start) setChoice(start);
  }, []);
  const select = (next: Exclude<Choice, null>, event: CampaignEvent) => { trackCampaignEvent(event); trackEvent("onboarding_started", { onboarding_type: next === "MANAGE" ? "manage_properties" : next === "MARKET" ? "market_properties" : "offer_property_services" }); setChoice(next); };
  const heading = choice === "MARKET" ? "Set up your marketplace profile" : choice === "SERVICES" ? "Set up your service-professional profile" : "Set up your organisation";

  return <main className="min-h-screen bg-warm-white px-5 py-8 sm:px-8 sm:py-12"><div className="mx-auto max-w-3xl"><Link href="/"><BrandLogo height={28} variant="light" /></Link><div className="mt-10"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{choice ? "STEP 2 OF 2" : "WELCOME TO NESAFRIC"}</p><h1 className="mt-3 text-3xl font-semibold tracking-tight text-forest sm:text-4xl">{choice ? heading : "Choose your starting workspace"}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted">{choice ? "Your account can add another workspace later. Complete this setup to enter the right NesAfric experience." : "One secure identity can support property operations, marketplace work and service profiles."}</p></div>
    {!choice ? <div className="mt-8 grid gap-4">{choices.map((item) => <button className="group rounded-2xl border border-hairline bg-white p-6 text-left shadow-card transition hover:border-teal hover:shadow-lg" key={item.key} onClick={() => select(item.key, item.event)} type="button"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-forest">{item.title}</h2><p className="mt-2 text-sm leading-6 text-muted">{item.description}</p></div><span className="text-xl text-gold transition group-hover:translate-x-1">→</span></div></button>)}</div> : <div className="mt-8 rounded-3xl border border-hairline bg-white p-6 shadow-card sm:p-8">{choice === "MARKET" ? <MarketplaceProfessionalOnboardingForm /> : choice === "SERVICES" ? <ServiceProviderOnboardingForm /> : <OnboardingForm />}<button className="mt-5 text-sm font-semibold text-muted transition hover:text-teal" onClick={() => setChoice(null)} type="button">← Choose a different workspace</button></div>}
  </div></main>;
}
