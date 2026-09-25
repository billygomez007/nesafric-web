import Link from "next/link";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { HeroSection } from "@/components/marketing/hero-section";
import { CompaniesCarouselSection } from "@/components/marketing/companies-carousel-section";
import { BRAND } from "@/platform/brand";
import { buttonClass } from "@/components/ui/button-styles";

const WORKFLOWS = [
  {
    eyebrow: "Operate",
    title: "Property operations",
    description: "Run portfolios, buildings and units without losing the detail that matters.",
    items: ["Properties & units", "Tenants & leases", "Documents & records"],
    className: "lg:col-span-2 lg:row-span-2",
  },
  {
    eyebrow: "Collect",
    title: "Rent & payments",
    description: "Track obligations, collections, receipts and recurring charges in one financial view.",
    items: ["Collections", "Receipts", "Recurring charges"],
    className: "lg:col-span-2",
  },
  {
    eyebrow: "Resolve",
    title: "Maintenance",
    description: "Turn requests into work orders and keep every property moving.",
    items: ["Requests", "Assignments", "Work orders"],
    className: "lg:col-span-1",
  },
  {
    eyebrow: "Connect",
    title: "Tenant experience",
    description: "Keep tenant records, communication and lease journeys connected.",
    items: ["Profiles", "Communication", "Lease lifecycle"],
    className: "lg:col-span-1",
  },
  {
    eyebrow: "Grow",
    title: "Marketplace",
    description: "List opportunities, generate enquiries and connect with the wider property ecosystem.",
    items: ["Listings", "Leads", "Viewings"],
    className: "lg:col-span-2",
  },
];

const LIFECYCLE = [
  ["Vacant", "Availability and condition recorded on the unit."],
  ["Listed", "Published to the marketplace with photos and a price."],
  ["Viewing", "Enquiries become leads; viewings are booked and confirmed."],
  ["Let", "Lease signed, deposit and advance rent recorded."],
  ["Rent", "Charges, payments and receipts on one ledger."],
  ["Maintenance", "Requests, approvals and the provider who did the work."],
  ["Renewal", "Renew, or move out and return the unit to vacant."],
];

const AUDIENCES = [
  ["Property owners", "Operate properties and collections with a clearer view of performance.", "/for-property-owners"],
  ["Professionals", "Build visibility, manage listings and turn enquiries into active opportunities.", "/for-professionals"],
  ["Developers", "Showcase developments, manage inventory and coordinate sales activity.", "/for-developers"],
];

