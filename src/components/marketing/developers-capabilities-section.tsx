const TRACKS = [
  {
    kicker: "MARKET & SELL",
    title: "Bring your development to market.",
    items: [
      "A development profile and project showcase",
      "Unit-level inventory and live availability",
      "Public listings on the UmoAfric Marketplace",
      "Leads and viewings coordinated in one pipeline",
      "A sales team working from a shared pipeline",
      "AI sales support for enquiries and inventory matching",
    ],
  },
  {
    kicker: "OPTIONAL",
    title: "Operate delivered units — if you need to.",
    items: [
      "Property and unit management for completed phases",
      "Tenants, leases and rent collection",
      "Maintenance and provider coordination",
      "AI employees across operations",
    ],
  },
];

export function DevelopersCapabilitiesSection() {
  return (
    <section className="bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.22em] text-emerald-700">TWO SIDES, ONE ACCOUNT</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Sell a development. Manage a portfolio. Use either — or both.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600">
            Marketing and selling a development doesn&apos;t require adopting property management, and
            managing a portfolio doesn&apos;t require marketing through the public marketplace. A developer
            can use the sales side on its own, and add operations later from the same account.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-2">
          {TRACKS.map((track) => (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm" key={track.title}>
              <p className="text-xs font-semibold tracking-[0.18em] text-emerald-700">{track.kicker}</p>
              <h3 className="mt-3 text-xl font-semibold text-slate-950">{track.title}</h3>
              <ul className="mt-5 space-y-3">
                {track.items.map((item) => (
                  <li className="flex items-start gap-3 text-sm leading-6 text-slate-600" key={item}>
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
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
