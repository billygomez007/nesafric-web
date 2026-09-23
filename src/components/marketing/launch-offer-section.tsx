"use client";

import Link from "next/link";
import { trackCampaignEvent } from "@/components/marketing/campaign-tracking";

const INCLUDED = [
  "A professional profile and company presence on the NesAfric Marketplace",
  "Up to 10 active listings",
  "Up to 2 active developments",
  "Up to 3 team members",
  "Lead management and a dedicated lead inbox",
  "Viewing coordination",
];

export function LaunchOfferSection({ ctaLabel = "Claim Your Free Professional Account" }: { ctaLabel?: string }) {
  return (
    <section className="bg-warm-white py-24 sm:py-32" id="ghana-launch-offer">
      <div className="mx-auto max-w-5xl px-6 sm:px-8">
        <div className="overflow-hidden rounded-3xl border border-hairline shadow-sm">
          <div className="grid gap-0 lg:grid-cols-[1.1fr_1fr]">
            <div className="bg-forest p-10 sm:p-12">
              <p className="text-xs font-semibold tracking-[0.22em] text-gold-soft">GHANA LAUNCH</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Marketplace Professional.
                <br />
                Free.
              </h2>
              <p className="mt-4 text-sm leading-6 text-white/60">
                Included in the current launch plan — the same entitlements your account starts with today.
              </p>
              <ul className="mt-8 space-y-3">
                {INCLUDED.map((item) => (
                  <li className="flex items-start gap-3 text-sm leading-6 text-white/75" key={item}>
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col justify-center bg-white p-10 sm:p-12">
              <p className="text-sm font-semibold text-forest">This is the current launch offer.</p>
              <p className="mt-3 text-sm leading-6 text-muted">
                Marketplace Professional access is free for the Ghana launch. Additional paid professional
                tiers — with capabilities such as promoted listings, a featured profile, advanced analytics
                and AI sales tools — may be introduced later. There is no countdown and no obligation: this is
                simply today&apos;s offer for professionals joining now.
              </p>
              <Link
                className="mt-8 inline-flex items-center justify-center rounded-full bg-forest px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-emerald"
                href="/register"
                onClick={() => trackCampaignEvent("join_free_click", { placement: "launch_offer" })}
              >
                {ctaLabel}
              </Link>
              <p className="mt-4 text-xs text-muted">No card required. Set up your profile in minutes.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
