import Link from "next/link";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { HeroSection } from "@/components/marketing/hero-section";
import { CompanyLogoMarquee } from "@/components/marketing/company-logo-marquee";
import { BRAND } from "@/platform/brand";

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

        <CompanyLogoMarquee />

        <section className="bg-white px-5 py-20 sm:px-8 sm:py-28" id="product">
          <div className="mx-auto max-w-[1400px]">
            <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold">ONE OPERATING SYSTEM</p>
                <h2 className="mt-5 max-w-xl text-4xl font-semibold leading-[1.02] tracking-[-0.035em] text-forest-deep sm:text-5xl">
                  The business of property, finally connected.
                </h2>
              </div>
              <p className="max-w-2xl text-base leading-7 text-muted lg:justify-self-end lg:text-lg">
                NesAfric brings the operational, financial and marketplace sides of real estate into one platform,
                so teams can move from fragmented tools to a single source of truth.
              </p>
            </div>

            <div className="mt-12 grid auto-rows-[minmax(210px,auto)] gap-4 lg:grid-cols-4">
              {WORKFLOWS.map((workflow) => (
                <article
                  className={`group relative overflow-hidden rounded-[28px] border border-hairline bg-warm-white p-6 transition duration-300 hover:-translate-y-1 hover:border-gold/40 hover:shadow-[0_24px_60px_rgba(8,64,58,0.08)] ${workflow.className}`}
                  key={workflow.title}
                >
                  <div className="absolute right-5 top-5 h-12 w-12 rounded-full border border-gold/20 bg-white/70 transition group-hover:scale-110" />
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">{workflow.eyebrow}</p>
                  <h3 className="mt-4 max-w-md text-2xl font-semibold tracking-tight text-forest-deep">
                    {workflow.title}
                  </h3>
                  <p className="mt-3 max-w-lg text-sm leading-6 text-muted">{workflow.description}</p>
                  <div className="mt-8 flex flex-wrap gap-2">
                    {workflow.items.map((item) => (
                      <span className="rounded-full border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-forest" key={item}>
                        {item}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden bg-forest-deep px-5 py-20 text-white sm:px-8 sm:py-28">
          <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full border border-gold/10" />
          <div className="absolute -right-6 top-14 h-48 w-48 rounded-full border border-gold/10" />

          <div className="mx-auto grid max-w-[1400px] gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold-soft">NESAFRIC WORKSPACE</p>
              <h2 className="mt-5 max-w-xl text-4xl font-semibold leading-[1.03] tracking-[-0.035em] sm:text-5xl">
                A real operating view, not another marketing graphic.
              </h2>
              <p className="mt-6 max-w-xl text-base leading-7 text-white/68">
                See property performance, occupancy, collections and operational work in one clear workspace.
                The interface below is an illustrative NesAfric product view.
              </p>
              <Link className="mt-8 inline-flex items-center text-sm font-semibold text-gold-soft" href="/register">
                Open your workspace <span className="ml-2" aria-hidden="true">→</span>
              </Link>
            </div>

            <div className="relative rounded-[30px] border border-white/10 bg-[#0b1918] p-3 shadow-[0_35px_100px_rgba(0,0,0,0.35)] sm:p-5">
              <div className="rounded-[24px] border border-white/10 bg-[#102321] p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold-soft">Illustrative workspace</p>
                    <h3 className="mt-2 text-xl font-semibold">Portfolio overview</h3>
                  </div>
                  <span className="rounded-full border border-emerald/30 bg-emerald/10 px-3 py-1.5 text-xs font-medium text-emerald-200">
                    Operations connected
                  </span>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {[
                    ["24", "Total units", "Across active properties"],
                    ["21", "Occupied", "Healthy occupancy"],
                    ["3", "Available", "Ready for leasing"],
                  ].map(([value, label, detail]) => (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" key={label}>
                      <p className="text-3xl font-semibold tracking-tight">{value}</p>
                      <p className="mt-2 text-sm font-semibold">{label}</p>
                      <p className="mt-1 text-xs text-white/45">{detail}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold">Rent collection</p>
                        <p className="mt-1 text-xs text-white/45">Current month progress</p>
                      </div>
                      <p className="text-2xl font-semibold text-gold-soft">92%</p>
                    </div>
                    <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full w-[92%] rounded-full bg-gold" />
                    </div>
                    <div className="mt-5 grid grid-cols-3 gap-3 text-xs">
                      <div><p className="text-white/40">Collected</p><p className="mt-1 font-semibold">On track</p></div>
                      <div><p className="text-white/40">Due soon</p><p className="mt-1 font-semibold">3 tenants</p></div>
                      <div><p className="text-white/40">Overdue</p><p className="mt-1 font-semibold">Needs action</p></div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                    <p className="text-sm font-semibold">Operational queue</p>
                    <div className="mt-4 space-y-3">
                      {[
                        ["Lease renewal", "Review"],
                        ["Maintenance request", "Assigned"],
                        ["New enquiry", "Respond"],
                      ].map(([label, state]) => (
                        <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-black/10 px-3 py-3" key={label}>
                          <span className="text-xs text-white/72">{label}</span>
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-gold-soft">{state}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-warm-white px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-[1400px]">
            <div className="max-w-3xl">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold">BUILT AROUND REAL WORK</p>
              <h2 className="mt-5 text-4xl font-semibold leading-[1.04] tracking-[-0.035em] text-forest-deep sm:text-5xl">
                Built around how African real estate actually works.
              </h2>
              <p className="mt-6 max-w-2xl text-base leading-7 text-muted">
                Local operations, property records, payments, tenant communication, service professionals and marketplace discovery — connected in one system that can grow with your business.
              </p>
            </div>

            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {["Property records", "Rent & payments", "Tenant communication", "Service professionals", "Marketplace discovery"].map((item, index) => (
                <div className="rounded-2xl border border-hairline bg-white p-5" key={item}>
                  <span className="text-xs font-semibold text-gold">0{index + 1}</span>
                  <p className="mt-7 text-sm font-semibold leading-6 text-forest-deep">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-[1400px]">
            <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold">BUILT FOR THE ECOSYSTEM</p>
                <h2 className="mt-5 max-w-2xl text-4xl font-semibold leading-[1.04] tracking-[-0.035em] text-forest-deep sm:text-5xl">
                  One platform. Different roles. Shared momentum.
                </h2>
              </div>
              <p className="max-w-xl text-base leading-7 text-muted">
                Start from the part of the property ecosystem you operate in today and expand as your needs grow.
              </p>
            </div>

            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              {AUDIENCES.map(([title, description, href], index) => (
                <Link
                  className="group rounded-[26px] border border-hairline bg-warm-white p-7 transition hover:-translate-y-1 hover:border-gold/40 hover:shadow-[0_22px_60px_rgba(8,64,58,0.08)]"
                  href={href}
                  key={title}
                >
                  <div className="flex items-start justify-between gap-6">
                    <span className="text-xs font-semibold text-gold">0{index + 1}</span>
                    <span className="text-2xl text-forest transition group-hover:translate-x-1" aria-hidden="true">→</span>
                  </div>
                  <h3 className="mt-12 text-2xl font-semibold text-forest-deep">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted">{description}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-forest-deep px-5 py-20 text-white sm:px-8 sm:py-24">
          <div className="mx-auto flex max-w-[1400px] flex-col gap-8 rounded-[30px] border border-white/10 bg-white/[0.04] p-8 sm:p-12 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold-soft">READY WHEN YOU ARE</p>
              <h2 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.02] tracking-[-0.035em] sm:text-5xl">
                Put your property business on one operating system.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-7 text-white/65">
                Bring your properties, people, payments and opportunities into a clearer way of working.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link className="rounded-xl bg-gold px-6 py-3.5 text-sm font-semibold text-forest-deep transition hover:bg-gold-soft" href="/register">
                Get started →
              </Link>
              <Link className="rounded-xl border border-white/20 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10" href="/marketplace/properties">
                Explore properties
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
