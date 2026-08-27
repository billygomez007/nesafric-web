import Link from "next/link";

const METRICS = [
  { label: "Rent collected", value: "GHS 184,000", tone: "text-white" },
  { label: "Occupancy", value: "94%", tone: "text-white" },
  { label: "Outstanding", value: "GHS 12,400", tone: "text-amber-300" },
];

const QUEUE = [
  { title: "Lease renewal — Unit A2", meta: "Expires in 18 days", tag: "Lease" },
  { title: "Work order assigned — plumbing", meta: "Osu Apartments, Unit A1", tag: "Maintenance" },
  { title: "New enquiry — 2-bed listing", meta: "Routed to AI Receptionist", tag: "AI" },
];

export function HeroSection() {
  return (
    <section className="marketing-grid relative overflow-hidden bg-slate-950 pt-20 pb-24 sm:pt-28 sm:pb-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-12rem] h-[36rem] w-[64rem] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl"
      />
      <div className="relative mx-auto grid max-w-7xl gap-16 px-6 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-12">
        <div className="marketing-fade-up">
          <p className="text-xs font-semibold tracking-[0.22em] text-emerald-300">UMOAFRIC · REAL ESTATE OPERATING &amp; MARKETPLACE PLATFORM</p>
          <h1 className="mt-6 text-5xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl">
            One intelligent platform for real estate.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
            Manage properties. Market listings. Run developments. Serve tenants. Convert leads. Coordinate
            operations — with AI built into the platform.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              className="rounded-full bg-emerald-400 px-6 py-3.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-300"
              href="/register"
            >
              Manage Properties
            </Link>
            <Link
              className="rounded-full border border-white/20 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:border-white/40"
              href="/register"
            >
              Market Properties
            </Link>
            <Link
              className="text-sm font-semibold text-slate-300 transition-colors hover:text-white"
              href="/marketplace/properties"
            >
              Explore Marketplace →
            </Link>
          </div>
          <p className="mt-8 text-xs font-medium tracking-[0.14em] text-slate-500">
            FOR OWNERS · MANAGERS · AGENTS · BROKERS · DEVELOPERS
          </p>
        </div>

        <div className="marketing-fade-up [animation-delay:120ms]" aria-hidden="true">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-2 shadow-[0_40px_80px_-32px_rgba(0,0,0,0.6)] backdrop-blur">
            <div className="flex items-center gap-1.5 px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
              <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
              <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
              <span className="ml-3 text-[11px] font-medium text-slate-500">UmoAfric — Portfolio</span>
            </div>
            <div className="rounded-xl bg-slate-950/80 p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium tracking-wide text-slate-500">SAMPLE PORTFOLIO VIEW</p>
                <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">
                  LIVE
                </span>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3">
                {METRICS.map((metric) => (
                  <div className="rounded-lg border border-white/5 bg-white/[0.03] p-3.5" key={metric.label}>
                    <p className="text-[11px] text-slate-500">{metric.label}</p>
                    <p className={`mt-1.5 text-base font-semibold ${metric.tone}`}>{metric.value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 space-y-2">
                {QUEUE.map((item) => (
                  <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3.5 py-3" key={item.title}>
                    <div>
                      <p className="text-[13px] font-medium text-slate-200">{item.title}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">{item.meta}</p>
                    </div>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                      {item.tag}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-[11px] text-slate-600">Illustrative product composition, not real customer data.</p>
        </div>
      </div>
    </section>
  );
}
