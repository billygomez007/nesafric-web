const SOURCES = ["Agents", "Brokers", "Brokerages", "Real estate companies", "Developers", "Owners, where applicable"];

export function GhanaMarketplaceSection() {
  return (
    <section className="bg-slate-50 py-24 sm:py-32">
      <div className="mx-auto max-w-5xl px-6 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.22em] text-emerald-700">UMOAFRIC MARKETPLACE</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Not a wall of anonymous ads — a professional marketplace.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600">
            Every listing on UmoAfric is published under a professional profile, not posted anonymously.
            Buyers and renters can see who they&apos;re dealing with — and whether that professional&apos;s
            identity has been verified.
          </p>
        </div>

        <div className="mt-12 flex flex-wrap gap-3">
          {SOURCES.map((source) => (
            <span
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700"
              key={source}
            >
              {source}
            </span>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-950">Accra Realty Partners</p>
              <p className="mt-1 text-sm text-slate-500">Brokerage · 14 active listings</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              Verification readiness shown on profile
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
