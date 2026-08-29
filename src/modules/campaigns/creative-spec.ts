import type { $Enums } from "@/platform/database/generated/client";

export type CreativeDimension = { width: number; height: number };
export type PlacementCreativeSpec = { desktop: CreativeDimension; mobile: CreativeDimension; measured: boolean };

/**
 * Canonical creative dimensions per placement — the single source of truth for both the admin
 * upload UI (recommended-size copy, dimension-mismatch warnings) and any future server-side
 * validation. These are not arbitrary: they were derived by measuring the actual rendered public
 * carousel (`MarketplaceCarousel`, used by both `MARKETPLACE_PRIMARY` and `MARKETPLACE_INLINE`),
 * which renders inside a `mx-auto max-w-7xl px-4 sm:px-6` container at a fixed `h-56` (224px)
 * slide height on every breakpoint (the height never changes responsively, only the width does):
 *   - Desktop: container caps at max-w-7xl (1280px) minus sm:px-6 padding (48px) = 1232px wide,
 *     at the session's standard 1440px+ desktop test viewport → 1232 / 224 ≈ 5.5:1.
 *   - Mobile: at the session's standard 390px test viewport, minus px-4 padding (32px) = 358px
 *     wide → 358 / 224 ≈ 1.6:1.
 * Recommended dimensions below preserve those exact measured ratios at a comfortable
 * higher-than-1x resolution so the background-cover image stays sharp without ever needing to be
 * stretched or distorted (`bg-cover` crops to fit; it never stretches).
 *
 * `DEVELOPMENT_FEATURED`/`PROFESSIONAL_FEATURED`/`SEARCH_FEATURED` are image-capable
 * (`MarketplaceBanner` supports `desktopMediaUrl`/`mobileMediaUrl` for them) but that component
 * has no live public page rendering it yet in this codebase — `measured: false` flags these as a
 * provisional placeholder using the one real measured spec, not a second independently-measured
 * ratio, so this should be re-measured once one of those placements actually ships a public page.
 * `HOMEPAGE_ANNOUNCEMENT` has no creative image at all — it renders as a plain text/color bar
 * (`homepage-announcement-bar.tsx` never reads `desktopMediaUrl`/`mobileMediaUrl`) — so it has no
 * entry here at all, and the admin upload UI must not offer a creative section for it.
 */
export const PLACEMENT_CREATIVE_SPECS: Partial<Record<$Enums.CampaignPlacement, PlacementCreativeSpec>> = {
  MARKETPLACE_PRIMARY: { desktop: { width: 1600, height: 290 }, mobile: { width: 800, height: 500 }, measured: true },
  MARKETPLACE_INLINE: { desktop: { width: 1600, height: 290 }, mobile: { width: 800, height: 500 }, measured: true },
  DEVELOPMENT_FEATURED: { desktop: { width: 1600, height: 290 }, mobile: { width: 800, height: 500 }, measured: false },
  PROFESSIONAL_FEATURED: { desktop: { width: 1600, height: 290 }, mobile: { width: 800, height: 500 }, measured: false },
  SEARCH_FEATURED: { desktop: { width: 1600, height: 290 }, mobile: { width: 800, height: 500 }, measured: false },
};

/** Reduces a width/height pair to a short human-readable ratio label, e.g. "5.5:1" or "1.6:1". */
export function aspectRatioLabel({ width, height }: CreativeDimension): string {
  const ratio = width / height;
  return `${Math.round(ratio * 10) / 10}:1`;
}

/** How far off a selected image's dimensions are from the recommended spec, expressed as the
 * aspect-ratio delta — used to decide whether to warn, not to block the upload outright. */
export function dimensionMismatch(selected: CreativeDimension, recommended: CreativeDimension): boolean {
  const selectedRatio = selected.width / selected.height;
  const recommendedRatio = recommended.width / recommended.height;
  return Math.abs(selectedRatio - recommendedRatio) / recommendedRatio > 0.15;
}
