"use client";

import { useEffect, useState } from "react";

type Banner = { id: string; headline: string; supportingText: string | null; ctaLabel: string | null; destinationUrl: string };

/**
 * Item 18/24's single homepage placement: a thin, optional, dismissible announcement bar for
 * NesAfric-owned announcements only. Deliberately not a carousel and never rendered for anything
 * but `HOMEPAGE_ANNOUNCEMENT` — the corporate homepage stays clean and product-led otherwise.
 */
export function HomepageAnnouncementBar() {
  const [banner, setBanner] = useState<Banner | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    fetch("/api/public/campaigns?placement=HOMEPAGE_ANNOUNCEMENT").then(async (response) => {
      if (!response.ok) return;
      const body = await response.json();
      if (!body.banner) return;
      setBanner(body.banner);
      let alreadyDismissed = false;
      try {
        alreadyDismissed = localStorage.getItem("nesafric.dismissedAnnouncementId") === body.banner.id;
      } catch {
        // Best-effort only.
      }
      setDismissed(alreadyDismissed);
      if (!alreadyDismissed) void fetch(`/api/public/campaigns/${body.banner.id}/impression`, { method: "POST" });
    });
  }, []);

  if (!banner || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem("nesafric.dismissedAnnouncementId", banner!.id);
    } catch {
      // Best-effort only.
    }
  }

  return (
    <div className="flex items-center justify-center gap-3 bg-slate-950 px-4 py-2 text-center text-sm text-white">
      <a
        className="font-medium hover:underline"
        href={banner.destinationUrl}
        onClick={() => void fetch(`/api/public/campaigns/${banner.id}/click`, { method: "POST" })}
      >
        {banner.headline}
        {banner.ctaLabel && <span className="ml-2 underline">{banner.ctaLabel} →</span>}
      </a>
      <button aria-label="Dismiss announcement" className="text-slate-400 hover:text-white" onClick={dismiss} type="button">✕</button>
    </div>
  );
}
