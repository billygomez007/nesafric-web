const CONTROLS = [
  { title: "Organisation isolation", detail: "Every record is scoped to its organisation — no cross-tenant visibility." },
  { title: "Role-based access", detail: "Owners, administrators, managers and staff each operate within defined permissions." },
  { title: "Audit history", detail: "Every sensitive action is recorded, append-only, and attributable to its actor." },
  { title: "Controlled AI permissions", detail: "AI employees operate only within explicitly granted tools and scope." },
  { title: "Human approval", detail: "Sensitive or high-impact AI actions route to a human for approval before they execute." },
  { title: "Secure document handling", detail: "Uploaded and generated documents are access-controlled and traceable." },
];

export function TrustSection() {
  return (
    <section className="bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.22em] text-emerald-700">TRUST &amp; CONTROL</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Built for operators who are accountable for what happens.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600">
            Automation is powerful only when it&apos;s controllable. Every organisation operates in isolation, with
            clear roles, a full history, and explicit limits on what AI is allowed to do on its own.
          </p>
        </div>

        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">
          {CONTROLS.map((control) => (
            <div className="bg-white p-7" key={control.title}>
              <p className="text-sm font-semibold text-slate-950">{control.title}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">{control.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