export default function Home() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: BRAND.name,
    description: "The operating system for African real estate",
    url: BRAND.siteUrl,
    logo: `${BRAND.siteUrl}${BRAND.logo.onLight}`,
  };

  return (
    <>
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        type="application/ld+json"
      />
      <SiteNav />

      <main>
        <HeroSection />

        <CompaniesCarouselSection />

        <section className="bg-white px-5 py-20 sm:px-8 sm:py-28" id="product">
          <div className="mx-auto max-w-[1400px]">
            <div className="grid gap-10 border-b border-hairline pb-12 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold-ink">One operating system</p>
                <h2 className="mt-4 max-w-xl text-3xl font-semibold leading-[1.08] tracking-[-0.025em] text-forest-deep sm:text-[40px]">
                  Workflows that follow the property, not the software.
                </h2>
              </div>
              <p className="max-w-2xl text-base leading-7 text-muted lg:justify-self-end lg:text-lg">
                A property starts as an asset, becomes occupied, generates rent, needs maintenance, creates documents
                and eventually returns to the market. NesAfric keeps that whole operating history connected.
              </p>
            </div>

            <div className="divide-y divide-hairline">
              {WORKFLOWS.map((workflow, index) => (
                <article className="grid gap-6 py-9 lg:grid-cols-[90px_0.8fr_1.2fr] lg:items-start" key={workflow.title}>
                  <span className="text-sm font-semibold tabular-nums text-gold-ink">0{index + 1}</span>
                  <div>
                    <h3 className="font-display text-2xl font-semibold tracking-[-0.015em] text-forest-deep">{workflow.title}</h3>
                    <p className="mt-1 text-sm text-muted">{workflow.eyebrow}</p>
                  </div>
                  <div className="lg:pl-10">
                    <p className="max-w-2xl text-sm leading-6 text-muted">{workflow.description}</p>
                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-forest">
                      {workflow.items.map((item) => <span key={item}>{item}</span>)}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#0b2522] px-5 py-20 text-white sm:px-8 sm:py-28">
          <div className="mx-auto max-w-[1400px]">
            <div className="grid gap-10 lg:grid-cols-[0.68fr_1.32fr] lg:items-end">
              <div>
                <h2 className="max-w-xl text-3xl font-semibold leading-[1.08] tracking-[-0.025em] sm:text-[40px]">
                  See the work, the money and the next action.
                </h2>
                <p className="mt-5 max-w-xl text-base leading-7 text-white/70">
                  The workspace is organised around the week&apos;s real work: who has paid, which leases are ending, what
                  is broken and who is coming to view. Every number opens the records behind it.
                </p>
              </div>
              <div className="flex justify-start lg:justify-end">
                <Link className="text-sm font-semibold text-gold-soft transition hover:text-white" href="/register">
                  Open your workspace <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>

            <div className="mt-12 overflow-hidden rounded-[var(--radius-panel)] border border-white/10 bg-[#0f1f1d]">
              <div className="grid min-h-[560px] lg:grid-cols-[210px_1fr]">
                <aside className="hidden border-r border-white/10 bg-[#0a1716] p-5 lg:block">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold-soft">NESAFRIC</p>
                  <p className="mt-2 text-sm font-semibold text-white">Property workspace</p>
                  <nav className="mt-8 space-y-1 text-sm">
                    {["Overview","Properties","Tenants","Leases","Payments","Maintenance","Inbox","Documents"].map((item, index) => (
                      <div className={`flex items-center gap-3 rounded-[8px] px-3 py-2.5 ${index === 0 ? "bg-white/10 text-white" : "text-white/48"}`} key={item}>
                        <span className={`h-1.5 w-1.5 rounded-full ${index === 0 ? "bg-gold" : "bg-white/20"}`} />
                        {item}
                      </div>
                    ))}
                  </nav>
                </aside>

                <div className="bg-[#f7f8f5] text-ink">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
                    <div>
                      <p className="text-xs text-slate-500">Portfolio / Accra operations</p>
                      <h3 className="mt-1 text-lg font-semibold text-slate-950">Monday operating view</h3>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="rounded-[7px] border border-slate-200 bg-white px-3 py-2 text-slate-600">September 2026</span>
                      <span className="rounded-[7px] bg-forest px-3 py-2 font-semibold text-white">Add property</span>
                    </div>
                  </div>

                  <div className="grid gap-6 p-5 sm:p-7">
                    <div className="grid gap-px overflow-hidden rounded-[12px] border border-slate-200 bg-slate-200 sm:grid-cols-4">
                      {[
                        ["24","Units"],
                        ["21","Occupied"],
                        ["GHS 68.4k","Collected this month"],
                        ["2","Open maintenance jobs"],
                      ].map(([value,label]) => (
                        <div className="bg-white p-5" key={label}>
                          <p className="text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
                          <p className="mt-1 text-xs text-slate-500">{label}</p>
                        </div>
                      ))}
                    </div>

                    <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
                      <div className="overflow-hidden rounded-[12px] border border-slate-200 bg-white">
                        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                          <div>
                            <p className="text-sm font-semibold text-slate-950">Properties</p>
                            <p className="mt-0.5 text-xs text-slate-500">Occupancy and rent position</p>
                          </div>
                          <Link className="text-xs font-semibold text-forest" href="/properties">View all</Link>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {[
                            ["Cantonments Court","Cantonments, Accra","8 / 8","GHS 31,200","Healthy"],
                            ["Ridge House","North Ridge, Accra","7 / 8","GHS 22,400","1 available"],
                            ["Airport Residence","Airport Residential","6 / 8","GHS 14,800","2 due soon"],
                          ].map(([name,location,occupancy,rent,status]) => (
                            <div className="grid gap-3 px-5 py-4 sm:grid-cols-[1.35fr_0.6fr_0.7fr_0.7fr] sm:items-center" key={name}>
                              <div><p className="text-sm font-semibold text-slate-900">{name}</p><p className="mt-1 text-xs text-slate-500">{location}</p></div>
                              <div><p className="text-[10px] uppercase tracking-wide text-slate-600">Occupied</p><p className="mt-1 text-sm font-medium">{occupancy}</p></div>
                              <div><p className="text-[10px] uppercase tracking-wide text-slate-600">Collected</p><p className="mt-1 text-sm font-medium">{rent}</p></div>
                              <div><span className="text-xs font-medium text-forest">{status}</span></div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-[12px] border border-slate-200 bg-white">
                        <div className="border-b border-slate-200 px-5 py-4">
                          <p className="text-sm font-semibold text-slate-950">Needs attention</p>
                          <p className="mt-0.5 text-xs text-slate-500">Items with a next action</p>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {[
                            ["Lease renewal","Unit B4 · Ridge House","Review by 25 Sep"],
                            ["Rent follow-up","Unit C2 · Airport Residence","GHS 2,400 overdue"],
                            ["Maintenance","Unit A7 · Cantonments Court","Plumber assigned"],
                            ["Viewing","Unit B8 · Ridge House","Tomorrow · 14:00"],
                          ].map(([title,detail,state]) => (
                            <div className="px-5 py-4" key={title}>
                              <div className="flex items-start justify-between gap-4">
                                <div><p className="text-sm font-medium text-slate-900">{title}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>
                                <span className="max-w-[110px] text-right text-[11px] font-medium text-forest">{state}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <p className="text-[11px] leading-5 text-slate-600">
                      Sample workspace data shown for product demonstration. The structure reflects NesAfric&apos;s property, lease, payment and maintenance workflows.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-warm-white px-5 py-16 sm:px-8 sm:py-24">
          <div className="mx-auto max-w-[1400px]">
            <div className="grid gap-6 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
              <h2 className="max-w-xl text-3xl font-semibold leading-[1.08] tracking-[-0.025em] text-forest-deep sm:text-[40px]">
                One record, from vacant to renewed.
              </h2>
              <p className="max-w-2xl text-base leading-7 text-muted lg:justify-self-end">
                A unit moves through the same stages again and again. NesAfric keeps each stage on the same record, so
                the viewing, the lease, every payment and every repair are there when the unit comes round again.
              </p>
            </div>

            {/* Lifecycle rail: the NesAfric signature for "where is this unit now". */}
            <ol aria-label="Property lifecycle" className="mt-12 grid border-t border-forest/25 sm:grid-cols-2 lg:grid-cols-7">
              {LIFECYCLE.map(([stage, detail], index) => (
                <li className="relative border-b border-hairline py-5 pr-5 lg:border-b-0 lg:border-l lg:py-0 lg:pl-5 lg:pt-6 lg:first:border-l-0 lg:first:pl-0" key={stage}>
                  <span aria-hidden="true" className="absolute -top-[5px] left-0 h-[9px] w-[9px] rounded-full border-2 border-warm-white bg-forest lg:left-5 lg:first:left-0" />
                  <span className="text-xs font-semibold tabular-nums text-gold-ink">0{index + 1}</span>
                  <p className="mt-2 font-display text-[15px] font-semibold text-forest-deep">{stage}</p>
                  <p className="mt-1 text-sm leading-6 text-muted">{detail}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="bg-white px-5 py-16 sm:px-8 sm:py-24">
          <div className="mx-auto max-w-[1400px]">
            <div className="flex flex-col justify-between gap-6 border-b border-hairline pb-10 lg:flex-row lg:items-end">
              <div>
                <h2 className="max-w-2xl text-3xl font-semibold leading-[1.08] tracking-[-0.025em] text-forest-deep sm:text-[40px]">
                  Different businesses. One property language.
                </h2>
              </div>
              <p className="max-w-xl text-base leading-7 text-muted">
                NesAfric adapts to the role you play without forcing every business into the same workflow.
              </p>
            </div>

            <div className="divide-y divide-hairline">
              {AUDIENCES.map(([title, description, href], index) => (
                <Link className="group grid gap-4 py-8 sm:grid-cols-[80px_0.8fr_1.2fr_40px] sm:items-center" href={href} key={title}>
                  <span className="text-xs font-semibold tabular-nums text-gold-ink">0{index + 1}</span>
                  <h3 className="font-display text-xl font-semibold text-forest-deep">{title}</h3>
                  <p className="max-w-2xl text-sm leading-6 text-muted">{description}</p>
                  <span className="text-xl text-forest transition group-hover:translate-x-1" aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-forest-deep px-5 py-16 text-white sm:px-8 sm:py-20">
          <div className="mx-auto flex max-w-[1400px] flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="max-w-3xl text-3xl font-semibold leading-[1.08] tracking-[-0.025em] sm:text-[40px]">
                Bring your properties onto one record.
              </h2>
              <p className="mt-4 max-w-2xl text-base leading-7 text-white/70">
                Start with one building or your whole portfolio. Add tenants, leases and rent as you go.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link className={buttonClass("primaryOnDark")} href="/register">
                Start with NesAfric
              </Link>
              <Link className={buttonClass("secondaryOnDark")} href="/marketplace/properties">
                Browse properties
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
