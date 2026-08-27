const AUDIENCES = [
  {
    label: "For Landlords",
    description: "Manage properties, tenants, rent, leases, maintenance and performance from one place.",
  },
  {
    label: "For Property Managers",
    description: "Operate multiple properties, teams, tenants, communications, maintenance providers and financial workflows.",
  },
  {
    label: "For Developers",
    description: "Take developments from completion and handover into marketing, leasing, occupancy and ongoing operations.",
  },
];

export function AudienceSection() {
  return (
    <section className="bg-white py-24 sm:py-32" id="solutions">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.22em] text-emerald-700">SOLUTIONS</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            One platform. Built for the entire property business.
          </h2>
        </div>
        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-3">
          {AUDIENCES.map((audience) => (
            <div className="flex flex-col bg-white p-8" key={audience.label}>
              <p className="text-lg font-semibold text-slate-950">{audience.label}</p>
              <p className="mt-3 text-sm leading-6 text-slate-600">{audience.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
