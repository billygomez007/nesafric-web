/**
 * Campaign eligibility and creative selection: the single definition of when a campaign may appear
 * in a public placement and which artwork each surface shows.
 *
 * The public query (`eligibleCampaignWhere` in `service.ts`) applies the same rules in SQL; this
 * module evaluates them for one campaign so the Super Admin list can say *why* a campaign is not
 * showing. Web and the native app both read `GET /api/public/campaigns`, so neither client
 * re-implements these rules — they only choose which of the returned creatives to render, using
 * `selectCampaignCreative`.
 */

/** Statuses in which a campaign can be public (still subject to its schedule window). */
export const LIVE_CAMPAIGN_STATUSES = ["APPROVED", "SCHEDULED", "ACTIVE"] as const;

/** What each public placement is on the site and in the app. */
export const PLACEMENT_SURFACES: Record<string, string> = {
  HOMEPAGE_ANNOUNCEMENT: "Homepage announcement bar (web)",
  MARKETPLACE_PRIMARY: "Homepage advertising carousel (web and app)",
  MARKETPLACE_INLINE: "Property Marketplace advertising carousel (web and app)",
  SERVICE_MARKETPLACE_PRIMARY: "Service Marketplace advertising carousel (web and app)",
  PROFESSIONAL_FEATURED: "Professional directory banner (web)",
  DEVELOPMENT_FEATURED: "Development feature (not yet shown publicly)",
  SEARCH_FEATURED: "Search results feature (not yet shown publicly)",
};

/** Placements with a public renderer today. The others can be prepared but never appear. */
const RENDERED_PLACEMENTS = new Set(["HOMEPAGE_ANNOUNCEMENT", "MARKETPLACE_PRIMARY", "MARKETPLACE_INLINE", "SERVICE_MARKETPLACE_PRIMARY", "PROFESSIONAL_FEATURED"]);

export type CampaignSurface = "desktopWeb" | "mobileWeb" | "nativeApp";

type Creative = { desktopMediaUrl: string | null; mobileMediaUrl: string | null; nativeAppMediaUrl?: string | null };

/**
 * The artwork a surface shows, following the creative specification the Super Admin upload form
 * states: desktop web uses the desktop creative, else mobile web (shown at its own proportions);
 * mobile web uses the mobile creative, else desktop; the native app uses the native creative, else
 * mobile web, else desktop. The uploaded artwork is the whole ad: `null` means the campaign is not
 * shown on that surface at all — there is no text-only substitute.
 */
export function selectCampaignCreative(campaign: Creative, surface: CampaignSurface): string | null {
  if (surface === "desktopWeb") return campaign.desktopMediaUrl ?? campaign.mobileMediaUrl ?? null;
  if (surface === "mobileWeb") return campaign.mobileMediaUrl ?? campaign.desktopMediaUrl ?? null;
  return campaign.nativeAppMediaUrl ?? campaign.mobileMediaUrl ?? campaign.desktopMediaUrl ?? null;
}

/**
 * The creative fields that can put a campaign on screen in a placement. The homepage announcement
 * bar is text by design and needs none; web-only placements need desktop or mobile web artwork; the
 * homepage carousel, shown on web and in the app, can show any of the three. The public query and
 * the Super Admin status both use this, so an artless campaign never takes a slot from one that
 * can actually be shown, and is never reported as showing.
 */
export function placementArtworkFields(placement: string): ("desktopMediaUrl" | "mobileMediaUrl" | "nativeAppMediaUrl")[] {
  if (placement === "HOMEPAGE_ANNOUNCEMENT") return [];
  if (placement === "MARKETPLACE_PRIMARY" || placement === "SERVICE_MARKETPLACE_PRIMARY") return ["desktopMediaUrl", "mobileMediaUrl", "nativeAppMediaUrl"];
  return ["desktopMediaUrl", "mobileMediaUrl"];
}

export function hasPlacementArtwork(campaign: Creative & { placement: string }) {
  const fields = placementArtworkFields(campaign.placement);
  return fields.length === 0 || fields.some((field) => Boolean(campaign[field]?.trim()));
}

export type CreativeReadiness = {
  /** Artwork each surface will show, and whether it is the slot's own or a fallback. */
  surfaces: Record<CampaignSurface, { url: string | null; source: "own" | "fallback" | "none" }>;
  /** A short admin-facing note, or null when every surface has its own artwork. */
  note: string | null;
};

