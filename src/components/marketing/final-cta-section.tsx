import Link from "next/link";

export function FinalCtaSection() {
  return (
    <section className="marketing-grid relative overflow-hidden bg-slate-950 py-24 sm:py-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[28rem] w-[56rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/10 blur-3xl"
      />
      <div className="relative mx-auto max-w-4xl px-6 text-center sm:px-8">
        <h2 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Run your property business on NesAfric.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-400">
          Landlords, property managers and developers can operate their entire portfolio — from listing to
          renewal — on one intelligent system.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            className="rounded-full bg-emerald-400 px-6 py-3.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-300"
            href="/register"
          >
            Get Started
          </Link>
          <Link
            className="rounded-full border border-white/20 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:border-white/40"
            href="mailto:hello@nesafric.com?subject=Book%20a%20demo%20%E2%80%94%20PropertyOS"
          >
            Book a Demo
          </Link>
        </div>
      </div>
    </section>
  );
}
