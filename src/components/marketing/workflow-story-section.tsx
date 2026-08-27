const STEPS = [
  { label: "You list a property", detail: "Publish a listing or development in minutes, under your professional profile." },
  { label: "A prospect discovers it", detail: "Found through the UmoAfric Marketplace — not a private, disconnected ad." },
  { label: "UmoAfric captures the enquiry", detail: "Every enquiry lands in one pipeline — nothing lost in a WhatsApp thread." },
  { label: "AI + platform help handle the questions", detail: "Routine listing and availability questions get answered immediately." },
  { label: "The lead enters your pipeline", detail: "Qualified, organised, and ready for you to work — not buried in your inbox." },
  { label: "A viewing is coordinated", detail: "Scheduling handled without the back-and-forth." },
  { label: "You step in", detail: "The moment that actually needs you — face to face, at the property." },
  { label: "You view, negotiate, close", detail: "You close the deal. UmoAfric already did the work around it." },
];

export function WorkflowStorySection() {
  return (
    <section className="bg-slate-950 py-24 sm:py-32">
      <div className="mx-auto max-w-5xl px-6 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.22em] text-emerald-300">FROM LISTING TO CLOSED DEAL</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Stop spending your day on administrative follow-up.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-400">
            UmoAfric handles the work around the opportunity, so you can concentrate on the moments where you
            actually create value — the viewing, the negotiation, the close.
          </p>
        </div>

        <ol className="relative mt-16 border-l border-white/10 pl-8 sm:pl-10">
          {STEPS.map((step, index) => (
            <li className="relative pb-10 last:pb-0" key={step.label}>
              <span className="absolute -left-[2.55rem] flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-slate-950 text-xs font-semibold text-emerald-300 sm:-left-[3.05rem]">
                {index + 1}
              </span>
              <p className="text-lg font-semibold text-white">{step.label}</p>
              <p className="mt-1.5 max-w-xl text-sm leading-6 text-slate-400">{step.detail}</p>
            </li>
          ))}
        </ol>

        <div className="mt-4 flex items-center gap-3 border-t border-white/10 pt-8">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <p className="text-sm font-medium text-slate-300">
            You handle the deal. <span className="text-white">UmoAfric handles the work around it.</span>
          </p>
        </div>
      </div>
    </section>
  );
}
