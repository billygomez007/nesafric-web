const FEATURES = [
  "Automated rent collection and outstanding-balance tracking",
  "Mobile Money readiness — MTN MoMo, Telecel Cash, AT Money",
  "Card and bank-transfer collection",
  "Full payment history per tenant and per lease",
  "Automatic receipts on every confirmed payment",
  "Provider-webhook reconciliation with a clear audit trail",
];

const METHODS = ["Mobile Money", "Card", "Bank Transfer", "Manual / Cash"];

export function PaymentsSection() {
  return (
    <section className="scroll-mt-16 bg-slate-50 py-24 sm:py-32" id="payments">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="grid gap-14 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-emerald-700">PAYMENTS</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              Modern financial operations, built in.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-600">
              Collect rent the way your tenants actually pay, and keep a complete, reconciled financial record
              without spreadsheets.
            </p>
            <ul className="mt-8 space-y-3.5">
              {FEATURES.map((feature) => (
                <li className="flex items-start gap-3 text-sm leading-6 text-slate-700" key={feature}>
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <p className="text-xs font-medium tracking-wide text-slate-500">COLLECTION METHODS</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {METHODS.map((method) => (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700" key={method}>
                  {method}
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-950">Receipt</p>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Reconciled</span>
              </div>
              <div className="mt-4 space-y-2.5 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Tenant</span><span className="font-medium text-slate-800">Sample Tenant</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Method</span><span className="font-medium text-slate-800">Mobile Money</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Amount</span><span className="font-medium text-slate-800">GHS 2,500.00</span></div>
                <div className="flex justify-between border-t border-slate-100 pt-2.5"><span className="text-slate-500">Status</span><span className="font-medium text-emerald-700">Confirmed</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
