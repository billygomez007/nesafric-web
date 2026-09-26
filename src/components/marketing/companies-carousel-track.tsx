"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TYPE_LABELS } from "@/components/marketplace-directory";

export type CompanyCarouselItem = {
  slug: string;
  displayName: string;
  type: string;
  logoUrl: string | null;
  verificationStatus: string;
};

const PIXELS_PER_SECOND = 32;

function CompanyChip({ item, duplicate }: { item: CompanyCarouselItem; duplicate: boolean }) {
  return (
    <Link
      aria-hidden={duplicate || undefined}
      className={`relative flex shrink-0 items-center gap-3 rounded-[var(--radius-control)] border border-hairline bg-white px-4 py-3 transition-colors hover:border-forest/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-strong ${duplicate ? "motion-reduce:hidden" : ""}`}
      href={`/marketplace/professionals/${item.slug}`}
      tabIndex={duplicate ? -1 : undefined}
    >
      {item.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" aria-hidden="true" className="h-10 w-auto max-w-24 shrink-0 rounded-[var(--radius-media)] object-contain" src={item.logoUrl} />
      ) : (
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-media)] bg-cream font-display text-sm font-semibold text-forest-deep">
          {item.displayName.slice(0, 1)}
        </span>
      )}
      <span className="flex flex-col leading-tight">
        <span className="flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-forest-deep">
          {item.displayName}
          {item.verificationStatus === "VERIFIED" && (
            <span className="inline-flex items-center text-gold-ink" title="Verified">
              <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></svg>
              <span className="sr-only">Verified</span>
            </span>
          )}
        </span>
        <span className="whitespace-nowrap text-xs text-muted">{TYPE_LABELS[item.type] ?? item.type}</span>
      </span>
    </Link>
  );
}

/** Auto-scrolls by directly animating `scrollLeft` on a real scroll container (not a CSS
 * transform track), so touch/trackpad swipe on mobile and manual drag on desktop both work as
 * native scrolling rather than fighting a keyframe animation. Pauses on hover, keyboard focus,
 * and while the user is actively touching/dragging; skips the animation entirely under
 * prefers-reduced-motion, leaving a plain swipeable strip. */
export function CompaniesCarouselTrack({ items }: { items: CompanyCarouselItem[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const loopWidthRef = useRef(0);

  // The seamless loop needs a second copy of the chips, which only makes sense when one copy is
  // wider than the strip. With a few companies that fit on screen, show each exactly once.
  const [loop, setLoop] = useState(false);
  const doubled = loop ? [...items, ...items] : items;

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const check = () => {
      const oneCopy = loop ? track.scrollWidth / 2 : track.scrollWidth;
      setLoop(oneCopy > track.clientWidth + 1);
    };
    check();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(check);
    observer.observe(track);
    return () => observer.disconnect();
  }, [loop, items.length]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || !loop) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || items.length === 0) return;

    const measure = () => {
      loopWidthRef.current = track.scrollWidth / 2;
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(track);

    let lastTimestamp: number | null = null;
    let frame: number;

    const step = (timestamp: number) => {
      if (lastTimestamp === null) lastTimestamp = timestamp;
      const deltaSeconds = (timestamp - lastTimestamp) / 1000;
      lastTimestamp = timestamp;

      if (!pausedRef.current) {
        track.scrollLeft += PIXELS_PER_SECOND * deltaSeconds;
        if (loopWidthRef.current > 0 && track.scrollLeft >= loopWidthRef.current) {
          track.scrollLeft -= loopWidthRef.current;
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);

    const pause = () => { pausedRef.current = true; };
    const resume = () => { pausedRef.current = false; };

    track.addEventListener("mouseenter", pause);
    track.addEventListener("mouseleave", resume);
    track.addEventListener("focusin", pause);
    track.addEventListener("focusout", resume);
    track.addEventListener("pointerdown", pause);
    track.addEventListener("pointerup", resume);
    track.addEventListener("pointercancel", resume);
    track.addEventListener("touchstart", pause, { passive: true });
    track.addEventListener("touchend", resume);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      track.removeEventListener("mouseenter", pause);
      track.removeEventListener("mouseleave", resume);
      track.removeEventListener("focusin", pause);
      track.removeEventListener("focusout", resume);
      track.removeEventListener("pointerdown", pause);
      track.removeEventListener("pointerup", resume);
      track.removeEventListener("pointercancel", resume);
      track.removeEventListener("touchstart", pause);
      track.removeEventListener("touchend", resume);
    };
  }, [items.length, loop]);

  return (
    <div
      className="flex gap-3 overflow-x-auto px-6 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] sm:px-8 [&::-webkit-scrollbar]:hidden"
      ref={trackRef}
    >
      {doubled.map((item, index) => (
        <CompanyChip duplicate={index >= items.length} item={item} key={`${item.slug}-${index}`} />
      ))}
    </div>
  );
}
