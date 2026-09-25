import type { Metadata } from "next";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { HeroSearch } from "@/components/marketplace-home/hero-search";
import { MarketplaceCarousel } from "@/components/marketplace-carousel";
import { PlatformBanner } from "@/components/marketplace-home/platform-banner";
import { MarketplaceHome } from "@/components/marketplace-home/marketplace-home";
import { BRAND } from "@/platform/brand";

const TITLE = "Property to rent and buy in Ghana";
const DESCRIPTION =
  "Find houses, apartments, land and commercial property to rent or buy across Ghana, from the owners, managers, agents and developers responsible for them — on NesAfric, the operating system for real estate.";

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | ${BRAND.name}` },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    title: `${TITLE} | ${BRAND.name}`,
    description: DESCRIPTION,
    url: "/",
    images: [{ url: BRAND.logo.og, width: 1200, height: 630, alt: BRAND.name }],
  },
  twitter: { card: "summary_large_image", title: `${TITLE} | ${BRAND.name}`, description: DESCRIPTION, images: [BRAND.logo.og] },
};

export default function Home() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${BRAND.siteUrl}/#organization`,
        name: BRAND.name,
        url: BRAND.siteUrl,
        logo: `${BRAND.siteUrl}${BRAND.logo.onLight}`,
        description: "A Ghana-first property marketplace backed by a real estate operating platform.",
        address: { "@type": "PostalAddress", streetAddress: BRAND.contact.address, addressCountry: "GH" },
        email: BRAND.contact.hello,
        telephone: BRAND.contact.phoneTel,
      },
      {
        "@type": "WebSite",
        "@id": `${BRAND.siteUrl}/#website`,
        url: BRAND.siteUrl,
        name: BRAND.name,
        publisher: { "@id": `${BRAND.siteUrl}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: `${BRAND.siteUrl}/marketplace/properties?q={search_term_string}` },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} type="application/ld+json" />
      <SiteNav />
      <main className="bg-warm-white">
        <section className="marketing-grid bg-forest-deep">
          <div className="mx-auto max-w-[1400px] px-5 pb-12 pt-12 sm:px-8 sm:pb-16 sm:pt-16 lg:pt-20">
            <div className="max-w-3xl text-white">
              <p className="text-sm font-medium text-gold-soft">The NesAfric marketplace</p>
              <h1 className="mt-3 text-[clamp(2.25rem,5vw,3.75rem)] font-semibold leading-[1.04] tracking-[-0.03em]">
                Find property across Ghana.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-white/75 sm:text-[17px]">
                Homes, land and commercial space to rent or buy — listed by the owners, managers, agents and developers responsible for them.
              </p>
            </div>
            {/* The advertising slot is always present: live campaigns when there are any,
                otherwise NesAfric's own banner. */}
            <div className="mt-8 overflow-hidden rounded-[var(--radius-panel)] border border-white/10">
              <MarketplaceCarousel fallback={<PlatformBanner />} placement="MARKETPLACE_PRIMARY" />
            </div>
            <div className="mt-8 overflow-hidden rounded-[var(--radius-panel)] border border-white/10">
              <HeroSearch />
            </div>
          </div>
        </section>
        <MarketplaceHome />
      </main>
      <SiteFooter />
    </>
  );
}
