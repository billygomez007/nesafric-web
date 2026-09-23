import Image from "next/image";
import Link from "next/link";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-warm-white">
      <div className="mx-auto grid min-h-[610px] max-w-[1400px] items-center gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[0.82fr_1.18fr] lg:py-20">
        <div className="relative z-10 max-w-[560px]">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-gold">REAL ESTATE OS FOR AFRICA</p>
          <h1 className="mt-5 text-[clamp(3rem,5vw,5.3rem)] font-semibold leading-[0.98] tracking-[-0.055em] text-forest-deep">Real Estate<br />OS for Africa</h1>
          <p className="mt-6 max-w-[500px] text-base leading-7 text-muted sm:text-lg">Manage properties. Connect people. Grow opportunities.<br className="hidden sm:block" /> All in one intelligent platform.</p>
          <div className="mt-8 flex flex-wrap gap-3"><Link className="rounded-xl bg-forest px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-forest/15 transition hover:bg-emerald" href="/register">Get Started <span aria-hidden="true">→</span></Link><Link className="rounded-xl border border-forest/40 px-6 py-3.5 text-sm font-semibold text-forest transition hover:bg-cream" href="/marketplace/properties">Explore Properties</Link></div>
          <div className="mt-12 flex flex-wrap gap-x-7 gap-y-4 text-sm text-ink"><span><strong className="text-lg">Property</strong><br /><span className="text-muted">operations</span></span><span className="border-l border-hairline pl-7"><strong className="text-lg">People</strong><br /><span className="text-muted">connected</span></span><span className="border-l border-hairline pl-7"><strong className="text-lg">Africa</strong><br /><span className="text-muted">built in</span></span></div>
        </div>
        <div className="relative min-h-[380px] overflow-hidden rounded-[28px] lg:min-h-[550px]">
          <Image alt="Contemporary African residential property at golden hour" className="h-full w-full object-cover" fill priority sizes="(min-width: 1024px) 60vw, 100vw" src="/marketing/nesafric/hero-source.png" />
          <div className="absolute inset-0 bg-gradient-to-r from-warm-white/50 via-transparent to-transparent lg:from-warm-white/65" />
          <div className="absolute bottom-5 right-5 hidden w-[310px] rounded-2xl border border-white/70 bg-white/95 p-4 shadow-xl sm:block"><div className="flex items-center justify-between"><span className="rounded-full bg-teal/10 px-2.5 py-1 text-[11px] font-bold text-emerald">LIVE MARKETPLACE</span><span className="text-gold">⌂</span></div><p className="mt-3 text-sm font-semibold text-ink">Find a place that fits your next chapter.</p><p className="mt-1 text-xs leading-5 text-muted">Verified homes, connected professionals and clearer decisions.</p><Link className="mt-3 inline-flex text-xs font-semibold text-forest" href="/marketplace/properties">Browse properties →</Link></div>
        </div>
      </div>
    </section>
  );
}
