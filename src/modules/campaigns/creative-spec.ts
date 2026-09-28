import type { $Enums } from "@/platform/database/generated/client";

export type CreativeDimension = { width: number; height: number };
export type PlacementCreativeSpec = { desktop: CreativeDimension; mobile: CreativeDimension; nativeApp: CreativeDimension; measured: boolean };

/**
 * Canonical upload canvases for image-capable campaign placements.
 *
 * The public web marketplace carousel now uses the compact responsive
 * `h-36 sm:h-40 lg:h-44` compact responsive treatment.
 * Its rendered width changes continuously with the viewport,
 * so there is no single exact web aspect ratio at every breakpoint.
 *
 * Stable production upload canvases:
 *   - Desktop web: 1600 x 220 (~7.3:1)
 *   - Mobile web: 800 x 320 (2.5:1)
 *   - Native mobile app: 1200 x 480 (2.5:1)
 *
 * Public web artwork uses cover-style rendering. Keep important logos,
 * text and subjects in a safe central area so responsive edge cropping
 * does not remove critical content.
 *
 * Native app geometry is measured from the Expo carousel: `cardHeight = cardWidth * 0.4`
 * (`NATIVE_CAMPAIGN_ASPECT` in `mobile/src/home/featured.ts`). Artwork is always drawn with
 * `contentFit="contain"`, so an older 1200 x 792 native upload still shows whole and undistorted:
 * it is centred with plain side margins in the card's neutral surface, never cropped or stretched.
 *
 * MARKETPLACE_PRIMARY and MARKETPLACE_INLINE are live measured placements.
 * DEVELOPMENT_FEATURED, PROFESSIONAL_FEATURED and SEARCH_FEATURED remain
 * provisional until their final public renderers are independently measured.
 *
 * HOMEPAGE_ANNOUNCEMENT is text-only and intentionally has no image spec.
 */
export const PLACEMENT_CREATIVE_SPECS: Partial<Record<$Enums.CampaignPlacement, PlacementCreativeSpec>> = {
  MARKETPLACE_PRIMARY: { desktop: { width: 1600, height: 220 }, mobile: { width: 800, height: 320 }, nativeApp: { width: 1200, height: 480 }, measured: true },
  MARKETPLACE_INLINE: { desktop: { width: 1600, height: 220 }, mobile: { width: 800, height: 320 }, nativeApp: { width: 1200, height: 480 }, measured: true },
  DEVELOPMENT_FEATURED: { desktop: { width: 1600, height: 220 }, mobile: { width: 800, height: 320 }, nativeApp: { width: 1200, height: 480 }, measured: false },
  PROFESSIONAL_FEATURED: { desktop: { width: 1600, height: 220 }, mobile: { width: 800, height: 320 }, nativeApp: { width: 1200, height: 480 }, measured: false },
  SEARCH_FEATURED: { desktop: { width: 1600, height: 220 }, mobile: { width: 800, height: 320 }, nativeApp: { width: 1200, height: 480 }, measured: false },
};

/** Native-app canvas for any placement without its own spec. */
export const NATIVE_APP_FALLBACK_SPEC: CreativeDimension = { width: 1200, height: 480 };

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
