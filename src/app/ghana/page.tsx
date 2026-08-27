import type { Metadata } from "next";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { PageViewTracker } from "@/components/marketing/page-view-tracker";
import { GhanaHero } from "@/components/marketing/ghana-hero";
import { GhanaPitchSection } from "@/components/marketing/ghana-pitch-section";
import { WorkflowStorySection } from "@/components/marketing/workflow-story-section";
import { GhanaMobileShowcaseSection } from "@/components/marketing/ghana-mobile-showcase-section";
import { AICapabilitiesSection } from "@/components/marketing/ai-capabilities-section";
import { GhanaMarketplaceSection } from "@/components/marketing/ghana-marketplace-section";
import { LaunchOfferSection } from "@/components/marketing/launch-offer-section";
import { FinalCtaSection } from "@/components/marketing/final-cta-section";

export const metadata: Metadata = {
  title: "Now Live in Ghana",
  description:
    "Umo Afric is now live in Ghana — a real estate platform bringing property marketing, listings, leads, viewings, teams and AI-powered operations into one place. Marketplace Professional accounts are free during launch.",
  alternates: { canonical: "/ghana" },
  openGraph: {
    title: "Umo Afric is now live in Ghana",
    description:
      "The new way to run real estate has arrived in Ghana. List properties, manage leads and viewings, and put AI to work around your real-estate business — free for Marketplace Professionals during launch.",
    url: "/ghana",
  },
};

export default function GhanaLaunchPage() {
  return (
    <>
      <PageViewTracker event="ghana_landing_view" />
      <SiteNav />
      <main>
        <GhanaHero />
        <GhanaPitchSection />
        <WorkflowStorySection />
        <GhanaMobileShowcaseSection />
        <AICapabilitiesSection />
        <GhanaMarketplaceSection />
        <LaunchOfferSection />
        <FinalCtaSection />
      </main>
      <SiteFooter />
    </>
  );
}
