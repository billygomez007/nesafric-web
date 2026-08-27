const CLUSTERS = [
  { title: "Portfolio", items: ["Properties and units", "Portfolios across owners and assets"] },
  { title: "People", items: ["Tenants", "Leases, from draft to signed"] },
  { title: "Money", items: ["Rent schedules and collection", "Payments, receipts and reconciliation"] },
  { title: "Maintenance", items: ["Requests and work orders", "A verified provider network"] },
  { title: "Documents", items: ["Centralised, access-controlled document storage"] },
  { title: "Team & intelligence", items: ["Teams with role-based access", "AI employees", "Operational intelligence across the portfolio"] },
];

export function PropertyOwnersCapabilitiesSection() {
  return (
    <section className="bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.22em] text-navy">THE OPERATING PLATFORM</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Everything the property operation needs, connected.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600">
            Not a collection of disconnected tools stitched together after the fact — one system that runs the
            entire operation on the same data.
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
