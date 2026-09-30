import { selectCampaignCreative } from "@/modules/campaigns/eligibility";

export type CampaignCreativeData = {
  id: string;
  headline: string;
  destinationUrl: string | null;
  desktopMediaUrl: string | null;
  mobileMediaUrl: string | null;
};

/** A campaign can only be shown when artwork was uploaded: the image is the whole ad. */
export const hasCampaignArtwork = (campaign: Pick<CampaignCreativeData, "desktopMediaUrl" | "mobileMediaUrl">) => Boolean(campaign.desktopMediaUrl || campaign.mobileMediaUrl);

// Upload canvases (see `modules/campaigns/creative-spec.ts`): desktop 1600 × 220, mobile web 800 × 320.
const DESKTOP_ASPECT = "sm:aspect-[80/11]";
const DESKTOP_ASPECT_FROM_MOBILE_ART = "sm:aspect-[5/2]";
const MOBILE_ASPECT = "aspect-[5/2]";
const MOBILE_ASPECT_FROM_DESKTOP_ART = "aspect-[80/11]";

/**
 * A campaign's uploaded artwork, shown exactly as uploaded: the creative is the complete ad.
 * Nothing is drawn over it: no overlay, gradient, tint, label, headline or button. The mobile
 * artwork (800 × 320) is used on small screens and the desktop artwork (1600 × 220) from `sm` up,
 * each in a box of its own aspect ratio with `object-contain`, so the whole image is visible,
 * undistorted and uncropped, and the layout doesn't jump while it loads. If one size wasn't
 * uploaded, the other is shown at its own proportions.
 *
 * With a destination the whole banner is the link. The headline is the accessible name (link
 * label and image alt text) and is never drawn; no "Promoted"/"Sponsored" label is added.
 */
export function CampaignCreative({ campaign, onClick, priority = false }: { campaign: CampaignCreativeData; onClick?: () => void; priority?: boolean }) {
  const desktopArt = selectCampaignCreative(campaign, "desktopWeb");
  const mobileArt = selectCampaignCreative(campaign, "mobileWeb");
  if (!desktopArt && !mobileArt) return null;

  const mobileIsDesktopArt = !campaign.mobileMediaUrl;
  const desktopIsMobileArt = !campaign.desktopMediaUrl;
  const aspect = `${mobileIsDesktopArt ? MOBILE_ASPECT_FROM_DESKTOP_ART : MOBILE_ASPECT} ${desktopIsMobileArt ? DESKTOP_ASPECT_FROM_MOBILE_ART : DESKTOP_ASPECT}`;

  const picture = (
    <picture className="block h-full w-full">
      {desktopArt && desktopArt !== mobileArt ? <source media="(min-width: 640px)" srcSet={desktopArt} /> : null}
      <img
        alt={campaign.headline}
        className="block h-full w-full object-contain"
        decoding="async"
        draggable={false}
        fetchPriority={priority ? "high" : undefined}
        loading={priority ? "eager" : "lazy"}
        src={mobileArt ?? desktopArt ?? undefined}
      />
    </picture>
  );

  if (!campaign.destinationUrl) {
    return (
      <div aria-roledescription="slide" className={`relative block w-full ${aspect}`} data-testid="campaign-creative" role="group">
        {picture}
      </div>
    );
  }

  return (
    <a
      aria-label={campaign.headline}
      aria-roledescription="slide"
      className={`relative block w-full cursor-pointer ${aspect} focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-soft`}
      data-testid="campaign-creative"
      href={campaign.destinationUrl}
      onClick={onClick}
      rel="noopener"
    >
      {picture}
    </a>
  );
}
