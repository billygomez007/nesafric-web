import type { PlatformPrincipal, $Enums } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { PLATFORM_PERMISSIONS, platformRoleHasPermission, type PlatformPermission } from "@/platform/platform-admin/permissions";
import { recordPlatformAudit } from "@/modules/platform-admin/service";
import { requireMarketplaceRole } from "@/modules/marketplace-professionals/permissions";
import { assertMarketplaceOperational } from "@/modules/marketplace-professionals/entitlements";
import { MARKETPLACE_ENTITLEMENTS } from "@/modules/marketplace-professionals/catalog";
import {
  createSelfServiceCampaignSchema,
  createPlatformCampaignSchema,
  updatePlatformCampaignSchema,
  reviewCampaignSchema,
  scheduleCampaignSchema,
  setCampaignStatusSchema,
  publicBannerQuerySchema,
  publicBannerListQuerySchema,
  campaignListSchema,
} from "./schemas";

function requirePermission(principal: PlatformPrincipal, permission: PlatformPermission) {
  if (!platformRoleHasPermission(principal.role, permission)) throw new AppError("FORBIDDEN", 403, "You do not have permission to manage campaigns.");
}

/** Item 22's "request/submission readiness" entitlement gate: which existing marketplace
 * entitlement key applies to a given self-service placement. Deliberately reuses the
 * already-defined `promotedListingsEnabled`/`featuredProfileEnabled` keys — no new entitlement
 * keys were needed for this. */
const PLACEMENT_ENTITLEMENT: Record<string, string> = {
  MARKETPLACE_INLINE: MARKETPLACE_ENTITLEMENTS.promotedListingsEnabled.key,
  SEARCH_FEATURED: MARKETPLACE_ENTITLEMENTS.promotedListingsEnabled.key,
  DEVELOPMENT_FEATURED: MARKETPLACE_ENTITLEMENTS.promotedListingsEnabled.key,
  PROFESSIONAL_FEATURED: MARKETPLACE_ENTITLEMENTS.featuredProfileEnabled.key,
};

const safePublicFields = {
  id: true, placement: true, headline: true, supportingText: true, ctaLabel: true, destinationUrl: true,
  desktopMediaUrl: true, mobileMediaUrl: true,
} as const;

function isLive(campaign: { status: string; startAt: Date | null; endAt: Date | null }, now = new Date()) {
  if (!["APPROVED", "SCHEDULED", "ACTIVE"].includes(campaign.status)) return false;
  if (campaign.startAt && campaign.startAt > now) return false;
  if (campaign.endAt && campaign.endAt < now) return false;
  return true;
}

/** Self-service campaign submission by a marketplace professional (item 22) — always starts as a
 * DRAFT request; it never goes live without platform review (item 21). */
export async function createCampaign(userId: string, marketplaceProfessionalId: string, input: unknown) {
  await requireMarketplaceRole(userId, marketplaceProfessionalId, "ADMIN");
  const data = createSelfServiceCampaignSchema.parse(input);
  const entitlementKey = PLACEMENT_ENTITLEMENT[data.placement];
  if (entitlementKey) await assertMarketplaceOperational(marketplaceProfessionalId, entitlementKey);
  return db.campaign.create({
    data: { ...data, isPlatformOwned: false, advertiserMarketplaceProfessionalId: marketplaceProfessionalId, createdByUserId: userId, status: "DRAFT" },
  });
}

export async function submitCampaignForApproval(userId: string, marketplaceProfessionalId: string, campaignId: string) {
  await requireMarketplaceRole(userId, marketplaceProfessionalId, "ADMIN");
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, advertiserMarketplaceProfessionalId: marketplaceProfessionalId } });
  if (!campaign) throw notFound();
  if (campaign.status !== "DRAFT") throw new AppError("INVALID_CAMPAIGN_STATE", 409, "Only a draft campaign may be submitted for approval.");
  return db.campaign.update({ where: { id: campaignId }, data: { status: "PENDING_APPROVAL" } });
}

