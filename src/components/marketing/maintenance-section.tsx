const STEPS = [
  "Tenant reports issue",
  "PropertyOS tracks it",
  "Manager reviews",
  "Artisan assigned",
  "Quotation / work order",
  "Repair completed",
  "History preserved",
];

export function MaintenanceSection() {
  return (
    <section className="bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.22em] text-emerald-700">MAINTENANCE &amp; SERVICE PROVIDERS</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Every repair, tracked from report to resolution.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600">
            A verified artisan and service-provider network, connected directly to the maintenance workflow.
          </p>
        </div>

        <div className="mt-14 flex flex-col gap-0 rounded-2xl border border-slate-200 lg:flex-row">
          {STEPS.map((step, index) => (
            <div
              className="flex flex-1 items-center gap-3 border-b border-slate-200 px-6 py-5 last:border-0 lg:flex-col lg:items-start lg:gap-4 lg:border-b-0 lg:border-r lg:py-8"
              key={step}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-semibold text-white">
                {index + 1}
              </span>
              <p className="text-sm font-medium leading-snug text-slate-800">{step}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
