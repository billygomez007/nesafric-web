"use client";

import { useEffect } from "react";
import { trackEvent, type AnalyticsEvent, type AnalyticsEventParams } from "@/platform/analytics";

export function PageViewTracker({ event, params }: { event: AnalyticsEvent; params?: AnalyticsEventParams }) {
  useEffect(() => {
    trackEvent(event, params);
    // `params` is a fresh object literal on every render at most call sites; re-keying on its
    // identity would refire on every parent re-render instead of once per mount/event change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);
  return null;
}
