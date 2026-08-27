"use client";

import { useEffect, useState } from "react";

type Banner = { id: string; headline: string; supportingText: string | null; ctaLabel: string | null; destinationUrl: string; desktopMediaUrl: string | null };

/** A single promotional placement (items 19/26) — public, safe projection only. Renders nothing
 * when no campaign is currently live for this placement, so an empty inventory of campaigns never
 * leaves a visible gap in the page. */
export function MarketplaceBanner({ placement, countryCode }: { placement: "MARKETPLACE_PRIMARY" | "MARKETPLACE_INLINE" | "DEVELOPMENT_FEATURED" | "PROFESSIONAL_FEATURED" | "SEARCH_FEATURED"; countryCode?: string }) {
  const [banner, setBanner] = useState<Banner | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ placement });
    if (countryCode) params.set("countryCode", countryCode);
    fetch(`/api/public/campaigns?${params}`).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json();
      if (body.banner) { setBanner(body.banner); void fetch(`/api/public/campaigns/${body.banner.id}/impression`, { method: "POST" }); }
    });
  }, [placement, countryCode]);

  if (!banner) return null;

  return (
    <a
      className="block overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50 shadow-sm transition hover:border-emerald-400"
      href={banner.destinationUrl}
      onClick={() => void fetch(`/api/public/campaigns/${banner.id}/click`, { method: "POST" })}
    >
      <div className="flex flex-wrap items-center gap-4 p-5">
        {banner.desktopMediaUrl && <div className="h-16 w-16 shrink-0 rounded-xl bg-cover bg-center" style={{ backgroundImage: `url("${banner.desktopMediaUrl}")` }} />}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Promoted</p>
          <p className="mt-0.5 truncate font-semibold text-slate-950">{banner.headline}</p>
          {banner.supportingText && <p className="mt-0.5 truncate text-sm text-slate-600">{banner.supportingText}</p>}
        </div>
        {banner.ctaLabel && <span className="shrink-0 rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white">{banner.ctaLabel}</span>}
      </div>
    </a>
  );
}
