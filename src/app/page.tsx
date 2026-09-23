import Link from "next/link";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { HeroSection } from "@/components/marketing/hero-section";
import { ProductMockup } from "@/components/marketing/product-mockup";
import { BRAND } from "@/platform/brand";

const CAPABILITIES = [
  ["⌂", "Property Management", "Everything you need to run your properties."],
  ["♙", "Tenant & Lease Management", "From inquiry to renewal."],
  ["₵", "Payments & Collections", "Secure and automated."],
  ["↗", "Maintenance & Work Orders", "Keep properties in top shape."],
  ["▣", "Property Marketplace", "Buy, rent or sell."],
  ["♧", "Service Professionals", "Verified providers."],
  ["▥", "Insights & Reports", "Data for better decisions."],
];

export default function Home() {
  const jsonLd = { "@context": "https://schema.org", "@type": "Organization", name: BRAND.name, description: "Real Estate OS for Africa", url: BRAND.siteUrl, logo: `${BRAND.siteUrl}${BRAND.logo.onLight}` };
  return <>
    <script dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} type="application/ld+json" />
    <SiteNav />
    <main>
      <HeroSection />
      <section className="border-y border-hairline bg-white"><div className="mx-auto grid max-w-[1400px] grid-cols-2 divide-x divide-hairline sm:grid-cols-4"><div className="p-6 sm:p-8"><p className="font-semibold text-forest">Property operations</p><p className="mt-1 text-sm text-muted">One connected workspace</p></div><div className="p-6 sm:p-8"><p className="font-semibold text-forest">Marketplace</p><p className="mt-1 text-sm text-muted">Real opportunities</p></div><div className="p-6 sm:p-8"><p className="font-semibold text-forest">Professionals</p><p className="mt-1 text-sm text-muted">People you can trust</p></div><div className="p-6 sm:p-8"><p className="font-semibold text-forest">Built for Africa</p><p className="mt-1 text-sm text-muted">Local insight, global standards</p></div></div></section>
      <section className="bg-white px-5 py-16 sm:px-8 sm:py-20" id="product"><div className="mx-auto max-w-[1400px]"><p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold">WHAT YOU CAN DO</p><div className="mt-5 grid gap-8 lg:grid-cols-[0.8fr_2.2fr]"><h2 className="max-w-md text-3xl font-semibold tracking-tight text-forest-deep sm:text-4xl">The connected system for every stage of real estate.</h2><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{CAPABILITIES.map(([icon, title, description]) => <article className="rounded-2xl border border-hairline bg-warm-white p-5 transition hover:-translate-y-0.5 hover:border-gold/60" key={title}><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cream text-xl text-gold" aria-hidden="true">{icon}</span><h3 className="mt-4 text-sm font-semibold text-ink">{title}</h3><p className="mt-2 text-xs leading-5 text-muted">{description}</p></article>)}</div></div></div></section>
      <section className="bg-warm-white px-5 py-16 sm:px-8 sm:py-24"><div className="mx-auto grid max-w-[1400px] items-center gap-10 lg:grid-cols-[0.85fr_1.15fr]"><div><p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold">WHY NESAFRIC</p><h2 className="mt-5 max-w-xl text-3xl font-semibold leading-tight tracking-tight text-forest-deep sm:text-4xl">More than a marketplace. A complete real estate operating system.</h2><p className="mt-5 max-w-lg leading-7 text-muted">NesAfric brings together landlords, tenants, agents, service professionals and developers on one intelligent platform designed for the African real estate ecosystem.</p><Link className="mt-7 inline-flex rounded-xl bg-forest px-5 py-3 text-sm font-semibold text-white" href="/for-property-owners">Learn More <span aria-hidden="true" className="ml-2">→</span></Link></div><ProductMockup alt="NesAfric property management workspace" src="/marketing/mockups/homepage-platform-overview.png" maxWidthClassName="max-w-3xl" theme="light" priority /></div></section>
      <section className="relative overflow-hidden bg-forest-deep px-5 py-16 text-white sm:px-8 sm:py-20"><div className="mx-auto grid max-w-[1400px] items-center gap-10 lg:grid-cols-[1.4fr_0.6fr]"><div><p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold-soft">BUILT FOR AFRICA</p><h2 className="mt-5 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">Powering real estate growth across Africa</h2><p className="mt-5 max-w-xl leading-7 text-white/70">Local insights. Global standards. A platform built for our markets, opportunities and future.</p><div className="mt-8 h-px w-24 bg-gold" /></div><div className="border-l border-gold/50 pl-8"><p className="text-4xl font-semibold leading-none">One Africa</p><p className="mt-2 text-xl text-white/65">Many opportunities</p></div></div></section>
      <section className="bg-white px-5 py-16 text-center sm:px-8 sm:py-20"><h2 className="text-3xl font-semibold tracking-tight text-forest-deep">Ready to build what comes next?</h2><p className="mx-auto mt-4 max-w-xl text-muted">Bring your properties, people and opportunities into one clear operating system.</p><div className="mt-7 flex justify-center gap-3"><Link className="rounded-xl bg-forest px-6 py-3.5 text-sm font-semibold text-white" href="/register">Get Started →</Link><Link className="rounded-xl border border-forest/30 px-6 py-3.5 text-sm font-semibold text-forest" href="/marketplace/properties">Explore Properties</Link></div></section>
    </main>
    <SiteFooter />
  </>;
}
