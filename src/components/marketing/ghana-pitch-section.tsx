import Link from "next/link";

const PATHS = [
  {
    href: "/for-professionals",
    label: "Professionals",
    description: "Agents, brokers, brokerages and real-estate companies — market listings and run your sales operation.",
  },
  {
    href: "/for-developers",
    label: "Developers",
    description: "Showcase developments, manage unit inventory, and sell — with property management available if you need it.",
  },
  {
    href: "/for-property-owners",
    label: "Property owners",
    description: "Landlords, property managers and developers — run the entire property operation from one platform.",
  },
];

export function GhanaPitchSection() {
  return (
    <section className="bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
          <h2 className="text-3xl font-semibold tracking-[-0.02em] text-forest-deep sm:text-[40px] sm:leading-[1.1]">
            Three ways into NesAfric.
          </h2>
          <p className="max-w-2xl text-base leading-7 text-slate-600 lg:justify-self-end">
            A professional presence, listings, leads, viewings, a team and AI assistance for people who sell and let
            property — and full property operations for people who own and manage it.
          </p>
        </div>
        <div className="mt-10 divide-y divide-hairline border-y border-hairline">
          {PATHS.map((path, index) => (
            <Link
              className="group grid gap-2 py-6 sm:grid-cols-[56px_minmax(0,0.8fr)_minmax(0,1.3fr)_auto] sm:items-center sm:gap-6"
              href={path.href}
              key={path.href}
            >
              <span className="text-sm font-semibold tabular-nums text-gold-ink">0{index + 1}</span>
              <p className="font-display text-xl font-semibold text-forest-deep">{path.label}</p>
              <p className="text-sm leading-6 text-slate-600">{path.description}</p>
              <span className="text-sm font-semibold text-forest group-hover:underline">
                Learn more <span aria-hidden="true">→</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
