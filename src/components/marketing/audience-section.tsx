import Link from "next/link";

const PATHWAYS = [
  {
    id: "manage",
    kicker: "MANAGE REAL ESTATE",
    heading: "Operate the entire portfolio.",
    forLabel: "For",
    forWho: "Property Owners · Landlords · Property Managers · Property Developers",
    description:
      "Run portfolio operations end to end: tenants, leases, rent, maintenance, teams, AI employees and operational intelligence — always current, always organisation-scoped.",
    cta: { label: "Manage Properties", href: "/register" },
  },
  {
    id: "market",
    kicker: "MARKET REAL ESTATE",
    heading: "Market listings and grow the business.",
    forLabel: "For",
    forWho: "Real Estate Agents · Brokers · Brokerages · Real Estate Companies · Property Developers",
    description:
      "Build a professional profile, publish listings and developments, manage inventory, leads, viewings and CRM, and reach buyers and renters through the Umo Afric Marketplace — with AI sales support.",
    cta: { label: "Market Properties", href: "/register" },
  },
];

export function AudienceSection() {
  return (
    <section className="bg-white py-24 sm:py-32" id="solutions">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.22em] text-emerald-700">BUILT FOR THE ENTIRE REAL ESTATE ECOSYSTEM</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Two connected ways to run a real estate business.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600">
            Whichever side of real estate you&apos;re on, Umo Afric runs the operation — and connects it to
            everyone else on the platform.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-2">
          {PATHWAYS.map((pathway) => (
            <div className="scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10" id={pathway.id} key={pathway.id}>
              <p className="text-xs font-semibold tracking-[0.22em] text-emerald-700">{pathway.kicker}</p>
              <h3 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{pathway.heading}</h3>
              <p className="mt-4 text-xs font-medium tracking-[0.08em] text-slate-500">
                {pathway.forLabel.toUpperCase()} {pathway.forWho}
              </p>
              <p className="mt-4 text-sm leading-6 text-slate-600">{pathway.description}</p>
              <Link
                className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 transition-colors hover:text-emerald-800"
                href={pathway.cta.href}
              >
                {pathway.cta.label} →
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-10 max-w-3xl text-sm leading-6 text-slate-500">
          Property developers often belong to both sides — operating delivered units on Umo Afric while marketing
          new developments through the Marketplace, from one account.
        </p>
      </div>
    </section>
  );
}
