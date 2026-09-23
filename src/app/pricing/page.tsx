import type { Metadata } from "next";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { PricingExperience } from "@/components/marketing/pricing-experience";

export const metadata: Metadata = {
  title: "Pricing | NesAfric",
  description:
    "Compare NesAfric pricing for property management and professional marketplace workspaces in Ghana. See monthly and annual GHS pricing, plan limits, AI capabilities and included features.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "NesAfric Pricing",
    description:
      "Clear pricing for landlords, property managers, agents, brokerages, real-estate companies and developers.",
    url: "/pricing",
  },
};

export default function PricingPage() {
  return (
    <>
      <SiteNav />
      <main>
        <PricingExperience />
      </main>
      <SiteFooter />
    </>
  );
}
