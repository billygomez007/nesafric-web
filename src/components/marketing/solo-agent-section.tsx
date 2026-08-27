const TOOLS = [
  { label: "Professional profile", detail: "Your public identity on the UmoAfric Marketplace." },
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
            <p className="text-xs font-semibold tracking-[0.22em] text-emerald-700">FOR THE INDIVIDUAL AGENT</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              Run like a team — even when it&apos;s just you.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-600">
              One professional, working alone, can operate with the same structure as a full sales team —
              a real profile, organised listings, a working pipeline, and AI alongside you to pick up the
              repetitive work. AI is leverage, not a replacement — you&apos;re still the one who closes.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
            <div className="rounded-xl bg-slate-50 p-5 sm:p-6">
              <p className="text-xs font-medium tracking-wide text-slate-500">YOUR WORKSPACE</p>
              <div className="mt-4 space-y-2.5">
                {TOOLS.map((tool) => (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3" key={tool.label}>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{tool.label}</p>
                      <p className="text-xs text-slate-500">{tool.detail}</p>
                    </div>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
