const STAGES = [
  "List",
  "Lead",
  "Viewing",
  "Application",
  "Tenant",
  "Lease",
  "Payment",
  "Maintenance",
  "Renewal / Move-out",
  "Turnover",
  "Re-list",
];

export function LifecycleSection() {
  return (
    <section className="scroll-mt-16 bg-slate-950 py-24 sm:py-32" id="lifecycle">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.22em] text-emerald-300">FULL PROPERTY LIFECYCLE</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            From first listing to every renewal — one continuous system.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-400">
            UmoAfric doesn&apos;t hand off between tools at each stage. The same platform carries a unit through
            its entire life, and back around again.
          </p>
        </div>

        <div className="mt-14 flex flex-wrap items-center gap-x-2 gap-y-4">
          {STAGES.map((stage, index) => (
            <div className="flex items-center gap-2" key={stage}>
              <span className="rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-200">
                {stage}
              </span>
              {index < STAGES.length - 1 && (
                <span aria-hidden="true" className="text-slate-600">→</span>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2 pl-1 text-emerald-300">
            <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} viewBox="0 0 24 24">
              <path d="M4 4v5h5" />
              <path d="M4.5 9A8 8 0 1 0 6 4.5" />
            </svg>
            <span className="text-xs font-medium tracking-wide">back to List</span>
          </div>
        </div>
      </div>
    </section>
  );
}