export async function listMarketplaceProfessionalCampaigns(userId: string, marketplaceProfessionalId: string) {
  await requireMarketplaceRole(userId, marketplaceProfessionalId, "AGENT");
  return db.campaign.findMany({ where: { advertiserMarketplaceProfessionalId: marketplaceProfessionalId }, orderBy: { createdAt: "desc" } });
}

/** NesAfric-owned campaigns — homepage announcements and platform-curated marketplace placements
 * (item 18/19) — created directly by a platform administrator, never through self-service. */
export async function createPlatformCampaign(principal: PlatformPrincipal, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.campaignReview);
  const data = createPlatformCampaignSchema.parse(input);
  if (data.advertiserServiceProviderId) {
    const provider = await db.serviceProvider.findUnique({ where: { id: data.advertiserServiceProviderId }, select: { id: true } });
    if (!provider) throw notFound();
  }
  const status = data.startAt || data.endAt ? "SCHEDULED" : "APPROVED";
  const campaign = await db.campaign.create({ data: { ...data, isPlatformOwned: true, createdByUserId: principal.userId, reviewedByUserId: principal.userId, reviewedAt: new Date(), status } });
  await recordPlatformAudit(principal, "platform_admin.campaign_created", "campaign", campaign.id, undefined, { name: campaign.name, placement: campaign.placement, type: campaign.type, status: campaign.status });
  return campaign;
}

/** Edits a platform-owned campaign's descriptive content (Phase 24 "Edit") — deliberately never
 * touches `status`/`priority`/`startAt`/`endAt`/media (those have their own dedicated, more
 * carefully guarded actions below) or a self-service campaign (those belong to their advertiser). */
export async function updatePlatformCampaign(principal: PlatformPrincipal, campaignId: string, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.campaignReview);
  const data = updatePlatformCampaignSchema.parse(input);
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw notFound();
  if (!campaign.isPlatformOwned) throw new AppError("FORBIDDEN", 403, "Only platform-owned campaigns may be edited here.");
  if (data.advertiserServiceProviderId) {
    const provider = await db.serviceProvider.findUnique({ where: { id: data.advertiserServiceProviderId }, select: { id: true } });
    if (!provider) throw notFound();
  }
  const updated = await db.campaign.update({ where: { id: campaignId }, data });
  await recordPlatformAudit(principal, "platform_admin.campaign_edited", "campaign", campaignId, undefined, { fields: Object.keys(data) });
  return updated;
}

/** Duplicates a campaign as a new DRAFT (Phase 24 "Duplicate") — copies content/placement/targeting
 * but never status, schedule, or analytics counters, so a duplicate always starts from a clean,
 * explicitly-reviewed state rather than silently going live or inheriting another campaign's stats. */
export async function duplicateCampaign(principal: PlatformPrincipal, campaignId: string) {
  requirePermission(principal, PLATFORM_PERMISSIONS.campaignReview);
  const source = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!source) throw notFound();
  const copy = await db.campaign.create({
    data: {
      name: `${source.name} (copy)`,
      placement: source.placement,
      type: source.type,
      headline: source.headline,
      supportingText: source.supportingText,
      ctaLabel: source.ctaLabel,
      destinationUrl: source.destinationUrl,
      desktopMediaUrl: source.desktopMediaUrl,
      mobileMediaUrl: source.mobileMediaUrl,
      countryCode: source.countryCode,
      region: source.region,
      isPlatformOwned: source.isPlatformOwned,
      advertiserMarketplaceProfessionalId: source.advertiserMarketplaceProfessionalId,
      advertiserServiceProviderId: source.advertiserServiceProviderId,
      createdByUserId: principal.userId,
      status: "DRAFT",
    },
  });
  await recordPlatformAudit(principal, "platform_admin.campaign_duplicated", "campaign", copy.id, undefined, { sourceCampaignId: source.id });
  return copy;
}

