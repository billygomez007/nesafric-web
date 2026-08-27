import { HomepageAnnouncementBar } from "@/components/homepage-announcement-bar";
import { SiteNav } from "@/components/marketing/site-nav";
import { HeroSection } from "@/components/marketing/hero-section";
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

export default function Home() {
  return (
    <>
      <HomepageAnnouncementBar />
      <SiteNav />
      <main>
        <HeroSection />
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
