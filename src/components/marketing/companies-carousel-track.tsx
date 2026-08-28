"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
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
      className={`flex shrink-0 items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 shadow-sm transition-colors hover:border-brand ${duplicate ? "motion-reduce:hidden" : ""}`}
      href={`/marketplace/professionals/${item.slug}`}
      tabIndex={duplicate ? -1 : undefined}
    >
      {item.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" aria-hidden="true" className="h-8 w-8 shrink-0 rounded-full object-cover" src={item.logoUrl} />
      ) : (
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
          {item.displayName.slice(0, 1)}
        </span>
      )}
      <span className="flex flex-col leading-tight">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-950">
          {item.displayName}
          {item.verificationStatus === "VERIFIED" && (
            <span aria-label="Verified" className="text-brand-strong" title="Verified">
              ✓
            </span>
          )}
        </span>
        <span className="text-xs text-slate-500">{TYPE_LABELS[item.type] ?? item.type}</span>
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

  const doubled = [...items, ...items];

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

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
  }, [items.length]);

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
