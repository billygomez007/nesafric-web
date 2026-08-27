import { ProductMockup } from "@/components/marketing/product-mockup";

const RECEPTIONIST_LOG = [
  { role: "Prospect", text: "Is the 2-bedroom unit in Osu still available for September?", tone: "text-slate-400" },
  { role: "AI Receptionist", text: "Yes — available from 15 September. Would you like to schedule a viewing?", tone: "text-emerald-300" },
  { role: "Escalated", text: "Move-in date flexibility requested → routed to Property Manager.", tone: "text-amber-300" },
];

const MANAGER_SIGNALS = [
  { label: "Rent overdue", detail: "Unit A2 · 14 days", level: "Alert" },
  { label: "Lease expiring", detail: "Unit B4 · renews in 21 days", level: "Upcoming" },
  { label: "Work order open", detail: "Unit C1 · plumbing, assigned", level: "In progress" },
  { label: "Move-out scheduled", detail: "Unit D3 · inspection pending", level: "Scheduled" },
];

const AI_EMPLOYEES = [
  {
    title: "AI Sales Agent",
    description:
      "Answers listing enquiries, understands live inventory across a portfolio or development, qualifies leads and coordinates viewings for agents, brokers, brokerages and developers.",
  },
  {
    title: "AI Maintenance Coordinator",
    description:
      "Triages maintenance reports, assigns verified service providers, tracks work orders through to completion, and keeps tenants and owners updated automatically.",
  },
];

export function AIEmployeesSection() {
  return (
    <section className="scroll-mt-16 bg-slate-950 py-24 sm:py-32" id="ai-employees">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.22em] text-emerald-300">AI EMPLOYEES</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            A real AI workforce for real estate.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-400">
            Eligible Umo Afric customers can deploy AI employees that work inside day-to-day operations, sales and
            support — according to their plan and configured capabilities.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-7">
            <p className="text-sm font-semibold text-white">AI Receptionist</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Handles property enquiries, tenant questions, viewing requests, maintenance intake and routine
              communication — escalating to humans when necessary.
            </p>
            <div className="mt-6 space-y-3 rounded-xl border border-white/10 bg-slate-950/60 p-4">
              {RECEPTIONIST_LOG.map((entry) => (
                <div key={entry.text}>
                  <p className={`text-[11px] font-semibold tracking-wide ${entry.tone}`}>{entry.role.toUpperCase()}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-300">{entry.text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-7">
            <p className="text-sm font-semibold text-white">AI Property Manager</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Monitors rent, leases, vacancies, maintenance, work orders, move-ins, move-outs and operational
              exceptions across the portfolio.
            </p>
            <div className="mt-6 space-y-2 rounded-xl border border-white/10 bg-slate-950/60 p-4">
              {MANAGER_SIGNALS.map((signal) => (
                <div className="flex items-center justify-between border-b border-white/5 py-2.5 last:border-0" key={signal.label}>
                  <div>
                    <p className="text-sm font-medium text-slate-200">{signal.label}</p>
                    <p className="text-[11px] text-slate-500">{signal.detail}</p>
                  </div>
                  <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-medium text-slate-400">
                    {signal.level}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {AI_EMPLOYEES.map((employee) => (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-7" key={employee.title}>
              <p className="text-sm font-semibold text-white">{employee.title}</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">{employee.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-16">
          <ProductMockup
            alt="Umo AI Receptionist responding to a property enquiry and handing off a qualified viewing request to an agent"
            src="/marketing/mockups/ai-receptionist-workflow.png"
          />
        </div>

        <div className="mt-16 border-t border-white/10 pt-12">
          <p className="max-w-3xl text-2xl font-medium leading-tight tracking-tight text-white sm:text-3xl">
            “Your AI doesn&apos;t just answer questions. It works inside your real estate operation.”
          </p>
        </div>
      </div>
    </section>
  );
}
