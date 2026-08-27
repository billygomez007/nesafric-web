import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const id = z.string().uuid();

/** Placements a marketplace professional may self-service request (item 22). The homepage
 * announcement bar and the platform-curated `MARKETPLACE_PRIMARY` slot are NesAfric-owned only. */
export const SELF_SERVICE_PLACEMENTS = ["MARKETPLACE_INLINE", "DEVELOPMENT_FEATURED", "PROFESSIONAL_FEATURED", "SEARCH_FEATURED"] as const;
export const ALL_PLACEMENTS = ["HOMEPAGE_ANNOUNCEMENT", "MARKETPLACE_PRIMARY", ...SELF_SERVICE_PLACEMENTS] as const;

/** Only `http:`/`https:` may ever reach a public banner's `href` or `background-image` — rejects
 * `javascript:`, `data:`, `vbscript:`, and every other scheme regardless of who authored the
 * campaign (self-service submissions are platform-reviewed, but this is enforced at the schema
 * boundary so it can never depend on review diligence alone). */
const safeHttpUrl = (max: number) =>
  z.string().trim().max(max).refine((value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "Must be an absolute http:// or https:// URL");

const campaignFields = {
  name: text(200),
  headline: text(200),
  supportingText: z.string().trim().max(500).optional(),
  ctaLabel: text(60).optional(),
  destinationUrl: safeHttpUrl(2000),
  desktopMediaUrl: safeHttpUrl(2000).optional(),
  mobileMediaUrl: safeHttpUrl(2000).optional(),
  countryCode: z.string().length(2).toUpperCase().optional(),
  region: text(120).optional(),
};

export const createSelfServiceCampaignSchema = z.object({
  placement: z.enum(SELF_SERVICE_PLACEMENTS),
  ...campaignFields,
}).strict();

export const createPlatformCampaignSchema = z.object({
  placement: z.enum(ALL_PLACEMENTS),
  ...campaignFields,
  priority: z.coerce.number().int().min(0).max(1000).default(0),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
}).strict();

export const reviewCampaignSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().max(2000).optional(),
}).strict();

export const scheduleCampaignSchema = z.object({
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  priority: z.coerce.number().int().min(0).max(1000).optional(),
}).strict().refine((value) => value.endAt > value.startAt, "endAt must be after startAt");

export const setCampaignStatusSchema = z.object({
  status: z.enum(["PAUSED", "ACTIVE", "COMPLETED", "ARCHIVED"]),
}).strict();

export const publicBannerQuerySchema = z.object({
  placement: z.enum(ALL_PLACEMENTS),
  countryCode: z.string().length(2).toUpperCase().optional(),
}).strict();

/** Multi-campaign projection for a sliding/carousel placement — same eligibility inputs as
 * `publicBannerQuerySchema`, plus a capped `limit` so a carousel can never request an unbounded
 * page of campaigns. */
export const publicBannerListQuerySchema = z.object({
  placement: z.enum(ALL_PLACEMENTS),
  countryCode: z.string().length(2).toUpperCase().optional(),
  limit: z.coerce.number().int().min(1).max(10).default(6),
}).strict();

export const campaignListSchema = z.object({
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "ACTIVE", "PAUSED", "COMPLETED", "REJECTED", "ARCHIVED"]).optional(),
  placement: z.enum(ALL_PLACEMENTS).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export { id, text };
