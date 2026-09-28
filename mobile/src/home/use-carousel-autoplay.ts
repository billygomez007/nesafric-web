import { useEffect, useRef } from "react";

/**
 * Advances a carousel every `delayMs` with at most one pending timer. The timer is replaced when
 * the shown slide changes (automatically or by a swipe), and cleared while `paused`, when there is
 * only one slide, and on unmount.
 */
export function useCarouselAutoplay({ count, current, delayMs, paused, onAdvance }: { count: number; current: number; delayMs: number; paused: boolean; onAdvance: (next: number) => void }) {
  const advance = useRef(onAdvance);
  useEffect(() => {
    advance.current = onAdvance;
  });
  const active = count > 1 && !paused;
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => advance.current((current + 1) % count), delayMs);
    return () => clearTimeout(timer);
  }, [active, current, count, delayMs]);
}
