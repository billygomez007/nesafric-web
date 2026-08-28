"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
 */
export function MarketplaceCarousel({ placement, countryCode, limit = 6 }: { placement: "MARKETPLACE_INLINE" | "DEVELOPMENT_FEATURED" | "SEARCH_FEATURED"; countryCode?: string; limit?: number }) {
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
      if (!response.ok || cancelled) return;
      const body = await response.json();
      setBanners(Array.isArray(body.banners) ? body.banners : []);
    });
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

  return (
    <div
      aria-label="Featured marketplace campaigns"
      aria-roledescription="carousel"
      className="relative overflow-hidden rounded-2xl border border-slate-200 bg-navy"
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
          className="group relative block h-56 sm:h-56"
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
          <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/70 to-transparent" />
          <div className={`relative flex h-full max-w-lg flex-col justify-center gap-2 py-6 sm:py-8 ${multi ? "pl-14 pr-14 sm:pl-16 sm:pr-16" : "px-6 sm:px-8"}`}>
            <span className="w-fit rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-200 backdrop-blur">
              Promoted
            </span>
            <h3 className="text-lg font-semibold text-white sm:text-xl">{active.headline}</h3>
            {active.supportingText && <p className="line-clamp-1 text-sm text-slate-300">{active.supportingText}</p>}
            {active.ctaLabel && <span className="mt-1 w-fit rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-navy">{active.ctaLabel}</span>}
          </div>
        </a>
      )}

      {multi && (
        <>
          <button
            aria-label="Previous campaign"
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white outline-offset-2 transition hover:bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            onClick={() => goTo(index - 1)}
            type="button"
          >
            <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button
            aria-label="Next campaign"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white outline-offset-2 transition hover:bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            onClick={() => goTo(index + 1)}
            type="button"
          >
            <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
            {banners.map((banner, slideIndex) => (
              <button
                aria-current={slideIndex === index ? "true" : undefined}
                aria-label={`Show campaign ${slideIndex + 1} of ${banners.length}: ${banner.headline}`}
                className={`h-1.5 rounded-full outline-offset-2 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${slideIndex === index ? "w-5 bg-white" : "w-1.5 bg-white/40 hover:bg-white/70"}`}
                key={banner.id}
                onClick={() => goTo(slideIndex)}
                type="button"
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
