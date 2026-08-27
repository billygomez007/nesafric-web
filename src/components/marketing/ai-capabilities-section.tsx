import { ProductMockup } from "@/components/marketing/product-mockup";

const AI_ROLES = [
  {
    title: "AI Receptionist",
    description: "Handles digital enquiries, understands your listings and inventory, and answers routine questions immediately — day or night.",
  },
  {
    title: "AI Sales Agent",
    description: "Assists with leads, listing enquiries, inventory matching and viewing workflows, so nothing sits untouched.",
  },
  {
    title: "AI Property Manager",
    description: "Assists day-to-day property operations — rent, leases, vacancies and exceptions, kept visible across the portfolio.",
  },
  {
    title: "AI Maintenance Coordinator",
    description: "Supports maintenance workflows and provider dispatch, from report to resolution.",
  },
];

export function AICapabilitiesSection({
  kicker = "AI, BUILT IN",
  heading = "Your real-estate business. Now with AI built in.",
  intro = "AI employees work inside your UmoAfric workspace — available according to your plan — to take on the repetitive work around the business, not the judgment calls that need you.",
  mockup,
}: {
  kicker?: string;
  heading?: string;
  intro?: string;
  mockup?: { src: string; alt: string };
}) {
  return (
    <section className="bg-slate-950 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.22em] text-emerald-300">{kicker}</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{heading}</h2>
          <p className="mt-4 text-base leading-7 text-slate-400">{intro}</p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {AI_ROLES.map((role) => (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6" key={role.title}>
              <p className="text-sm font-semibold text-white">{role.title}</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">{role.description}</p>
            </div>
          ))}
        </div>

        {mockup && (
          <div className="mt-14">
            <ProductMockup alt={mockup.alt} src={mockup.src} />
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-5">
          <div>
            <p className="text-sm font-semibold text-white">AI Voice Receptionist</p>
            <p className="mt-1 text-sm leading-6 text-slate-400">Live telephone answering by AI — not yet available on the platform.</p>
          </div>
          <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold tracking-wide text-amber-300">
            COMING SOON
          </span>
        </div>

        <p className="mt-8 max-w-2xl text-sm leading-6 text-slate-500">
          AI works inside your workspace, within your permissions and your approval workflow. It takes on
          repetitive work around the business — it doesn&apos;t replace the professional who closes the deal.
        </p>
      </div>
    </section>
  );
}
