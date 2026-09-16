import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { LaunchOfferSection } from "@/components/marketing/launch-offer-section";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "NesAfric pricing: Marketplace Professional access is free during the Ghana launch. NesAfric property-management plans are configured for each workspace.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <>
      <SiteNav />
      <main>
        <section className="bg-warm-white pt-20 pb-4 sm:pt-28">
          <div className="mx-auto max-w-3xl px-6 text-center sm:px-8">
            <p className="text-xs font-semibold tracking-[0.22em] text-gold">PRICING</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-forest sm:text-5xl">
              Simple, honest pricing.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-muted">
              Marketplace Professional access is free during our Ghana launch. Property management runs on a
              straightforward monthly plan.
            </p>
          </div>
        </section>

        <LaunchOfferSection ctaLabel="Start Free" />

        <section className="bg-cream py-24 sm:py-32">
          <div className="mx-auto max-w-3xl px-6 sm:px-8">
            <div className="rounded-2xl border border-hairline bg-white p-8 sm:p-10">
              <p className="text-xs font-semibold tracking-[0.22em] text-gold">PROPERTY MANAGEMENT</p>
              <h2 className="mt-3 text-2xl font-semibold text-forest">NesAfric management plans</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
                For landlords, property managers and developers operating a portfolio, Plans are configured by workspace, currency and billing cycle for landlords, property managers and developers.
                Sign in to see the plans and entitlements available to your organisation.
              </p>
              <Link
                className="mt-6 inline-flex items-center justify-center rounded-full bg-forest px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald"
                href="/register"
              >
                Get Started
              </Link>
            </div>

            <p className="mt-8 max-w-xl text-sm leading-6 text-muted">
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
