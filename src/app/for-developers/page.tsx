import type { Metadata } from "next";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { PageViewTracker } from "@/components/marketing/page-view-tracker";
import { DevelopersHero } from "@/components/marketing/developers-hero";
import { ProductMockup } from "@/components/marketing/product-mockup";
import { DevelopersCapabilitiesSection } from "@/components/marketing/developers-capabilities-section";
import { WorkflowStorySection } from "@/components/marketing/workflow-story-section";
import { AICapabilitiesSection } from "@/components/marketing/ai-capabilities-section";
import { LaunchOfferSection } from "@/components/marketing/launch-offer-section";
import { FinalCtaSection } from "@/components/marketing/final-cta-section";

export const metadata: Metadata = {
  title: "For Property Developers in Ghana",
  description:
    "UmoAfric gives property developers in Ghana a development profile, unit-level inventory, marketplace listings, leads and viewings, a sales team and AI sales support — with optional property management for delivered units.",
  alternates: { canonical: "/for-developers" },
  openGraph: {
    title: "From development to deal — run it on UmoAfric.",
    description:
      "Showcase developments, manage unit inventory, and sell through the UmoAfric Marketplace — with property management available when you need it.",
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
        <section className="bg-slate-950 px-6 pb-24 sm:px-8 sm:pb-32">
          <ProductMockup
            alt="UmoAfric development sales command center showing unit inventory, sell-through rate and sales pipeline for a live development"
            src="/marketing/mockups/developers-sales-command-center.png"
          />
        </section>
        <DevelopersCapabilitiesSection />
        <WorkflowStorySection />
        <AICapabilitiesSection
          heading="AI across the sales cycle."
          intro="From the first enquiry on a unit to a coordinated viewing, AI works inside your development's pipeline — available according to your plan."
          kicker="AI FOR DEVELOPMENTS"
        />
        <LaunchOfferSection ctaLabel="Start Free" />
        <FinalCtaSection />
      </main>
      <SiteFooter />
    </>
  );
}
