import type { Metadata } from "next";
import { Suspense } from "react";
import { MarketplaceDirectory } from "@/components/marketplace-directory";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { MarketplaceSubnav } from "@/components/marketplace-subnav";

export const metadata: Metadata = {
  title: "Verified agents, brokerages and developers in Ghana",
  description: "Find verified real estate agents, brokerages, property companies and developers active on NesAfric.",
  alternates: { canonical: "/marketplace/professionals" },
};

export default function MarketplaceProfessionalDirectoryPage() {
  return (
    <>
      <SiteNav />
      <MarketplaceSubnav />
      <Suspense fallback={null}>
        <MarketplaceDirectory />
      </Suspense>
      <SiteFooter />
    </>
  );
}
