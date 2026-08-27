import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createMarketplaceProfessional, changeMarketplacePlan } from "@/modules/marketplace-professionals/service";
import {
  createCampaign,
  submitCampaignForApproval,
  listMarketplaceProfessionalCampaigns,
  createPlatformCampaign,
  listCampaignsForPlatform,
  reviewCampaign,
  scheduleCampaign,
  setCampaignStatus,
  getPublicBanner,
  getPublicBanners,
  recordCampaignImpression,
  recordCampaignClick,
} from "@/modules/campaigns/service";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
  await db.marketplacePlan.deleteMany({ where: { key: { notIn: ["marketplace_free", "marketplace_pro", "marketplace_brokerage", "marketplace_enterprise"] } } });
}

async function platformAdmin() {
  const user = await registerUser({ displayName: "Campaign Admin", email: `campaign-admin-${Math.random().toString(36).slice(2)}@example.com`, password: "secure-password-123" });
  await db.platformPrincipal.create({ data: { userId: user.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
  return requirePlatformPrincipal(user);
}

const requestFields = { headline: "Feature listing", supportingText: "See it first", destinationUrl: "https://example.com/listing/1" };

describe("PostgreSQL Phase 21B campaigns & promotions", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("creates a NesAfric-owned campaign directly (approved) and rejects a self-service submission for the homepage placement", async () => {
    const principal = await platformAdmin();
    const campaign = await createPlatformCampaign(principal, { name: "Marketplace launch", placement: "HOMEPAGE_ANNOUNCEMENT", ...requestFields });
    expect(campaign.status).toBe("APPROVED");
    expect(campaign.isPlatformOwned).toBe(true);

    const owner = await registerUser({ displayName: "Agent Owner", email: "campaign-agent@example.com", password: "secure-password-123" });
    const professional = await createMarketplaceProfessional(owner.id, { type: "INDIVIDUAL_AGENT", displayName: "Campaign Agent", countryCode: "GH" });
    await expect(createCampaign(owner.id, professional.id, { placement: "HOMEPAGE_ANNOUNCEMENT", name: "Sneaky", ...requestFields })).rejects.toBeTruthy();
  });

  it("gates self-service campaign creation by the existing promoted-listings/featured-profile entitlements", async () => {
    const owner = await registerUser({ displayName: "Free Agent", email: "free-agent-campaign@example.com", password: "secure-password-123" });
    const professional = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Free Brokerage", countryCode: "GH" });

    // Marketplace Free has both promotedListingsEnabled and featuredProfileEnabled disabled.
    await expect(createCampaign(owner.id, professional.id, { placement: "SEARCH_FEATURED", name: "Boost", ...requestFields }))
      .rejects.toMatchObject({ code: "MARKETPLACE_ENTITLEMENT_FEATURE_DISABLED" });

    await changeMarketplacePlan(owner.id, professional.id, { planKey: "marketplace_pro" });
    const campaign = await createCampaign(owner.id, professional.id, { placement: "SEARCH_FEATURED", name: "Boost", ...requestFields });
    expect(campaign.status).toBe("DRAFT");
    expect(campaign.advertiserMarketplaceProfessionalId).toBe(professional.id);

    // Pro plan still doesn't include featuredProfileEnabled.
    await expect(createCampaign(owner.id, professional.id, { placement: "PROFESSIONAL_FEATURED", name: "Feature company", ...requestFields }))
      .rejects.toMatchObject({ code: "MARKETPLACE_ENTITLEMENT_FEATURE_DISABLED" });

    await changeMarketplacePlan(owner.id, professional.id, { planKey: "marketplace_brokerage" });
    await expect(createCampaign(owner.id, professional.id, { placement: "PROFESSIONAL_FEATURED", name: "Feature company", ...requestFields })).resolves.toMatchObject({ status: "DRAFT" });
  });

  it("takes a self-service campaign through submission, platform review, scheduling, and live banner projection", async () => {
    const owner = await registerUser({ displayName: "Pro Agent", email: "pro-agent-campaign@example.com", password: "secure-password-123" });
    const professional = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Pro Brokerage", countryCode: "GH" });
    await changeMarketplacePlan(owner.id, professional.id, { planKey: "marketplace_pro" });

    const draft = await createCampaign(owner.id, professional.id, { placement: "SEARCH_FEATURED", name: "Boost", ...requestFields });
    expect(draft.status).toBe("DRAFT");

    // Not yet visible publicly while a DRAFT.
    expect(await getPublicBanner({ placement: "SEARCH_FEATURED" })).toBeNull();

    const submitted = await submitCampaignForApproval(owner.id, professional.id, draft.id);
    expect(submitted.status).toBe("PENDING_APPROVAL");

    const principal = await platformAdmin();
    const reviewed = await reviewCampaign(principal, draft.id, { status: "APPROVED" });
    expect(reviewed.status).toBe("APPROVED");

    // Approved (no schedule window) is already live.
    const bannerAfterApproval = await getPublicBanner({ placement: "SEARCH_FEATURED" });
    expect(bannerAfterApproval?.id).toBe(draft.id);
    // The safe public projection never exposes the advertiser, review, or counter fields.
    expect(bannerAfterApproval).not.toHaveProperty("advertiserMarketplaceProfessionalId");
    expect(bannerAfterApproval).not.toHaveProperty("impressionCount");
    expect(bannerAfterApproval).not.toHaveProperty("status");

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const farFuture = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const scheduled = await scheduleCampaign(principal, draft.id, { startAt: future, endAt: farFuture });
    expect(scheduled.status).toBe("SCHEDULED");
    // Scheduled for the future is not yet live.
    expect(await getPublicBanner({ placement: "SEARCH_FEATURED" })).toBeNull();

    // Recording activity on a not-yet-live campaign is rejected.
    await expect(recordCampaignImpression(draft.id)).rejects.toBeTruthy();

    const immediate = await scheduleCampaign(principal, draft.id, { startAt: new Date(Date.now() - 60_000), endAt: farFuture });
    expect(immediate.status).toBe("SCHEDULED");
    const liveBanner = await getPublicBanner({ placement: "SEARCH_FEATURED" });
    expect(liveBanner?.id).toBe(draft.id);

    await recordCampaignImpression(draft.id);
    await recordCampaignImpression(draft.id);
    await recordCampaignClick(draft.id);
    const counters = await db.campaign.findUniqueOrThrow({ where: { id: draft.id } });
    expect(counters.impressionCount).toBe(2);
    expect(counters.clickCount).toBe(1);

    const paused = await setCampaignStatus(principal, draft.id, { status: "PAUSED" });
    expect(paused.status).toBe("PAUSED");
    expect(await getPublicBanner({ placement: "SEARCH_FEATURED" })).toBeNull();
  });

  it("rejects a submission with a reason, and prevents the marketplace professional from self-approving", async () => {
    const owner = await registerUser({ displayName: "Rejected Agent", email: "rejected-agent@example.com", password: "secure-password-123" });
    const professional = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Rejected Brokerage", countryCode: "GH" });
    await changeMarketplacePlan(owner.id, professional.id, { planKey: "marketplace_pro" });
    const draft = await createCampaign(owner.id, professional.id, { placement: "SEARCH_FEATURED", name: "Boost", ...requestFields });
    await submitCampaignForApproval(owner.id, professional.id, draft.id);

    const principal = await platformAdmin();
    const rejected = await reviewCampaign(principal, draft.id, { status: "REJECTED", reason: "Destination URL does not match an active listing." });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectionReason).toContain("Destination URL");

    const own = await listMarketplaceProfessionalCampaigns(owner.id, professional.id);
    expect(own.find((entry) => entry.id === draft.id)?.status).toBe("REJECTED");
  });

  it("isolates marketplace professionals' campaigns from each other, and keeps platform campaign administration unavailable to normal users", async () => {
    const ownerA = await registerUser({ displayName: "Owner A", email: "campaign-owner-a@example.com", password: "secure-password-123" });
    const ownerB = await registerUser({ displayName: "Owner B", email: "campaign-owner-b@example.com", password: "secure-password-123" });
    const professionalA = await createMarketplaceProfessional(ownerA.id, { type: "BROKERAGE", displayName: "Brokerage A", countryCode: "GH" });
    const professionalB = await createMarketplaceProfessional(ownerB.id, { type: "BROKERAGE", displayName: "Brokerage B", countryCode: "GH" });
    await changeMarketplacePlan(ownerA.id, professionalA.id, { planKey: "marketplace_pro" });

    const campaign = await createCampaign(ownerA.id, professionalA.id, { placement: "SEARCH_FEATURED", name: "A's campaign", ...requestFields });
    await expect(submitCampaignForApproval(ownerB.id, professionalB.id, campaign.id)).rejects.toBeTruthy();
    expect(await listMarketplaceProfessionalCampaigns(ownerB.id, professionalB.id)).toEqual([]);

    // A normal (non-platform-principal) marketplace owner cannot administer campaigns.
    await expect(requirePlatformPrincipal(ownerA)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("filters the homepage announcement placement to NesAfric-owned campaigns only, and lists campaigns for platform administration", async () => {
    const principal = await platformAdmin();
    const owner = await registerUser({ displayName: "Directory Agent", email: "directory-agent-campaign@example.com", password: "secure-password-123" });
    const professional = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Directory Brokerage", countryCode: "GH" });
    await changeMarketplacePlan(owner.id, professional.id, { planKey: "marketplace_pro" });

    await createPlatformCampaign(principal, { name: "Homepage notice", placement: "HOMEPAGE_ANNOUNCEMENT", ...requestFields });
    const marketplaceCampaign = await createCampaign(owner.id, professional.id, { placement: "SEARCH_FEATURED", name: "Marketplace request", ...requestFields });
    await submitCampaignForApproval(owner.id, professional.id, marketplaceCampaign.id);
    await reviewCampaign(principal, marketplaceCampaign.id, { status: "APPROVED" });

    const homepageBanner = await getPublicBanner({ placement: "HOMEPAGE_ANNOUNCEMENT" });
    expect(homepageBanner?.headline).toBe("Feature listing");
    // The marketplace professional's approved campaign never leaks into the homepage placement.
    expect(await getPublicBanner({ placement: "SEARCH_FEATURED" })).not.toBeNull();

    const allCampaigns = await listCampaignsForPlatform(principal, {});
    expect(allCampaigns.total).toBe(2);
    const pendingOnly = await listCampaignsForPlatform(principal, { status: "APPROVED" });
    expect(pendingOnly.items.every((entry) => entry.status === "APPROVED")).toBe(true);
  });

  it("projects multiple eligible campaigns for a sliding/carousel placement (getPublicBanners), ordered by priority, honoring a limit and country targeting, and excluding future, expired, paused, and archived campaigns", async () => {
    const principal = await platformAdmin();

    const untargeted = await createPlatformCampaign(principal, { name: "Untargeted", placement: "MARKETPLACE_INLINE", priority: 1, ...requestFields });
    const matchingCountry = await createPlatformCampaign(principal, { name: "Ghana targeted", placement: "MARKETPLACE_INLINE", priority: 20, countryCode: "GH", ...requestFields });
    const wrongCountry = await createPlatformCampaign(principal, { name: "Nigeria targeted", placement: "MARKETPLACE_INLINE", priority: 30, countryCode: "NG", ...requestFields });

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const farFuture = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const scheduledFuture = await createPlatformCampaign(principal, { name: "Not yet live", placement: "MARKETPLACE_INLINE", priority: 99, startAt: future, endAt: farFuture, ...requestFields });
    expect(scheduledFuture.status).toBe("SCHEDULED");

    const past = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const recentPast = new Date(Date.now() - 60_000);
    const expired = await createPlatformCampaign(principal, { name: "Already expired", placement: "MARKETPLACE_INLINE", priority: 5, startAt: past, endAt: recentPast, ...requestFields });
    expect(expired.status).toBe("SCHEDULED");

    const toPause = await createPlatformCampaign(principal, { name: "Will be paused", placement: "MARKETPLACE_INLINE", priority: 50, ...requestFields });
    await setCampaignStatus(principal, toPause.id, { status: "ACTIVE" });
    await setCampaignStatus(principal, toPause.id, { status: "PAUSED" });

    const toArchive = await createPlatformCampaign(principal, { name: "Will be archived", placement: "MARKETPLACE_INLINE", priority: 60, ...requestFields });
    await setCampaignStatus(principal, toArchive.id, { status: "ACTIVE" });
    await setCampaignStatus(principal, toArchive.id, { status: "PAUSED" });
    await setCampaignStatus(principal, toArchive.id, { status: "ARCHIVED" });

    // A Ghana viewer sees the Ghana-targeted and untargeted campaigns, ordered by priority — never the Nigeria-only one.
    const ghanaBanners = await getPublicBanners({ placement: "MARKETPLACE_INLINE", countryCode: "GH" });
    expect(ghanaBanners.map((b) => b.id)).toEqual([matchingCountry.id, untargeted.id]);

    // A Nigeria viewer sees the reverse — the Ghana-only campaign never leaks across country targeting.
    const nigeriaBanners = await getPublicBanners({ placement: "MARKETPLACE_INLINE", countryCode: "NG" });
    expect(nigeriaBanners.map((b) => b.id)).toEqual([wrongCountry.id, untargeted.id]);

    // No country filter: both targeted campaigns plus the untargeted one, ordered by priority — future, expired, paused, and archived all excluded.
    const allBanners = await getPublicBanners({ placement: "MARKETPLACE_INLINE" });
    expect(allBanners.map((b) => b.id)).toEqual([wrongCountry.id, matchingCountry.id, untargeted.id]);

    // limit caps the result while preserving priority order.
    const limited = await getPublicBanners({ placement: "MARKETPLACE_INLINE", limit: 2 });
    expect(limited.map((b) => b.id)).toEqual([wrongCountry.id, matchingCountry.id]);

    // Same safe public projection as getPublicBanner — never leaks status, review, advertiser, or counter fields.
    expect(allBanners[0]).not.toHaveProperty("status");
    expect(allBanners[0]).not.toHaveProperty("advertiserMarketplaceProfessionalId");
    expect(allBanners[0]).not.toHaveProperty("impressionCount");
  });
});