export async function listCampaignsForPlatform(principal: PlatformPrincipal, query: unknown = {}) {
  requirePermission(principal, PLATFORM_PERMISSIONS.campaignReview);
  const filters = campaignListSchema.parse(query);
  const where = { ...(filters.status ? { status: filters.status } : {}), ...(filters.placement ? { placement: filters.placement } : {}) };
  const [items, total] = await db.$transaction([
    db.campaign.findMany({
      where,
      include: {
        advertiser: { select: { displayName: true, slug: true } },
        advertiserProvider: { select: { displayName: true, slug: true, verificationStatus: true } },
      },
      orderBy: [{ createdAt: "desc" }], skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize,
    }),
    db.campaign.count({ where }),
  ]);
  return { items, total, page: filters.page, pageSize: filters.pageSize };
}

export async function getCampaignForPlatform(principal: PlatformPrincipal, campaignId: string) {
  requirePermission(principal, PLATFORM_PERMISSIONS.campaignReview);
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: {
      advertiser: { select: { displayName: true, slug: true } },
      advertiserProvider: { select: { displayName: true, slug: true, verificationStatus: true } },
    },
  });
  if (!campaign) throw notFound();
  return campaign;
}

/** Platform review of a self-service submission (item 21). Never available for `isPlatformOwned`
 * campaigns, which are already platform-authored. */
export async function reviewCampaign(principal: PlatformPrincipal, campaignId: string, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.campaignReview);
  const data = reviewCampaignSchema.parse(input);
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw notFound();
  if (campaign.status !== "PENDING_APPROVAL") throw new AppError("INVALID_CAMPAIGN_STATE", 409, "Only a campaign pending approval may be reviewed.");
  if (data.status === "REJECTED" && !data.reason) throw new AppError("VALIDATION_ERROR", 400, "A reason is required to reject a campaign.");
  const reviewed = await db.campaign.update({
    where: { id: campaignId },
    data: { status: data.status, reviewedByUserId: principal.userId, reviewedAt: new Date(), rejectionReason: data.status === "REJECTED" ? data.reason : null },
  });
  await recordPlatformAudit(principal, "platform_admin.campaign_reviewed", "campaign", campaignId, undefined, { status: data.status, reason: data.reason ?? null });
  return reviewed;
}

export async function scheduleCampaign(principal: PlatformPrincipal, campaignId: string, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.campaignReview);
  const data = scheduleCampaignSchema.parse(input);
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw notFound();
  if (!["APPROVED", "SCHEDULED"].includes(campaign.status)) throw new AppError("INVALID_CAMPAIGN_STATE", 409, "Only an approved campaign may be scheduled.");
  const scheduled = await db.campaign.update({ where: { id: campaignId }, data: { ...data, status: "SCHEDULED" } });
  await recordPlatformAudit(principal, "platform_admin.campaign_scheduled", "campaign", campaignId, undefined, { startAt: scheduled.startAt, endAt: scheduled.endAt });
  return scheduled;
}

/** Pause/resume/complete/archive (item 21's "pause", "change priority", "archive"). Financial or
 * approval decisions are never automated here — every transition is an explicit admin action. */
export async function setCampaignStatus(principal: PlatformPrincipal, campaignId: string, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.campaignReview);
  const data = setCampaignStatusSchema.parse(input);
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw notFound();
  const allowed: Record<string, string[]> = {
    PAUSED: ["SCHEDULED", "ACTIVE"],
    ACTIVE: ["PAUSED", "SCHEDULED", "APPROVED"],
    COMPLETED: ["ACTIVE", "PAUSED", "SCHEDULED"],
    ARCHIVED: ["COMPLETED", "REJECTED", "PAUSED", "DRAFT"],
  };
  if (!allowed[data.status]?.includes(campaign.status)) throw new AppError("INVALID_CAMPAIGN_TRANSITION", 409, `A campaign cannot move from ${campaign.status} to ${data.status}.`);
  const updated = await db.campaign.update({ where: { id: campaignId }, data: { status: data.status, archivedAt: data.status === "ARCHIVED" ? new Date() : campaign.archivedAt } });
  await recordPlatformAudit(principal, "platform_admin.campaign_status_changed", "campaign", campaignId, undefined, { from: campaign.status, to: data.status });
  return updated;
}

