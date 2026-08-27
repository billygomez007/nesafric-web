import Link from "next/link";
import { BRAND } from "@/platform/brand";

export function FinalCtaSection() {
  return (
    <section className="marketing-grid relative overflow-hidden bg-navy py-24 sm:py-32">
      <div className="relative mx-auto max-w-4xl px-6 text-center sm:px-8">
        <h2 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Run your real estate business on UmoAfric.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-400">
          Owners, managers, agents, brokers, brokerages and developers can operate, market and grow — from
          listing to renewal, from lead to lease — on one intelligent platform.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            className="rounded-full bg-brand px-6 py-3.5 text-sm font-semibold text-navy transition-colors hover:bg-brand-hover"
            href="/register"
          >
            Manage Properties
          </Link>
          <Link
            className="rounded-full border border-white/20 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:border-white/40"
            href="/register"
          >
            Market Properties
          </Link>
        </div>
        <p className="mt-6 text-sm text-slate-500">
          Represent a brokerage or a large real estate company?{" "}
          <Link
            className="font-semibold text-slate-300 transition-colors hover:text-white"
            href={`mailto:${BRAND.contact.hello}?subject=${encodeURIComponent(`Book a demo — ${BRAND.name}`)}`}
          >
            Book a demo
          </Link>
        </p>
      </div>
    </section>
  );
}
