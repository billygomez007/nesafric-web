const STATS = [
  { label: "Occupancy", value: "94%" },
  { label: "Rent expected", value: "GHS 196,400" },
  { label: "Rent collected", value: "GHS 184,000" },
  { label: "Outstanding", value: "GHS 12,400" },
];

const EXPIRIES = [
  { unit: "Ocean View — Unit A2", when: "18 days" },
  { unit: "Kumasi Garden — Unit K1", when: "34 days" },
  { unit: "Ridge Court — Unit 4B", when: "51 days" },
];

const ALERTS = [
  { text: "Payment overdue — Unit A2, 14 days", severity: "high" },
  { text: "Maintenance escalation — Unit C1", severity: "medium" },
  { text: "Move-out inspection pending — Unit D3", severity: "low" },
];

const SEVERITY_STYLES: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-slate-400",
};

export function PortfolioSection() {
  return (
    <section className="bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.22em] text-emerald-700">PORTFOLIO CONTROL</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            See your entire portfolio, in one view.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600">
            Performance, occupancy, collections and operations — always current, always organisation-scoped.
          </p>
        </div>

        <div className="mt-14 overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-950 px-6 py-3.5">
            <p className="text-xs font-medium tracking-wide text-slate-400">SAMPLE PORTFOLIO VIEW</p>
            <p className="text-xs font-medium text-slate-500">Illustrative data</p>
          </div>
          <div className="bg-slate-50 p-6 sm:p-8">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {STATS.map((stat) => (
                <div className="rounded-xl border border-slate-200 bg-white p-5" key={stat.label}>
                  <p className="text-xs text-slate-500">{stat.label}</p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">{stat.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="text-sm font-semibold text-slate-950">Lease expiries</p>
                <div className="mt-4 space-y-3">
                  {EXPIRIES.map((expiry) => (
                    <div className="flex items-center justify-between text-sm" key={expiry.unit}>
                      <span className="text-slate-700">{expiry.unit}</span>
                      <span className="font-medium text-slate-500">{expiry.when}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="text-sm font-semibold text-slate-950">Operational alerts</p>
                <div className="mt-4 space-y-3">
                  {ALERTS.map((alert) => (
                    <div className="flex items-center gap-2.5 text-sm" key={alert.text}>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_STYLES[alert.severity]}`} />
                      <span className="text-slate-700">{alert.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
