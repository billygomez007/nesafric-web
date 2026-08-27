"use client";

import Link from "next/link";
import { trackCampaignEvent } from "@/components/marketing/campaign-tracking";

export function GhanaHero() {
  return (
    <section className="marketing-grid relative overflow-hidden bg-slate-950 pt-20 pb-24 sm:pt-28 sm:pb-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-12rem] h-[36rem] w-[64rem] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl"
      />
      <div className="relative mx-auto max-w-4xl px-6 text-center sm:px-8">
        <div className="marketing-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 text-xs font-semibold tracking-[0.18em] text-emerald-300">
            NOW LIVE IN GHANA
          </span>
          <h1 className="mt-8 text-5xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl">
            The new way to run real estate has arrived.
          </h1>
          <p className="mt-5 text-base font-medium tracking-wide text-slate-400">
            Built for African real estate. Now live in Ghana.
          </p>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            UmoAfric brings property marketing, listings, leads, viewings, teams and AI-powered real-estate
            operations into one intelligent platform.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              className="rounded-full bg-emerald-400 px-6 py-3.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-300"
              href="/register"
              onClick={() => trackCampaignEvent("join_free_click", { placement: "ghana_hero" })}
            >
              Join UmoAfric Free
            </Link>
            <Link
              className="rounded-full border border-white/20 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:border-white/40"
              href="/marketplace/properties"
              onClick={() => trackCampaignEvent("marketplace_visit_click", { placement: "ghana_hero" })}
            >
              Explore the Marketplace
            </Link>
          </div>
          <p className="mt-8 text-xs font-medium tracking-[0.14em] text-slate-500">
            MARKETPLACE PROFESSIONAL ACCOUNTS ARE FREE DURING OUR GHANA LAUNCH
          </p>
        </div>
      </div>
    </section>
  );
}
