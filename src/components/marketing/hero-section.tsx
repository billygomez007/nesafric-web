import Image from "next/image";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button-styles";

/** Illustrative only — labelled as such on the page. Shows the shape of a NesAfric property
 * record (address-first identity, brochure spec strip, ledger status), not a real listing. */
const EXAMPLE_RECORD = {
  unit: "Unit B4",
  building: "Ridge House",
  area: "North Ridge, Accra",
  specs: ["2 bed", "2 bath", "96 m²"],
  rent: "GH₵6,500",
  status: [
    ["Lease", "Active to Aug 2027"],
    ["September rent", "Paid 2 Sep"],
    ["Maintenance", "None open"],
  ],
};

export function HeroSection() {
  return (
    <section className="bg-warm-white">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-5 pb-14 pt-10 sm:px-8 sm:pb-20 sm:pt-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-14 lg:py-16">
        <div className="max-w-[600px]">
          <p className="text-sm font-medium text-gold-ink">Property management, rent and listings — built in Accra</p>

          <h1 className="mt-4 text-[clamp(2.5rem,5.2vw,4.25rem)] font-semibold leading-[1.02] tracking-[-0.03em] text-forest-deep">
            The operating system for real estate.
          </h1>

          <p className="mt-6 max-w-[540px] text-base leading-7 text-muted sm:text-[17px] sm:leading-8">
            Keep every property, tenant, lease, rent payment and repair on one record — and put your vacant units in
            front of people looking for their next home. Made for landlords, managers and agents in Ghana, ready for
            the rest of Africa.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link className={buttonClass("primary")} href="/register">
              Start with NesAfric
            </Link>
            <Link className={buttonClass("secondary")} href="/marketplace/properties">
              Browse properties
            </Link>
          </div>
        </div>

        <figure className="relative">
          <div className="relative aspect-[4/3] overflow-hidden rounded-[var(--radius-media)] bg-cream sm:aspect-[16/11]">
            <Image
              alt="Contemporary residential building at dusk"
              className="object-cover"
              fill
              priority
              sizes="(min-width: 1024px) 55vw, 100vw"
              src="/marketing/nesafric/hero-source.png"
            />
          </div>

          {/* A property record, drawn the way NesAfric shows it: address first, specs as a
              brochure strip, then the operating state on hairline ledger rows. */}
          <figcaption className="relative -mt-10 ml-4 mr-4 border border-hairline bg-white px-5 py-4 sm:-mt-16 sm:ml-8 sm:mr-auto sm:w-[400px]">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 font-display text-[15px] font-semibold text-forest-deep">
                {EXAMPLE_RECORD.unit} · {EXAMPLE_RECORD.building}
              </p>
              <p className="shrink-0 whitespace-nowrap text-[15px] font-semibold tabular-nums text-forest-deep">
                {EXAMPLE_RECORD.rent}
                <span className="text-xs font-normal text-muted"> / mo</span>
              </p>
            </div>
            <p className="mt-0.5 text-xs text-muted">
              {EXAMPLE_RECORD.area} · {EXAMPLE_RECORD.specs.join(" · ")}
            </p>
            <dl className="mt-3 border-t border-hairline">
              {EXAMPLE_RECORD.status.map(([label, value]) => (
                <div className="flex items-center justify-between gap-4 border-b border-hairline py-2 text-xs last:border-b-0" key={label}>
                  <dt className="text-muted">{label}</dt>
                  <dd className="font-medium text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[11px] text-slate-500">Illustrative example</p>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
