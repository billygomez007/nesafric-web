import type { Metadata } from "next";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { PageViewTracker } from "@/components/marketing/page-view-tracker";
import { PropertyOwnersHero } from "@/components/marketing/property-owners-hero";
import { PropertyOwnersCapabilitiesSection } from "@/components/marketing/property-owners-capabilities-section";
import { AICapabilitiesSection } from "@/components/marketing/ai-capabilities-section";
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
        <PropertyOwnersCapabilitiesSection />
        <AICapabilitiesSection
          heading="Operational intelligence, with AI built in."
          intro="AI employees work inside day-to-day operations — available according to your plan — surfacing what needs attention across the portfolio and handling routine tenant and maintenance communication."
          kicker="AI FOR OPERATIONS"
        />
        <FinalCtaSection />
      </main>
      <SiteFooter />
    </>
  );
}
