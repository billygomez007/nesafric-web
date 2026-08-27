import type { Metadata } from "next";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { PageViewTracker } from "@/components/marketing/page-view-tracker";
import { ProfessionalsHero } from "@/components/marketing/professionals-hero";
import { ProductMockup } from "@/components/marketing/product-mockup";
import { SoloAgentSection } from "@/components/marketing/solo-agent-section";
import { BrokerageSection } from "@/components/marketing/brokerage-section";
import { WorkflowStorySection } from "@/components/marketing/workflow-story-section";
import { AICapabilitiesSection } from "@/components/marketing/ai-capabilities-section";
import { LaunchOfferSection } from "@/components/marketing/launch-offer-section";
import { FinalCtaSection } from "@/components/marketing/final-cta-section";

export const metadata: Metadata = {
  title: "For Real Estate Agents & Brokerages in Ghana",
  description:
    "UmoAfric gives real estate agents, brokers, brokerages and real estate companies in Ghana a professional presence, listings, a lead pipeline, viewing coordination and AI sales support. Free for Marketplace Professionals during launch.",
  alternates: { canonical: "/for-professionals" },
  openGraph: {
    title: "You handle the deal. UmoAfric handles the work around it.",
    description:
      "List properties, capture enquiries, manage leads, coordinate viewings and organise your team — free for Marketplace Professionals during the Ghana launch.",
    url: "/for-professionals",
  },
};

export default function ForProfessionalsPage() {
  return (
    <>
      <PageViewTracker event="for_professionals_view" />
      <SiteNav />
      <main>
        <ProfessionalsHero />
        <section className="bg-slate-950 px-6 pb-24 sm:px-8 sm:pb-32">
          <ProductMockup
            alt="UmoAfric real estate business workspace showing lead pipeline, active listings, developments and AI sales agent activity"
            src="/marketing/mockups/professionals-business-workspace.png"
          />
        </section>
        <SoloAgentSection />
        <BrokerageSection />
        <WorkflowStorySection />
        <AICapabilitiesSection
          heading="Sales support, built in."
          intro="AI works inside your pipeline — available according to your plan — to take on the repetitive follow-up around every enquiry, so you can spend your time on the deals that need you."
          kicker="AI FOR SALES"
        />
        <LaunchOfferSection ctaLabel="Start Free" />
        <FinalCtaSection />
      </main>
      <SiteFooter />
    </>
  );
}
