import type { Metadata } from "next";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { PageViewTracker } from "@/components/marketing/page-view-tracker";
import { DevelopersHero } from "@/components/marketing/developers-hero";
import { DevelopersCapabilitiesSection } from "@/components/marketing/developers-capabilities-section";
import { WorkflowStorySection } from "@/components/marketing/workflow-story-section";
import { AICapabilitiesSection } from "@/components/marketing/ai-capabilities-section";
import { LaunchOfferSection } from "@/components/marketing/launch-offer-section";
import { FinalCtaSection } from "@/components/marketing/final-cta-section";

export const metadata: Metadata = {
  title: "For Property Developers in Ghana",
  description:
    "NesAfric gives property developers in Ghana a development profile, unit-level inventory, marketplace listings, leads and viewings, a sales team and AI sales support — with optional property management for delivered units.",
  alternates: { canonical: "/for-developers" },
  openGraph: {
    title: "Sell every unit, floor by floor.",
    description:
      "Showcase developments, manage unit inventory, and sell through the NesAfric Marketplace — with property management available when you need it.",
    url: "/for-developers",
  },
};

export default function ForDevelopersPage() {
  return (
    <>
      <PageViewTracker event="for_developers_view" />
      <SiteNav />
      <main>
        <DevelopersHero />
        <DevelopersCapabilitiesSection />
        <WorkflowStorySection />
        <AICapabilitiesSection
          heading="AI across the sales cycle."
          intro="From the first enquiry on a unit to a coordinated viewing, AI works inside your development's pipeline — available according to your plan."
          kicker="AI for development sales"
        />
        <LaunchOfferSection ctaLabel="Start Free" />
        <FinalCtaSection />
      </main>
      <SiteFooter />
    </>
  );
}
