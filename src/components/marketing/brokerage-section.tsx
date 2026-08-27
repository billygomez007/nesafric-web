const CLUSTERS = [
  {
    title: "Company presence",
    items: ["A verified company profile", "Professional verification readiness"],
  },
  {
    title: "Team & representatives",
    items: ["Multiple team members", "Individual representative attribution on every listing and lead"],
  },
  {
    title: "Inventory at scale",
    items: ["Listings across your entire portfolio", "Developments and unit-level inventory"],
  },
  {
    title: "Pipeline",
    items: ["A shared lead pipeline", "Coordinated viewing scheduling across your team"],
  },
  {
    title: "Promotions",
    items: ["Priority placement for key inventory in marketplace search"],
  },
  {
    title: "AI at scale",
    items: ["AI sales capabilities available across the whole team"],
  },
];

export function BrokerageSection() {
  return (
    <section className="bg-slate-50 py-24 sm:py-32" id="brokerage">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.22em] text-navy">FOR BROKERAGES &amp; REAL ESTATE COMPANIES</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Built for one agent. Powerful enough for an entire brokerage.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600">
            The same platform an individual agent starts on scales to a full company — a shared company
            presence, a coordinated team, real inventory at scale, and one pipeline everyone works from.
          </p>
        </div>

        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">
          {CLUSTERS.map((cluster) => (
            <div className="bg-white p-7" key={cluster.title}>
              <p className="text-sm font-semibold text-slate-950">{cluster.title}</p>
              <ul className="mt-3 space-y-2">
                {cluster.items.map((item) => (
                  <li className="flex items-start gap-2.5 text-sm leading-6 text-slate-600" key={item}>
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
