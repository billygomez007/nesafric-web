const AI_ROLES = [
  {
    title: "AI receptionist",
    description: "Answers routine questions about your listings and availability as enquiries arrive — day or night — and hands anything unusual to a person.",
  },
  {
    title: "AI sales assistant",
    description: "Follows up on leads, matches enquiries to available units and keeps viewings moving so no enquiry sits untouched.",
  },
  {
    title: "AI property manager",
    description: "Watches rent, leases and vacancies across the portfolio and raises the exceptions that need a decision.",
  },
  {
    title: "AI maintenance coordinator",
    description: "Turns a reported problem into a request, gathers the details and helps dispatch the right provider.",
  },
];

/**
 * AI employees are real NesAfric features (plan-dependent). Presented as numbered editorial rows
 * with the operating principle stated plainly — AI works inside your permissions and approvals.
 */
export function AICapabilitiesSection({
  kicker = "AI inside your workspace",
  heading = "AI assistants that work inside your rules.",
  intro = "AI employees work inside your NesAfric workspace — available according to your plan — to take on the repetitive work around the business, not the judgement calls that need you.",
}: {
  kicker?: string;
  heading?: string;
  intro?: string;
}) {
  return (
    <section className="bg-forest-deep py-16 text-white sm:py-24">
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
          <div>
            <p className="text-sm font-medium text-gold-soft">{kicker}</p>
            <h2 className="mt-3 max-w-xl text-3xl font-semibold leading-[1.08] tracking-[-0.025em] sm:text-[40px]">{heading}</h2>
          </div>
          <p className="max-w-2xl text-base leading-7 text-white/70 lg:justify-self-end">{intro}</p>
        </div>

        <ol className="mt-12 divide-y divide-white/10 border-y border-white/10">
          {AI_ROLES.map((role, index) => (
            <li className="grid gap-2 py-6 sm:grid-cols-[56px_minmax(0,0.8fr)_minmax(0,1.4fr)] sm:gap-6" key={role.title}>
              <span className="text-sm font-semibold tabular-nums text-gold-soft">0{index + 1}</span>
              <h3 className="font-display text-lg font-semibold">{role.title}</h3>
              <p className="text-sm leading-6 text-white/70">{role.description}</p>
            </li>
          ))}
          <li className="grid gap-2 py-6 sm:grid-cols-[56px_minmax(0,0.8fr)_minmax(0,1.4fr)] sm:gap-6">
            <span aria-hidden="true" className="text-sm text-white/40">—</span>
            <h3 className="font-display text-lg font-semibold text-white/80">AI voice receptionist</h3>
            <p className="text-sm leading-6 text-white/60">
              Live telephone answering by AI. <span className="font-semibold text-gold-soft">Not available yet.</span>
            </p>
          </li>
        </ol>

        <p className="mt-8 max-w-2xl text-sm leading-6 text-white/60">
          AI works within your team&apos;s permissions and your approval workflow. It takes on repetitive work around
          the business — it doesn&apos;t replace the professional who closes the deal.
        </p>
      </div>
    </section>
  );
}
