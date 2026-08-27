const CAPABILITIES = [
  "Publish listings and developments under a verified professional or company profile",
  "Reach buyers and renters searching the open marketplace",
  "Receive enquiries and manage leads in one pipeline",
  "Schedule and track viewings",
  "Review applications and qualify buyers or tenants",
  "Convert an enquiry into a signed lease — without leaving UmoAfric",
];

export function MarketplaceSection() {
  return (
    <section className="bg-slate-50 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="grid gap-14 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 lg:order-2">
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="flex h-36 items-center justify-center bg-slate-950">
                <p className="text-xs font-medium tracking-wide text-slate-500">Listing photo</p>
              </div>
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-950">Bright one-bedroom apartment, Osu</p>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Published</span>
                </div>
                <p className="mt-1 text-sm text-slate-500">GHS 2,200 / month · Accra</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                  Listed by Accra Realty Partners
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Verified</span>
                </p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">New enquiry received</p>
                <p className="text-xs text-slate-500">Viewing requested for next week</p>
              </div>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">Lead</span>
            </div>
          </div>

          <div className="lg:order-1">
            <p className="text-xs font-semibold tracking-[0.22em] text-emerald-700">UMOAFRIC MARKETPLACE</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              Every serious source of real estate, in one place.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-600">
              Owners, developers, agents, brokers, brokerages and real estate companies all publish through the
              same marketplace — each with a professional profile buyers and renters can verify.
            </p>
            <ul className="mt-8 space-y-3.5">
              {CAPABILITIES.map((capability) => (
                <li className="flex items-start gap-3 text-sm leading-6 text-slate-700" key={capability}>
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  {capability}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
