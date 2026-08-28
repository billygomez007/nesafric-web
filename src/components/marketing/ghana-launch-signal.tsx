import Link from "next/link";

export function GhanaLaunchSignal() {
  return (
    <section className="border-b border-slate-200 bg-white py-14 sm:py-16">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="flex flex-col items-start gap-6 rounded-2xl border border-slate-200 bg-slate-50 p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-navy">
              NOW LIVE IN GHANA
            </span>
            <p className="mt-4 max-w-xl text-lg font-semibold leading-7 text-slate-950">
              Built for African real estate.
            </p>
            <p className="mt-1 max-w-xl text-base leading-7 text-slate-600">
              Manage properties. Market listings. Run developments. Grow your real-estate business with AI
              built in.
            </p>
          </div>
          <Link
            className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-navy transition-colors hover:text-brand-strong"
            href="/ghana"
          >
            Discover the Ghana Launch →
          </Link>
        </div>
      </div>
    </section>
  );
}
