"use client";

import { useEffect, useRef, useState } from "react";

type Banner = {
  id: string;
  headline: string;
  supportingText: string | null;
  ctaLabel: string | null;
  destinationUrl: string;
  desktopMediaUrl: string | null;
  mobileMediaUrl: string | null;
};

/** A single promotional placement (items 19/26) — public, safe projection only. Renders nothing
 * when no campaign is currently live for this placement, so an empty inventory of campaigns never
 * leaves a visible gap in the page. Full-bleed hero treatment: this is the marketplace's primary
 * promotional slot, not an inline ad strip — see `MarketplaceCarousel` for the secondary,
 * multi-campaign placement. */
export function MarketplaceBanner({ placement, countryCode = "GH" }: { placement: "MARKETPLACE_PRIMARY" | "MARKETPLACE_INLINE" | "DEVELOPMENT_FEATURED" | "PROFESSIONAL_FEATURED" | "SEARCH_FEATURED"; countryCode?: string }) {
  const [banner, setBanner] = useState<Banner | null>(null);
  const trackedImpression = useRef(false);

  useEffect(() => {
    trackedImpression.current = false;
    const params = new URLSearchParams({ placement });
    if (countryCode) params.set("countryCode", countryCode);
    let cancelled = false;
    fetch(`/api/public/campaigns?${params}`).then(async (response) => {
      if (!response.ok || cancelled) return;
      const body = await response.json();
      if (body.banner) setBanner(body.banner);
    });
    return () => { cancelled = true; };
  }, [placement, countryCode]);

  useEffect(() => {
    if (!banner || trackedImpression.current) return;
    trackedImpression.current = true;
    void fetch(`/api/public/campaigns/${banner.id}/impression`, { method: "POST" });
  }, [banner]);

  if (!banner) return null;

  const desktopArt = banner.desktopMediaUrl;
  const mobileArt = banner.mobileMediaUrl ?? banner.desktopMediaUrl;

  return (
    <div>
      <a
        aria-label={`Sponsored: ${banner.headline}`}
        className="group relative flex min-h-64 flex-col overflow-hidden rounded-3xl border border-forest/20 bg-forest-deep shadow-lg shadow-forest/10 transition hover:shadow-xl sm:min-h-80"
        data-testid="campaign-banner"
        href={banner.destinationUrl}
        onClick={() => void fetch(`/api/public/campaigns/${banner.id}/click`, { method: "POST" })}
        rel="noopener"
      >
        {desktopArt && (
          <div
            aria-hidden="true"
            className="absolute inset-0 hidden bg-cover bg-center sm:block"
            style={{ backgroundImage: `url("${desktopArt}")` }}
          />
        )}
        {mobileArt && (
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-cover bg-center sm:hidden"
            style={{ backgroundImage: `url("${mobileArt}")` }}
          />
        )}
        {/* Uploaded artwork is the finished creative, shown without text over it. Only a campaign
            with no artwork falls back to its own headline and copy. */}
        {!desktopArt && !mobileArt && (
          <div className="relative mt-auto flex flex-col gap-3 p-6 sm:p-10">
            <h2 className="max-w-2xl text-2xl font-semibold text-white sm:text-4xl">{banner.headline}</h2>
            {banner.supportingText && <p className="max-w-xl text-sm text-slate-300 sm:text-base">{banner.supportingText}</p>}
            {banner.ctaLabel && (
              <span className="mt-2 w-fit rounded-xl bg-teal px-4 py-2.5 text-sm font-semibold text-white transition group-hover:bg-teal-light">
                {banner.ctaLabel}
              </span>
            )}
          </div>
        )}
      </a>
      <p className="mt-1.5 text-right text-[11px] font-medium text-muted">Sponsored</p>
    </div>
  );
}
