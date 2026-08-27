import Link from "next/link";

const PATHS = [
  {
    href: "/for-professionals",
    label: "For Professionals",
    description: "Agents, brokers, brokerages and real-estate companies — market listings and run your sales operation.",
  },
  {
    href: "/for-developers",
    label: "For Developers",
    description: "Showcase developments, manage unit inventory, and sell — with property management available if you need it.",
  },
  {
    href: "/for-property-owners",
    label: "For Property Owners",
    description: "Landlords, property managers and developers — run the entire property operation from one platform.",
  },
];

export function GhanaPitchSection() {
  return (
    <section className="bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-5xl px-6 text-center sm:px-8">
        <p className="text-xs font-semibold tracking-[0.22em] text-emerald-700">THE IDEA</p>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          You handle the deal.
          <br />
          Umo Afric handles the work around it.
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-600">
          Umo Afric gives real-estate professionals an intelligent operating platform around their business —
          a professional presence, listings, leads, viewings, a team, and AI working alongside you.
        </p>
      </div>

      <div className="mx-auto mt-16 grid max-w-5xl gap-6 px-6 sm:grid-cols-3 sm:px-8">
        {PATHS.map((path) => (
          <Link
            className="group rounded-2xl border border-slate-200 bg-white p-7 text-left transition hover:border-slate-950"
            href={path.href}
            key={path.href}
          >
            <p className="font-semibold text-slate-950">{path.label}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">{path.description}</p>
            <span className="mt-4 inline-flex items-center text-sm font-semibold text-emerald-700 transition-colors group-hover:text-emerald-800">
              Learn more →
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
