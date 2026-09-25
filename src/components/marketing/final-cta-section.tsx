import Link from "next/link";
import { BRAND } from "@/platform/brand";
import { buttonClass } from "@/components/ui/button-styles";

export function FinalCtaSection() {
  return (
    <section className="border-t border-white/10 bg-forest-deep py-16 sm:py-24">
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8">
        <h2 className="max-w-3xl text-3xl font-semibold tracking-[-0.025em] text-white sm:text-[40px] sm:leading-[1.1]">
          Run your real estate business on NesAfric.
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-7 text-white/70">
          Owners, managers, agents, brokers, brokerages and developers can operate, market and grow — from
          listing to renewal, from lead to lease — on one record.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            className={buttonClass("primaryOnDark")}
            href="/register"
          >
            Manage properties
          </Link>
          <Link
            className={buttonClass("secondaryOnDark")}
            href="/register"
          >
            Market properties
          </Link>
        </div>
        <p className="mt-6 text-sm text-white/60">
          Represent a brokerage or a large real estate company?{" "}
          <Link
            className="font-semibold text-white underline-offset-4 hover:underline"
            href={`mailto:${BRAND.contact.hello}?subject=${encodeURIComponent(`Book a demo — ${BRAND.name}`)}`}
          >
            Book a demo
          </Link>
        </p>
      </div>
    </section>
  );
}
