"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { selectCampaignCreative } from "@/modules/campaigns/eligibility";

type Banner = {
  id: string;
  headline: string;
  supportingText: string | null;
  ctaLabel: string | null;
  destinationUrl: string;
  desktopMediaUrl: string | null;
  mobileMediaUrl: string | null;
};

const AUTO_ROTATE_MS = 7000;

/**
 * Secondary, multi-campaign sliding placement (item 25 "sliding marketplace banner/carousel") —
 * distinct from the single-campaign `MarketplaceBanner` hero. Renders nothing when zero campaigns
 * are eligible; renders a single static card (no controls) when exactly one is, since prev/next/dot
 * controls for a one-item carousel would be pointless chrome; only shows the full carousel UI for
 * two or more. Auto-rotation is restrained, pauses on hover/focus/touch, and is skipped entirely
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
      setBanners(Array.isArray(body.banners) ? body.banners : []);
    }).catch(() => { if (!cancelled) setBanners([]); });
    return () => { cancelled = true; };
  }, [placement, countryCode, limit]);

  // Carousel placements require uploaded artwork. Campaign text must never be manufactured
  // into a substitute banner because the uploaded creative is the complete advertisement.
  const visualBanners = banners?.filter((banner) => Boolean(banner.desktopMediaUrl || banner.mobileMediaUrl)) ?? null;
  const active = visualBanners && visualBanners.length > 0 ? visualBanners[index % visualBanners.length] : null;

  useEffect(() => {
    if (!active || trackedImpressions.current.has(active.id)) return;
    trackedImpressions.current.add(active.id);
    void fetch(`/api/public/campaigns/${active.id}/impression`, { method: "POST" });
  }, [active]);

  const goTo = useCallback((next: number) => {
    if (!visualBanners || visualBanners.length === 0) return;
    setIndex(((next % visualBanners.length) + visualBanners.length) % visualBanners.length);
  }, [visualBanners]);

  const canRotate = !!visualBanners && visualBanners.length > 1;

  useEffect(() => {
    if (!canRotate || paused || reducedMotion) return;
    const timer = setInterval(() => setIndex((current) => (visualBanners ? (current + 1) % visualBanners.length : 0)), AUTO_ROTATE_MS);
    return () => clearInterval(timer);
  }, [canRotate, paused, reducedMotion, visualBanners]);

  if (!visualBanners || visualBanners.length === 0) return null;

  const multi = visualBanners.length > 1;
  const desktopArt = active ? selectCampaignCreative(active, "desktopWeb") : null;
  const mobileArt = active ? selectCampaignCreative(active, "mobileWeb") : null;

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

  const carousel = (
    <div
      aria-label="Featured marketplace campaigns"
      aria-roledescription="carousel"
      className="relative overflow-hidden rounded-[var(--radius-panel)] bg-forest-deep"
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
        <a
          // Advertising disclosure for assistive technology only; nothing is drawn over the artwork.
          aria-label={`Sponsored: ${active.headline}`}
          aria-roledescription="slide"
          className="group relative block h-36 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-gold-soft sm:h-40 lg:h-44"
          data-testid="campaign-slide"
          href={active.destinationUrl}
          key={active.id}
          onClick={() => void fetch(`/api/public/campaigns/${active.id}/click`, { method: "POST" })}
          rel="noopener"
          role="group"
        >
          <>
            {desktopArt && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                aria-hidden="true"
                className="absolute inset-0 hidden h-full w-full object-contain sm:block"
                data-testid="campaign-art"
                src={desktopArt}
              />
            )}
            {mobileArt && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full object-contain sm:hidden"
                data-testid="campaign-art"
                src={mobileArt}
              />
            )}
          </>
        </a>
      )}

      {multi && (
        <>
          <button
            aria-label="Previous campaign"
            className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-[var(--radius-control)] bg-forest-deep/60 text-white outline-offset-2 transition hover:bg-forest-deep/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-soft max-sm:hidden"
            onClick={() => goTo(index - 1)}
            type="button"
          >
            <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button
            aria-label="Next campaign"
            className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-[var(--radius-control)] bg-forest-deep/60 text-white outline-offset-2 transition hover:bg-forest-deep/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-soft max-sm:hidden"
            onClick={() => goTo(index + 1)}
            type="button"
          >
            <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="absolute bottom-3 left-6 flex gap-1.5 sm:left-1/2 sm:-translate-x-1/2">
            {visualBanners.map((banner, slideIndex) => (
              <button
                aria-current={slideIndex === index ? "true" : undefined}
                aria-label={`Show campaign ${slideIndex + 1} of ${visualBanners.length}: ${banner.headline}`}
                className="group/dot flex h-6 items-center px-0.5 outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-soft"
                key={banner.id}
                onClick={() => goTo(slideIndex)}
                type="button"
              >
                <span aria-hidden="true" className={`block h-1 transition-all ${slideIndex === index ? "w-6 bg-gold" : "w-3 bg-white/45 group-hover/dot:bg-white/75"}`} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );

  return frameClassName ? <div className={frameClassName}>{carousel}</div> : carousel;
}