export function creativeReadiness(campaign: Creative & { placement: string }): CreativeReadiness {
  const own: Record<CampaignSurface, string | null> = {
    desktopWeb: campaign.desktopMediaUrl ?? null,
    mobileWeb: campaign.mobileMediaUrl ?? null,
    nativeApp: campaign.nativeAppMediaUrl ?? null,
  };
  const surfaces = Object.fromEntries((Object.keys(own) as CampaignSurface[]).map((surface) => {
    const url = selectCampaignCreative(campaign, surface);
    return [surface, { url, source: own[surface] ? "own" : url ? "fallback" : "none" }];
  })) as CreativeReadiness["surfaces"];

  if (campaign.placement === "HOMEPAGE_ANNOUNCEMENT") return { surfaces, note: null };
  const names: Record<CampaignSurface, string> = { desktopWeb: "desktop web", mobileWeb: "mobile web", nativeApp: "app" };
  const all = Object.keys(surfaces) as CampaignSurface[];
  if (!hasPlacementArtwork(campaign)) return { surfaces, note: "No artwork: not shown anywhere until artwork is uploaded." };
  const hidden = all.filter((surface) => surfaces[surface].source === "none");
  if (hidden.length > 0) return { surfaces, note: `No artwork for ${hidden.map((surface) => names[surface]).join(" or ")}: not shown there.` };
  const missing = all.filter((surface) => surfaces[surface].source !== "own");
  if (missing.length === 0) return { surfaces, note: null };
  return { surfaces, note: `No own ${missing.map((surface) => names[surface]).join(" or ")} artwork: uses the next available creative.` };
}

type EligibilityInput = Partial<Creative> & {
  status: string;
  placement: string;
  startAt: Date | string | null;
  endAt: Date | string | null;
  archivedAt: Date | string | null;
  countryCode?: string | null;
  advertiserServiceProviderId?: string | null;
  advertiserProvider?: { verificationStatus: string; suspendedAt?: Date | string | null } | null;
  advertiserMarketplaceProfessionalId?: string | null;
  advertiser?: { status?: string; archivedAt?: Date | string | null } | null;
};

export type CampaignEligibility = { eligible: true; reason: null } | { eligible: false; reason: string };

const STATUS_REASONS: Record<string, string> = {
  DRAFT: "Draft — publish it to go live",
  PENDING_APPROVAL: "Waiting for approval",
  REJECTED: "Rejected",
  PAUSED: "Paused",
  COMPLETED: "Ended",
  ARCHIVED: "Archived",
};

function toDate(value: Date | string | null | undefined) {
  return value ? new Date(value) : null;
}

function describeDay(date: Date, now: Date) {
  const day = (value: Date) => Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  const days = Math.round((day(date) - day(now)) / 86_400_000);
  const time = date.toISOString().slice(11, 16);
  if (days === 0) return `today at ${time} UTC`;
  if (days === 1) return `tomorrow at ${time} UTC`;
  return `${date.toISOString().slice(0, 10)} at ${time} UTC`;
}

/**
 * Whether a campaign is showing in its placement right now, and if not, the first reason why.
 * `countryCode` is the viewer country the public carousels request (Ghana); a campaign targeted at
 * another country is live but not shown to them.
 */
export function campaignEligibility(campaign: EligibilityInput, now = new Date(), viewerCountryCode: string | null = "GH"): CampaignEligibility {
  if (campaign.archivedAt || campaign.status === "ARCHIVED") return { eligible: false, reason: STATUS_REASONS.ARCHIVED };
  if (!(LIVE_CAMPAIGN_STATUSES as readonly string[]).includes(campaign.status)) {
    return { eligible: false, reason: STATUS_REASONS[campaign.status] ?? `Status ${campaign.status}` };
  }
  const startAt = toDate(campaign.startAt);
  const endAt = toDate(campaign.endAt);
  if (startAt && startAt > now) return { eligible: false, reason: `Starts ${describeDay(startAt, now)}` };
  if (endAt && endAt < now) return { eligible: false, reason: "Expired — its end date has passed" };
  if (viewerCountryCode && campaign.countryCode && campaign.countryCode !== viewerCountryCode) {
    return { eligible: false, reason: `Targeted at ${campaign.countryCode} only` };
  }
  if (campaign.advertiserServiceProviderId) {
    const provider = campaign.advertiserProvider;
    if (!provider || provider.verificationStatus !== "VERIFIED") return { eligible: false, reason: "Advertised provider is not verified" };
    if (provider.suspendedAt) return { eligible: false, reason: "Advertised provider is suspended" };
  }
  if (campaign.advertiserMarketplaceProfessionalId) {
    const advertiser = campaign.advertiser;
    if (!advertiser || advertiser.status !== "ACTIVE" || advertiser.archivedAt) return { eligible: false, reason: "Advertiser account is not active" };
  }
  if (!RENDERED_PLACEMENTS.has(campaign.placement)) return { eligible: false, reason: "This placement is not shown publicly yet" };
  if (!hasPlacementArtwork({ desktopMediaUrl: campaign.desktopMediaUrl ?? null, mobileMediaUrl: campaign.mobileMediaUrl ?? null, nativeAppMediaUrl: campaign.nativeAppMediaUrl ?? null, placement: campaign.placement })) {
    return { eligible: false, reason: "No artwork uploaded — only the uploaded creative is shown" };
  }
  return { eligible: true, reason: null };
}
