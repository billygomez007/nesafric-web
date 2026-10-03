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

// Web campaign creatives use a compact responsive frame rather than forcing the
// upload canvas aspect ratio onto the page. Artwork fills the frame with cover;
// important campaign content should remain inside the upload safe area.
const WEB_FRAME = "h-36 sm:h-40 lg:h-44";

/**
 * A campaign's uploaded artwork is the complete ad.
 * Nothing is drawn over it: no overlay, gradient, tint, label, headline or button. The mobile
 * artwork is used on small screens and the desktop artwork from `sm` up. Web placements use
 * the canonical compact responsive frame from `creative-spec.ts` and `object-cover` so the
 * advertising surface is filled edge-to-edge without letterboxing. Upload creatives should
 * keep important text, logos and subjects inside the safe central area.
 *
 * With a destination the whole banner is the link. The headline is the accessible name (link
 * label and image alt text) and is never drawn; no "Promoted"/"Sponsored" label is added.
 */
export function CampaignCreative({ campaign, onClick, priority = false }: { campaign: CampaignCreativeData; onClick?: () => void; priority?: boolean }) {
  const desktopArt = selectCampaignCreative(campaign, "desktopWeb");
  const mobileArt = selectCampaignCreative(campaign, "mobileWeb");
  if (!desktopArt && !mobileArt) return null;

  const picture = (
    <picture className="block h-full w-full">
      {desktopArt && desktopArt !== mobileArt ? <source media="(min-width: 640px)" srcSet={desktopArt} /> : null}
      <img
        alt={campaign.headline}
        className="block h-full w-full object-cover"
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
      <div aria-roledescription="slide" className={`relative block w-full overflow-hidden ${WEB_FRAME}`} data-testid="campaign-creative" role="group">
        {picture}
      </div>
    );
  }

  return (
    <a
      aria-label={campaign.headline}
      aria-roledescription="slide"
      className={`relative block w-full cursor-pointer overflow-hidden ${WEB_FRAME} focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-soft`}
      data-testid="campaign-creative"
      href={campaign.destinationUrl}
      onClick={onClick}
      rel="noopener"
    >
      {picture}
    </a>
  );
}