/** Shared eligibility filter behind both `getPublicBanner` and `getPublicBanners` — a campaign is
 * publicly eligible only while live (`APPROVED`/`SCHEDULED`/`ACTIVE`, i.e. never `DRAFT`,
 * `PENDING_APPROVAL`, `REJECTED`, `PAUSED`, `COMPLETED`, or `ARCHIVED`), never archived, within its
 * scheduling window, and — when a viewer country is supplied — either untargeted or matching it. */
const LIVE_STATUSES: $Enums.CampaignStatus[] = ["APPROVED", "SCHEDULED", "ACTIVE"];

function eligibleCampaignWhere(placement: $Enums.CampaignPlacement, countryCode: string | undefined, now: Date) {
  return {
    placement,
    status: { in: LIVE_STATUSES },
    archivedAt: null,
    AND: [
      { OR: [{ startAt: null }, { startAt: { lte: now } }] },
      { OR: [{ endAt: null }, { endAt: { gte: now } }] },
      ...(countryCode ? [{ OR: [{ countryCode: null }, { countryCode }] }] : []),
      // A campaign promoting a specific Property Service Professional can never make an
      // unverified provider publicly visible — this is a hard query-level gate, not an
      // admin-diligence convention, matching how `safeHttpUrl` is enforced at the schema
      // boundary rather than relying on review discipline alone.
      { OR: [{ advertiserServiceProviderId: null }, { advertiserProvider: { is: { verificationStatus: "VERIFIED" as const } } }] },
    ],
  };
}

/**
 * Public banner projection (items 18/19/24) — the single best-priority campaign currently live
 * for a placement, filtered by country when supplied. Never exposes `advertiserMarketplaceProfessionalId`,
 * `createdByUserId`, impression/click counters, or review metadata (item 26 "safe public
 * projections"). Item 24: `HOMEPAGE_ANNOUNCEMENT` only ever resolves NesAfric-owned campaigns —
 * self-service campaigns can never target that placement (enforced at creation, not just here).
 */
export async function getPublicBanner(query: unknown) {
  const { placement, countryCode } = publicBannerQuerySchema.parse(query);
  const candidates = await db.campaign.findMany({
    where: eligibleCampaignWhere(placement, countryCode, new Date()),
    select: safePublicFields,
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    take: 1,
  });
  return candidates[0] ?? null;
}

/** Public multi-campaign projection for a sliding/carousel placement — same eligibility rule as
 * `getPublicBanner`, but returns up to `limit` campaigns ordered by priority for a caller to
 * rotate through, instead of only the single best match. */
export async function getPublicBanners(query: unknown) {
  const { placement, countryCode, limit } = publicBannerListQuerySchema.parse(query);
  return db.campaign.findMany({
    where: eligibleCampaignWhere(placement, countryCode, new Date()),
    select: safePublicFields,
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
}

export async function recordCampaignImpression(campaignId: string) {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId }, select: { status: true, startAt: true, endAt: true } });
  if (!campaign || !isLive(campaign)) throw notFound();
  await db.campaign.update({ where: { id: campaignId }, data: { impressionCount: { increment: 1 } } });
}

export async function recordCampaignClick(campaignId: string) {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId }, select: { status: true, startAt: true, endAt: true } });
  if (!campaign || !isLive(campaign)) throw notFound();
  await db.campaign.update({ where: { id: campaignId }, data: { clickCount: { increment: 1 } } });
}
