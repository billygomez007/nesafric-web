"use client";

import Link from "next/link";
import { trackCampaignEvent } from "@/components/marketing/campaign-tracking";

export function PropertyOwnersHero() {
  return (
    <section className="marketing-grid relative overflow-hidden bg-slate-950 pt-20 pb-24 sm:pt-28 sm:pb-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-12rem] h-[36rem] w-[64rem] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl"
      />
      <div className="relative mx-auto max-w-4xl px-6 text-center sm:px-8">
        <p className="text-xs font-semibold tracking-[0.22em] text-emerald-300">FOR OWNERS · LANDLORDS · PROPERTY MANAGERS · DEVELOPERS</p>
        <h1 className="mt-6 text-5xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl">
          Run your property operation from one intelligent platform.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-300">
          Properties, units, tenants, leases, rent, payments, maintenance and providers — organised in one
          place, with AI employees working inside the operation alongside your team.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            className="rounded-full bg-emerald-400 px-6 py-3.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-300"
            href="/register"
            onClick={() => trackCampaignEvent("join_free_click", { placement: "property_owners_hero" })}
          >
            Get Started
          </Link>
          <Link
            className="rounded-full border border-white/20 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:border-white/40"
            href="/ghana"
          >
            See the Ghana Launch →
          </Link>
        </div>
      </div>
    </section>
  );
}
