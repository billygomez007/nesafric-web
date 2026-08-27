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
export function MarketplaceBanner({ placement, countryCode }: { placement: "MARKETPLACE_PRIMARY" | "MARKETPLACE_INLINE" | "DEVELOPMENT_FEATURED" | "PROFESSIONAL_FEATURED" | "SEARCH_FEATURED"; countryCode?: string }) {
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

  return (
    <a
      aria-label={`Promoted: ${banner.headline}`}
      className="group relative block h-64 overflow-hidden rounded-3xl border border-white/10 bg-emerald-950 shadow-lg shadow-emerald-950/20 transition hover:shadow-xl hover:shadow-emerald-950/30 sm:h-80"
      href={banner.destinationUrl}
      onClick={() => void fetch(`/api/public/campaigns/${banner.id}/click`, { method: "POST" })}
      rel="noopener"
    >
      {banner.desktopMediaUrl && (
        <div
          className="absolute inset-0 hidden bg-cover bg-center transition duration-700 ease-out group-hover:scale-105 sm:block"
          style={{ backgroundImage: `url("${banner.desktopMediaUrl}")` }}
        />
      )}
      {(banner.mobileMediaUrl ?? banner.desktopMediaUrl) && (
        <div
          className="absolute inset-0 bg-cover bg-center transition duration-700 ease-out group-hover:scale-105 sm:hidden"
          style={{ backgroundImage: `url("${banner.mobileMediaUrl ?? banner.desktopMediaUrl}")` }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-emerald-950 via-emerald-950/60 to-emerald-950/10" />
      <div className="relative flex h-full flex-col justify-end gap-3 p-6 sm:p-10">
        <span className="w-fit rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-200 backdrop-blur">
          Featured
        </span>
        <h2 className="max-w-2xl text-2xl font-semibold text-white sm:text-4xl">{banner.headline}</h2>
        {banner.supportingText && <p className="max-w-xl text-sm text-emerald-100 sm:text-base">{banner.supportingText}</p>}
        {banner.ctaLabel && (
          <span className="mt-2 w-fit rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-emerald-950 transition group-hover:bg-emerald-50">
            {banner.ctaLabel}
          </span>
        )}
      </div>
    </a>
  );
}
