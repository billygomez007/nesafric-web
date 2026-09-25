"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

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
 * `fallback` (opt-in, e.g. the homepage's platform-owned banner) is shown instead of nothing when
 * no campaign is eligible or campaigns can't be loaded; until the answer is known a same-height
 * placeholder holds the space, so a real campaign never flashes behind the fallback.
 */
export function MarketplaceCarousel({ placement, countryCode, limit = 6, fallback }: { placement: "MARKETPLACE_PRIMARY" | "MARKETPLACE_INLINE" | "DEVELOPMENT_FEATURED" | "SEARCH_FEATURED"; countryCode?: string; limit?: number; fallback?: ReactNode }) {
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
    fetch(`/api/public/campaigns?${params}`).then(async (response) => {
      if (cancelled) return;
      if (!response.ok) { setBanners([]); return; }
      const body = await response.json();
      setBanners(Array.isArray(body.banners) ? body.banners : []);
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

  useEffect(() => {
    if (!canRotate || paused || reducedMotion) return;
    const timer = setInterval(() => setIndex((current) => (banners ? (current + 1) % banners.length : 0)), AUTO_ROTATE_MS);
    return () => clearInterval(timer);
  }, [canRotate, paused, reducedMotion, banners]);

  if (!banners || banners.length === 0) {
    if (!fallback) return null;
    return banners ? <>{fallback}</> : <div aria-busy="true" aria-label="Loading featured content" className="h-64 bg-forest-deep sm:h-72 lg:h-80" role="status" />;
  }

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

  return (
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
          aria-label={`Promoted: ${active.headline}`}
          aria-roledescription="slide"
          className="group relative block h-64 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-gold-soft sm:h-72 lg:h-80"
          href={active.destinationUrl}
          key={active.id}
          onClick={() => void fetch(`/api/public/campaigns/${active.id}/click`, { method: "POST" })}
          rel="noopener"
          role="group"
        >
          {active.desktopMediaUrl && (
            <div className="absolute inset-0 hidden bg-cover bg-center sm:block" style={{ backgroundImage: `url("${active.desktopMediaUrl}")` }} />
          )}
          {(active.mobileMediaUrl ?? active.desktopMediaUrl) && (
            <div className="absolute inset-0 bg-cover bg-center sm:hidden" style={{ backgroundImage: `url("${active.mobileMediaUrl ?? active.desktopMediaUrl}")` }} />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-forest-deep/95 via-forest-deep/60 to-transparent" />
          <div className={`relative flex h-full max-w-xl flex-col justify-end gap-2 pb-10 pt-6 sm:justify-center sm:pb-8 ${multi ? "pl-6 pr-14 sm:pl-16 sm:pr-16" : "px-6 sm:px-10"}`}>
            <span className="w-fit text-xs font-semibold text-gold-soft">
              Promoted
            </span>
            <h3 className="font-display text-xl font-semibold leading-tight text-white sm:text-[28px]">{active.headline}</h3>
            {active.supportingText && <p className="line-clamp-2 max-w-md text-sm leading-6 text-white/80">{active.supportingText}</p>}
            {active.ctaLabel && <span className="mt-2 inline-flex min-h-10 w-fit items-center rounded-[var(--radius-control)] bg-gold px-4 text-sm font-semibold text-forest-deep transition-colors group-hover:bg-gold-soft">{active.ctaLabel}</span>}
          </div>
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
        </>
      )}
    </div>
  );
}
