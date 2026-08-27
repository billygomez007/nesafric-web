import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { LaunchOfferSection } from "@/components/marketing/launch-offer-section";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Umo Afric pricing: Marketplace Professional access is free during the Ghana launch. PropertyOS property-management plans start from GHS 250/month.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <>
      <SiteNav />
      <main>
        <section className="bg-white pt-20 pb-4 sm:pt-28">
          <div className="mx-auto max-w-3xl px-6 text-center sm:px-8">
            <p className="text-xs font-semibold tracking-[0.22em] text-emerald-700">PRICING</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
              Simple, honest pricing.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-slate-600">
              Marketplace Professional access is free during our Ghana launch. Property management runs on a
              straightforward monthly plan.
            </p>
          </div>
        </section>

        <LaunchOfferSection ctaLabel="Start Free" />

        <section className="bg-slate-50 py-24 sm:py-32">
          <div className="mx-auto max-w-3xl px-6 sm:px-8">
            <div className="rounded-2xl border border-slate-200 bg-white p-8 sm:p-10">
              <p className="text-xs font-semibold tracking-[0.22em] text-emerald-700">PROPERTY MANAGEMENT</p>
              <h2 className="mt-3 text-2xl font-semibold text-slate-950">PropertyOS management plans</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
                For landlords, property managers and developers operating a portfolio, PropertyOS plans start
                from <strong className="font-semibold text-slate-950">GHS 250/month</strong> for an individual
                landlord, scaling up for growing portfolios and larger teams. Tell us the size of your
                portfolio and we&apos;ll point you to the right plan.
              </p>
              <Link
                className="mt-6 inline-flex items-center justify-center rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                href="/register"
              >
                Get Started
              </Link>
            </div>

            <p className="mt-8 max-w-xl text-sm leading-6 text-slate-500">
              Marketplace Professional access is free for the current Ghana launch. Additional paid
              professional tiers — with capabilities such as promoted listings, a featured profile and AI
              sales tools — are in development and may be introduced later.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
