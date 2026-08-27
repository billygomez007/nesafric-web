"use client";

import { useEffect } from "react";
import { CampaignEventName, trackCampaignEvent } from "@/components/marketing/campaign-tracking";

export function PageViewTracker({ event }: { event: CampaignEventName }) {
  useEffect(() => {
    trackCampaignEvent(event);
  }, [event]);
  return null;
}
