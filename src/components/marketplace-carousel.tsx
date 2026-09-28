"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CampaignCreative, hasCampaignArtwork, type CampaignCreativeData } from "@/components/campaign-creative";

type Banner = CampaignCreativeData;

/** Used until the API says otherwise; mirrors `DEFAULT_ROTATION_SECONDS` in `modules/campaigns/rotation.ts`. */
const DEFAULT_ROTATION_SECONDS = 5;
const ROTATION_OPTIONS = [5, 8, 10];

/**
 * Secondary, multi-campaign sliding placement (item 25 "sliding marketplace banner/carousel") —
 * distinct from the single-campaign `MarketplaceBanner` hero. Renders nothing when zero campaigns
 * are eligible; renders a single static card (no controls) when exactly one is, since prev/next/dot
 * controls for a one-item carousel would be pointless chrome; only shows the full carousel UI for
 * two or more. Auto-rotation uses the placement's Super Admin setting (5, 8 or 10 seconds), pauses on hover/focus/touch, and is skipped entirely
 * under `prefers-reduced-motion`, per item 25's accessibility requirements.
 *
 * Advertising slots are campaigns only: with no eligible campaign (or when campaigns can't be
 * loaded) nothing renders — never a property listing or other substitute content. `frameClassName`
 * wraps the carousel only when it renders, so an empty slot leaves no empty frame behind.
 * Eligibility is decided by the server (`GET /api/public/campaigns`), the same API the app uses.
 */
export function MarketplaceCarousel({ placement, countryCode = "GH", limit = 6, frameClassName }: { placement: "MARKETPLACE_PRIMARY" | "MARKETPLACE_INLINE" | "DEVELOPMENT_FEATURED" | "SEARCH_FEATURED"; countryCode?: string; limit?: number; frameClassName?: string }) {
  const [banners, setBanners] = useState<Banner[] | null>(null);
  const [index, setIndex] = useState(0);
  const [rotationSeconds, setRotationSeconds] = useState(DEFAULT_ROTATION_SECONDS);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const trackedImpressions = useRef(new Set<string>());
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ placement, limit: String(limit) });
    if (countryCode) params.set("countryCode", countryCode);
    let cancelled = false;
    fetch(`/api/public/campaigns?${params}`, { cache: "no-store" }).then(async (response) => {
      if (cancelled) return;
      if (!response.ok) { setBanners([]); return; }
      const body = await response.json();
      // No artwork, nothing to show: the image is the whole ad.
      setBanners(Array.isArray(body.banners) ? body.banners.filter(hasCampaignArtwork) : []);
      if (ROTATION_OPTIONS.includes(body.rotationSeconds)) setRotationSeconds(body.rotationSeconds);
    }).catch(() => { if (!cancelled) setBanners([]); });
    return () => { cancelled = true; };
  }, [placement, countryCode, limit]);

  const active = banners && banners.length > 0 ? banners[index % banners.length] : null;

  useEffect(() => {
    if (!active || trackedImpressions.current.has(active.id)) return;
    trackedImpressions.current.add(active.id);
    void fetch(`/api/public/campaigns/${active.id}/impression`, { method: "POST" });
  }, [active]);

  const goTo = useCallback((next: number) => {
    if (!banners || banners.length === 0) return;
    setIndex(((next % banners.length) + banners.length) % banners.length);
  }, [banners]);

  const canRotate = !!banners && banners.length > 1;

  // One timer per shown slide: moving to a slide (automatically or by hand) restarts the full wait.
  useEffect(() => {
    if (!canRotate || paused || reducedMotion) return;
    const timer = setTimeout(() => setIndex((current) => (banners ? (current + 1) % banners.length : 0)), rotationSeconds * 1000);
    return () => clearTimeout(timer);
  }, [canRotate, paused, reducedMotion, banners, index, rotationSeconds]);

  if (!banners || banners.length === 0) return null;

  const multi = banners.length > 1;

  function onTouchStart(event: React.TouchEvent) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }
  function onTouchEnd(event: React.TouchEvent) {
    if (touchStartX.current == null) return;
    const deltaX = (event.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(deltaX) < 40) return;
    goTo(index + (deltaX < 0 ? 1 : -1));
  }
  function onKeyDown(event: React.KeyboardEvent) {
    if (!multi) return;
    if (event.key === "ArrowRight") { event.preventDefault(); goTo(index + 1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); goTo(index - 1); }
  }

  // The uploaded artwork is the whole ad: nothing is drawn over it. Carousel controls sit in a
  // slim bar below the image instead of on top of it.
  const carousel = (
    <div
      aria-label="Marketplace campaigns"
      aria-roledescription="carousel"
      className="overflow-hidden rounded-[var(--radius-panel)] bg-forest-deep"
      onBlur={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchEnd={onTouchEnd}
      onTouchStart={onTouchStart}
      role="region"
    >
      {active && (
        <CampaignCreative
          campaign={active}
          key={active.id}
          onClick={() => void fetch(`/api/public/campaigns/${active.id}/click`, { method: "POST" })}
          priority={index === 0}
        />
      )}

      {multi && (
        <div className="flex items-center justify-between gap-2 px-2 py-1" data-testid="campaign-controls">
          <button
            aria-label="Previous campaign"
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] text-white/80 outline-offset-2 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-soft"
            onClick={() => goTo(index - 1)}
            type="button"
          >
            <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="flex gap-1.5">
            {banners.map((banner, slideIndex) => (
              <button
                aria-current={slideIndex === index ? "true" : undefined}
                aria-label={`Show campaign ${slideIndex + 1} of ${banners.length}: ${banner.headline}`}
                className="group/dot flex h-6 items-center px-0.5 outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-soft"
                key={banner.id}
                onClick={() => goTo(slideIndex)}
                type="button"
              >
                <span aria-hidden="true" className={`block h-1 transition-all ${slideIndex === index ? "w-6 bg-gold" : "w-3 bg-white/45 group-hover/dot:bg-white/75"}`} />
              </button>
            ))}
          </div>
          <button
            aria-label="Next campaign"
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] text-white/80 outline-offset-2 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-soft"
            onClick={() => goTo(index + 1)}
            type="button"
          >
            <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      )}
    </div>
  );

  return frameClassName ? <div className={frameClassName}>{carousel}</div> : carousel;
}
