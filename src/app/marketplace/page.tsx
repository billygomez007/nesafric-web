import Link from "next/link";
import { MarketplaceSearch } from "@/components/marketplace-search";
import { MarketplaceCarousel } from "@/components/marketplace-carousel";
import { BrandLogo } from "@/components/brand-logo";

export default function MarketplacePage() {
  return (
    <main className="min-h-screen bg-warm-white text-ink">
      <header className="border-b border-white/10 bg-forest-deep px-4 pb-14 pt-6 text-white sm:px-6 sm:pb-20">
        <div className="mx-auto max-w-7xl">
          <nav className="flex items-center justify-between gap-6" aria-label="Marketplace navigation">
            <Link href="/"><BrandLogo height={26} /></Link>
            <div className="hidden items-center gap-6 text-sm text-white/75 sm:flex">
              <Link className="transition hover:text-white" href="/marketplace/properties">Properties</Link>
              <Link className="transition hover:text-white" href="/marketplace/professionals">Professionals</Link>
              <Link className="transition hover:text-white" href="/marketplace/requests">Request history</Link>
              <Link className="rounded-full border border-white/20 px-4 py-2 text-white transition hover:border-teal-light hover:bg-white/10" href="/dashboard">Dashboard</Link>
            </div>
          </nav>
          <div className="mt-16 max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-soft">THE NESAFRIC MARKETPLACE</p>
            <h1 className="mt-4 max-w-2xl text-4xl font-semibold leading-tight sm:text-6xl">Find the people and places that move Africa forward.</h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-white/70 sm:text-lg">Explore verified service providers, property opportunities, and trusted professionals connected through one real estate operating system.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link className="rounded-xl bg-teal px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-light" href="/marketplace/properties">Explore properties</Link>
              <Link className="rounded-xl border border-white/25 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10" href="/marketplace/professionals">Meet professionals</Link>
            </div>
          </div>
        </div>
      </header>
      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
        <MarketplaceCarousel placement="MARKETPLACE_PRIMARY" />
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          <Link className="group rounded-3xl border border-hairline bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-teal" href="/marketplace/properties">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal">Property marketplace</p>
            <h2 className="mt-3 text-2xl font-semibold text-forest">Find a place to belong.</h2>
            <p className="mt-3 text-sm leading-6 text-muted">Browse published homes, units, and opportunities with availability linked to managed assets.</p>
            <span className="mt-6 inline-flex text-sm font-semibold text-teal">Browse properties <span aria-hidden="true" className="ml-2 transition group-hover:translate-x-1">→</span></span>
          </Link>
          <Link className="group rounded-3xl border border-hairline bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-teal" href="/marketplace/professionals">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal">Professional directory</p>
            <h2 className="mt-3 text-2xl font-semibold text-forest">Work with trusted experts.</h2>
            <p className="mt-3 text-sm leading-6 text-muted">Connect with agents, brokerages, developers, and real estate companies active on NesAfric.</p>
            <span className="mt-6 inline-flex text-sm font-semibold text-teal">Explore professionals <span aria-hidden="true" className="ml-2 transition group-hover:translate-x-1">→</span></span>
          </Link>
          <div className="rounded-3xl border border-gold/30 bg-cream p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">Service network</p>
            <h2 className="mt-3 text-2xl font-semibold text-forest">Get the work done.</h2>
            <p className="mt-3 text-sm leading-6 text-muted">Search verified artisans by category, location, availability, and platform performance.</p>
            <span className="mt-6 inline-flex text-sm font-semibold text-forest">Search below <span aria-hidden="true" className="ml-2">↓</span></span>
          </div>
        </div>
        <div className="mt-16"><MarketplaceSearch /></div>
      </section>
    </main>
  );
}
