import { HomepageAnnouncementBar } from "@/components/homepage-announcement-bar";
import { SiteNav } from "@/components/marketing/site-nav";
import { HeroSection } from "@/components/marketing/hero-section";
import { GhanaLaunchSignal } from "@/components/marketing/ghana-launch-signal";
import { CompaniesCarouselSection } from "@/components/marketing/companies-carousel-section";
import { AudienceSection } from "@/components/marketing/audience-section";
import { OperatingSystemSection } from "@/components/marketing/operating-system-section";
import { AIEmployeesSection } from "@/components/marketing/ai-employees-section";
import { PortfolioSection } from "@/components/marketing/portfolio-section";
import { PaymentsSection } from "@/components/marketing/payments-section";
import { MaintenanceSection } from "@/components/marketing/maintenance-section";
import { MarketplaceSection } from "@/components/marketing/marketplace-section";
import { LifecycleSection } from "@/components/marketing/lifecycle-section";
import { TrustSection } from "@/components/marketing/trust-section";
import { FinalCtaSection } from "@/components/marketing/final-cta-section";
import { SiteFooter } from "@/components/marketing/site-footer";
import { BRAND } from "@/platform/brand";

const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: BRAND.name,
  description:
    "UmoAfric is the intelligent real estate operating and marketplace platform for Ghana — property management, listings, leads and AI-powered operations in one place.",
  url: `https://${BRAND.domain}`,
  logo: `https://${BRAND.domain}${BRAND.logo.onLight}`,
  email: BRAND.contact.info,
  telephone: BRAND.contact.phoneTel,
  address: { "@type": "PostalAddress", streetAddress: BRAND.contact.address, addressCountry: "GH" },
  areaServed: { "@type": "Country", name: "Ghana" },
};

export default function Home() {
  return (
    <>
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSON_LD) }}
        type="application/ld+json"
      />
      <HomepageAnnouncementBar />
      <SiteNav />
      <main>
        <HeroSection />
        <CompaniesCarouselSection />
        <GhanaLaunchSignal />
        <AudienceSection />
        <OperatingSystemSection />
        <AIEmployeesSection />
        <PortfolioSection />
        <PaymentsSection />
        <MaintenanceSection />
        <MarketplaceSection />
        <LifecycleSection />
        <TrustSection />
        <FinalCtaSection />
      </main>
      <SiteFooter />
    </>
  );
}
