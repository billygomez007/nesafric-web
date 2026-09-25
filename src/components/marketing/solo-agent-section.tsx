const TOOLS = [
  { label: "Professional profile", detail: "Your public identity on the NesAfric Marketplace." },
  { label: "Property listings", detail: "Publish and manage your own inventory." },
  { label: "Lead inbox", detail: "Every enquiry, in one place — nothing lost." },
  { label: "Viewing management", detail: "Schedule and track viewings without the back-and-forth." },
  { label: "CRM", detail: "Your pipeline, organised from first enquiry to close." },
  { label: "Development inventory", detail: "Where applicable — track units and availability." },
  { label: "AI assistance", detail: "Handles the repetitive work around your business." },
];

export function SoloAgentSection() {
  return (
    <section className="bg-white py-24 sm:py-32" id="solo-agent">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="grid gap-14 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <p className="text-sm font-medium text-gold-ink">For the independent agent</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-forest-deep sm:text-[40px] sm:leading-[1.1]">
              Working on your own, with the structure of a team.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-600">
              One professional, working alone, can operate with the same structure as a full sales team —
              a real profile, organised listings, a working pipeline, and AI alongside you to pick up the
              repetitive work. AI is leverage, not a replacement — you&apos;re still the one who closes.
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold text-forest-deep">In your workspace</p>
            <dl className="mt-3 divide-y divide-hairline border-y border-hairline">
              {TOOLS.map((tool) => (
                <div className="grid gap-1 py-3.5 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] sm:gap-6" key={tool.label}>
                  <dt className="text-sm font-semibold text-forest-deep">{tool.label}</dt>
                  <dd className="text-sm leading-6 text-slate-600">{tool.detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
