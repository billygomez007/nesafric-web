import type { Metadata } from "next";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { PageViewTracker } from "@/components/marketing/page-view-tracker";
import { PropertyOwnersHero } from "@/components/marketing/property-owners-hero";
import { PropertyOwnersCapabilitiesSection } from "@/components/marketing/property-owners-capabilities-section";
import { AICapabilitiesSection } from "@/components/marketing/ai-capabilities-section";
import { ProductMockup } from "@/components/marketing/product-mockup";
import { FinalCtaSection } from "@/components/marketing/final-cta-section";

export const metadata: Metadata = {
  title: "Property Management Software for Ghana",
  description:
    "Umo Afric is an intelligent property management platform for landlords, property owners, property managers and developers in Ghana — properties, tenants, leases, rent, payments, maintenance and AI employees, all in one place.",
  alternates: { canonical: "/for-property-owners" },
  openGraph: {
    title: "Run your property operation from one intelligent platform.",
    description:
      "Properties, units, tenants, leases, rent, payments, maintenance and providers — organised in one place, with AI employees working inside the operation.",
    url: "/for-property-owners",
  },
};

export default function ForPropertyOwnersPage() {
  return (
    <>
      <PageViewTracker event="for_property_owners_view" />
      <SiteNav />
      <main>
        <PropertyOwnersHero />
        <section className="bg-slate-950 px-6 pb-24 sm:px-8 sm:pb-32">
          <ProductMockup
            alt="Umo Afric property owner dashboard showing portfolio overview, rent collection and AI property manager activity"
            src="/marketing/mockups/property-owners-dashboard.png"
          />
        </section>
        <PropertyOwnersCapabilitiesSection />
        <AICapabilitiesSection
          heading="Operational intelligence, with AI built in."
          intro="AI employees work inside day-to-day operations — available according to your plan — surfacing what needs attention across the portfolio and handling routine tenant and maintenance communication."
          kicker="AI FOR OPERATIONS"
          mockup={{
            src: "/marketing/mockups/ai-workforce-command-center.png",
            alt: "Umo Afric AI Workforce Command Center showing the AI Receptionist, AI Sales Agent, AI Property Manager and AI Maintenance Coordinator, plus a maintenance request handled end to end",
          }}
        />
        <FinalCtaSection />
      </main>
      <SiteFooter />
    </>
  );
}
