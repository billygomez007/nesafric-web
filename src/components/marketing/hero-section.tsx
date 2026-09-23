import Image from "next/image";
import Link from "next/link";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-warm-white">
      <div className="mx-auto grid max-w-[1400px] items-center gap-9 px-5 py-10 sm:px-8 lg:min-h-[calc(100svh-72px-88px)] lg:grid-cols-[0.86fr_1.14fr] lg:py-8">
        <div className="relative z-10 max-w-[620px]">
          <div className="inline-flex items-center gap-2 rounded-full border border-gold/35 bg-white/80 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-forest shadow-sm backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            Built for African real estate
          </div>

          <h1 className="mt-5 text-[clamp(3rem,4.7vw,4.95rem)] font-semibold leading-[0.94] tracking-[-0.055em] text-forest-deep">
            Run property.
            <br />
            Move money.
            <br />
            <span className="text-emerald">Grow with clarity.</span>
          </h1>

          <p className="mt-5 max-w-[560px] text-base leading-7 text-muted sm:text-[17px]">
            The operating system for African real estate. Manage properties, collect rent,
            serve tenants, coordinate maintenance and find opportunities from one connected platform.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              className="rounded-xl bg-forest px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-forest/15 transition hover:-translate-y-0.5 hover:bg-emerald"
              href="/register"
            >
              Start managing <span aria-hidden="true">→</span>
            </Link>
            <Link
              className="rounded-xl border border-forest/30 bg-white/70 px-6 py-3.5 text-sm font-semibold text-forest transition hover:border-gold/60 hover:bg-white"
              href="/marketplace/properties"
            >
              Explore marketplace
            </Link>
          </div>

        </div>

        <div className="relative">
          <div className="relative min-h-[390px] overflow-hidden rounded-[32px] border border-white/70 shadow-[0_32px_90px_rgba(6,62,56,0.14)] lg:min-h-[500px]">
            <Image
              alt="Contemporary African residential property at golden hour"
              className="h-full w-full object-cover"
              fill
              priority
              sizes="(min-width: 1024px) 58vw, 100vw"
              src="/marketing/nesafric/hero-source.png"
            />
            <div className="absolute inset-0 bg-gradient-to-tr from-forest-deep/28 via-transparent to-white/5" />
          </div>

          <div className="absolute -bottom-4 left-4 right-4 grid gap-3 sm:left-7 sm:right-auto sm:w-[390px] sm:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-2xl border border-white/80 bg-white/95 p-4 shadow-2xl backdrop-blur">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[0.17em] text-gold">Live operations</span>
                <span className="rounded-full bg-emerald/10 px-2 py-1 text-[10px] font-semibold text-emerald">Connected</span>
              </div>
              <p className="mt-3 text-sm font-semibold text-ink">See the whole property business in one place.</p>
              <div className="mt-3 flex gap-2 text-[11px] text-muted">
                <span className="rounded-lg bg-cream px-2 py-1.5">Units</span>
                <span className="rounded-lg bg-cream px-2 py-1.5">Rent</span>
                <span className="rounded-lg bg-cream px-2 py-1.5">Maintenance</span>
              </div>
            </div>

            <Link
              className="rounded-2xl border border-white/80 bg-forest-deep/95 p-4 text-white shadow-2xl backdrop-blur transition hover:-translate-y-0.5"
              href="/marketplace/properties"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.17em] text-gold-soft">Marketplace</span>
              <p className="mt-3 text-sm font-semibold">Find the next opportunity.</p>
              <p className="mt-2 text-xs text-white/65">Browse verified property listings →</p>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
