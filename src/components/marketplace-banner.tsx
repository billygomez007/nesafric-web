"use client";

import { useEffect, useRef, useState } from "react";

import { CampaignCreative, hasCampaignArtwork, type CampaignCreativeData } from "@/components/campaign-creative";

type Banner = CampaignCreativeData;

/** A single promotional placement (items 19/26) — public, safe projection only. Renders nothing
 * when no campaign is currently live for this placement, so an empty inventory of campaigns never
 * leaves a visible gap in the page. See `MarketplaceCarousel` for the multi-campaign placement.
 * The uploaded artwork is the whole ad and is shown untouched (see `CampaignCreative`): no
 * overlay, label, headline or button is drawn on top of it. */
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
      if (body.banner && hasCampaignArtwork(body.banner)) setBanner(body.banner);
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
    <div className="overflow-hidden rounded-3xl border border-forest/20 bg-forest-deep shadow-lg shadow-forest/10">
      <CampaignCreative campaign={banner} onClick={() => void fetch(`/api/public/campaigns/${banner.id}/click`, { method: "POST" })} priority />
    </div>
  );
}
