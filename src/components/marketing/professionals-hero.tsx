"use client";

import Link from "next/link";
import { trackCampaignEvent } from "@/components/marketing/campaign-tracking";

export function ProfessionalsHero() {
  return (
    <section className="marketing-grid relative overflow-hidden bg-navy pt-20 pb-24 sm:pt-28 sm:pb-32">
      <div className="relative mx-auto max-w-4xl px-6 text-center sm:px-8">
        <p className="text-xs font-semibold tracking-[0.22em] text-brand">FOR AGENTS · BROKERS · BROKERAGES · REAL ESTATE COMPANIES</p>
        <h1 className="mt-6 text-5xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl">
          You handle the deal.
          <br />
          UmoAfric handles the work around it.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-300">
          List properties. Capture enquiries. Manage leads. Coordinate viewings. Organise your team. Put AI
          to work around your real-estate business.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            className="rounded-full bg-brand px-6 py-3.5 text-sm font-semibold text-navy transition-colors hover:bg-brand-hover"
            href="/register"
            onClick={() => trackCampaignEvent("join_free_click", { placement: "professionals_hero" })}
          >
            Start Free
          </Link>
          <Link
            className="rounded-full border border-white/20 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:border-white/40"
            href="/marketplace/properties"
            onClick={() => trackCampaignEvent("marketplace_visit_click", { placement: "professionals_hero" })}
          >
            Explore the Marketplace
          </Link>
        </div>
        <p className="mt-8 text-xs font-medium tracking-[0.14em] text-slate-500">
          FREE FOR MARKETPLACE PROFESSIONALS DURING THE GHANA LAUNCH
        </p>
      </div>
    </section>
  );
}
