"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { trackCampaignEvent } from "@/components/marketing/campaign-tracking";
import { buttonClass } from "@/components/ui/button-styles";

type HeroAction = {
  label: string;
  href: string;
  /** Campaign event fired on click — kept identical to the event each page sent before. */
  event?: Parameters<typeof trackCampaignEvent>[0];
  placement?: string;
};

/**
 * Shared hero for audience pages (owners, professionals, developers, Ghana): editorial headline
 * on the left, a coded fragment of the product that audience actually uses on the right.
 */
export function AudienceHero({
  audience,
  title,
  lede,
  primary,
  secondary,
  note,
  fragment,
}: {
  audience: string;
  title: ReactNode;
  lede: ReactNode;
  primary: HeroAction;
  secondary?: HeroAction;
  note?: ReactNode;
  fragment: ReactNode;
}) {
  const click = (action: HeroAction) => () => {
    if (action.event) trackCampaignEvent(action.event, { placement: action.placement ?? "" });
  };

  return (
    <section className="marketing-grid bg-forest-deep text-white">
      <div className="mx-auto grid max-w-[1400px] gap-12 px-5 pb-16 pt-12 sm:px-8 sm:pb-20 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:items-center lg:gap-16 lg:py-24">
        <div className="max-w-[620px]">
          <p className="text-sm font-medium text-gold-soft">{audience}</p>
          <h1 className="mt-4 text-[clamp(2.25rem,4.6vw,3.75rem)] font-semibold leading-[1.04] tracking-[-0.03em]">{title}</h1>
          <p className="mt-6 max-w-[560px] text-base leading-7 text-white/75 sm:text-[17px] sm:leading-8">{lede}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link className={buttonClass("primaryOnDark")} href={primary.href} onClick={click(primary)}>
              {primary.label}
            </Link>
            {secondary && (
              <Link className={buttonClass("secondaryOnDark")} href={secondary.href} onClick={click(secondary)}>
                {secondary.label}
              </Link>
            )}
          </div>
          {note && <p className="mt-6 text-sm text-white/60">{note}</p>}
        </div>
        <div className="min-w-0">{fragment}</div>
      </div>
    </section>
  );
}
