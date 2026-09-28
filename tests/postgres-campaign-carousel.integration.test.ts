import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createMarketplaceProfessional, changeMarketplacePlan } from "@/modules/marketplace-professionals/service";
import { createMarketplaceNativeListing, transitionMarketplaceProfessionalListing, submitMarketplaceProfessionalListingVerification } from "@/modules/listings/service";
import {
  createCampaign,
  createPlatformCampaign,
  getCampaignForPlatform,
  getPublicBanners,
  listCampaignsForPlatform,
  publishCampaign,
  reviewCampaign,
  setCampaignStatus,
  submitCampaignForApproval,
  updatePlatformCampaign,
} from "@/modules/campaigns/service";
import { GET as publicCampaignsRoute } from "@/app/api/public/campaigns/route";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { verifyListingAsNesAfric } from "./helpers/nesafric-review";

/**
 * The homepage advertising carousel (web and app) end to end: what Super Admin publishes is exactly
 * what `GET /api/public/campaigns?placement=MARKETPLACE_PRIMARY` returns, and nothing else — never
 * a property listing.
 */

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
}

async function platformAdmin() {
  const user = await registerUser({ displayName: "Carousel Admin", email: `carousel-admin-${Math.random().toString(36).slice(2)}@example.com`, password: "secure-password-123" });
  await db.platformPrincipal.create({ data: { userId: user.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
  return requirePlatformPrincipal(user);
}

const creative = { desktopMediaUrl: "https://cdn.example.com/desktop.jpg", mobileMediaUrl: "https://cdn.example.com/mobile.jpg", nativeAppMediaUrl: "https://cdn.example.com/app.jpg" };
const fields = { headline: "Airport Hills residences", supportingText: "Now selling", ctaLabel: "See the homes", destinationUrl: "https://www.nesafric.com/marketplace/properties", ...creative };
const HOMEPAGE = "MARKETPLACE_PRIMARY";
const DAY = 24 * 60 * 60 * 1000;

/** What the web homepage and the native app both request. */
async function carousel() {
  const response = await publicCampaignsRoute(new Request(`http://localhost/api/public/campaigns?placement=${HOMEPAGE}&countryCode=GH&limit=6`));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return ((await response.json()) as { banners: { id: string }[] }).banners;
}

describe("homepage advertising carousel", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("shows a platform-owned campaign published from Super Admin (Save Draft, then Publish Now) and serves every creative", async () => {
    const principal = await platformAdmin();
    const draft = await createPlatformCampaign(principal, { name: "Launch", placement: HOMEPAGE, ...fields, saveAsDraft: true });
    expect(draft.status).toBe("DRAFT");
    expect(await carousel()).toEqual([]);

    const published = await publishCampaign(principal, draft.id);
    expect(published.status).toBe("APPROVED");
    const banners = await carousel();
    expect(banners).toEqual([expect.objectContaining({ id: draft.id, placement: HOMEPAGE, ...creative })]);
    // Safe projection only.
    expect(banners[0]).not.toHaveProperty("status");
    expect(banners[0]).not.toHaveProperty("createdByUserId");

    const admin = await getCampaignForPlatform(principal, draft.id);
    expect(admin.publicEligibility).toEqual({ eligible: true, reason: null });
  });

  it("requires the homepage placement: a property-search campaign never appears in the homepage carousel until it is moved", async () => {
    const principal = await platformAdmin();
    const campaign = await createPlatformCampaign(principal, { name: "Search page promo", placement: "MARKETPLACE_INLINE", ...fields });
    expect(await carousel()).toEqual([]);
    expect((await getPublicBanners({ placement: "MARKETPLACE_INLINE", countryCode: "GH" })).map((banner) => banner.id)).toEqual([campaign.id]);

    // Super Admin can correct the placement of an existing campaign; the change is audited.
    await updatePlatformCampaign(principal, campaign.id, { placement: HOMEPAGE });
    expect((await carousel()).map((banner) => banner.id)).toEqual([campaign.id]);
    const audit = await db.platformAuditEvent.findFirst({ where: { entityId: campaign.id, action: "platform_admin.campaign_edited" }, orderBy: { createdAt: "desc" } });
    expect(audit?.metadata).toMatchObject({ placement: { from: "MARKETPLACE_INLINE", to: HOMEPAGE } });
  });

  it("excludes draft, paused, archived, rejected, not-yet-started and expired campaigns, and explains each to Super Admin", async () => {
    const principal = await platformAdmin();
    const live = await createPlatformCampaign(principal, { name: "Live", placement: HOMEPAGE, priority: 10, ...fields });
    const inWindow = await createPlatformCampaign(principal, { name: "In window", placement: HOMEPAGE, priority: 5, startAt: new Date(Date.now() - DAY), endAt: new Date(Date.now() + DAY), ...fields });
    expect(inWindow.status).toBe("SCHEDULED");
    const draft = await createPlatformCampaign(principal, { name: "Draft", placement: HOMEPAGE, ...fields, saveAsDraft: true });
    const future = await createPlatformCampaign(principal, { name: "Future", placement: HOMEPAGE, startAt: new Date(Date.now() + DAY), endAt: new Date(Date.now() + 2 * DAY), ...fields });
    const expired = await createPlatformCampaign(principal, { name: "Expired", placement: HOMEPAGE, startAt: new Date(Date.now() - 2 * DAY), endAt: new Date(Date.now() - 60_000), ...fields });
    const paused = await createPlatformCampaign(principal, { name: "Paused", placement: HOMEPAGE, ...fields });
    await setCampaignStatus(principal, paused.id, { status: "PAUSED" });
    const archived = await createPlatformCampaign(principal, { name: "Archived", placement: HOMEPAGE, ...fields });
    await setCampaignStatus(principal, archived.id, { status: "PAUSED" });
    await setCampaignStatus(principal, archived.id, { status: "ARCHIVED" });
    const ended = await createPlatformCampaign(principal, { name: "Ended", placement: HOMEPAGE, ...fields });
    await setCampaignStatus(principal, ended.id, { status: "COMPLETED" });

    // A professional's self-service request that NesAfric rejects never appears either.
    const owner = await registerUser({ displayName: "Advertiser", email: "advertiser@example.com", password: "secure-password-123" });
    const professional = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Advertiser Brokerage", countryCode: "GH" });
    await changeMarketplacePlan(owner.id, professional.id, { planKey: "marketplace_pro" });
    const requested = await createCampaign(owner.id, professional.id, { placement: "MARKETPLACE_INLINE", name: "Request", ...fields });
    await submitCampaignForApproval(owner.id, professional.id, requested.id);
    await reviewCampaign(principal, requested.id, { status: "REJECTED", reason: "Artwork is unclear." });
    expect(await getPublicBanners({ placement: "MARKETPLACE_INLINE", countryCode: "GH" })).toEqual([]);

    expect((await carousel()).map((banner) => banner.id)).toEqual([live.id, inWindow.id]);

    const reasons = Object.fromEntries((await listCampaignsForPlatform(principal, { pageSize: 50 })).items.map((item) => [item.name, item.publicEligibility]));
    expect(reasons.Live).toEqual({ eligible: true, reason: null });
    expect(reasons["In window"]).toEqual({ eligible: true, reason: null });
    expect(reasons.Draft).toEqual({ eligible: false, reason: "Draft — publish it to go live" });
    expect(reasons.Future.reason).toMatch(/^Starts tomorrow at \d\d:\d\d UTC$/);
    expect(reasons.Expired).toEqual({ eligible: false, reason: "Expired — its end date has passed" });
    expect(reasons.Paused).toEqual({ eligible: false, reason: "Paused" });
    expect(reasons.Archived).toEqual({ eligible: false, reason: "Archived" });
    expect(reasons.Ended).toEqual({ eligible: false, reason: "Ended" });
    expect(reasons.Request).toEqual({ eligible: false, reason: "Rejected" });
    void draft; void future; void expired;
  });

  it("a scheduled campaign appears only inside its window and disappears once it ends", async () => {
    const principal = await platformAdmin();
    const campaign = await createPlatformCampaign(principal, { name: "Window", placement: HOMEPAGE, startAt: new Date(Date.now() + DAY), endAt: new Date(Date.now() + 2 * DAY), ...fields });
    expect(await carousel()).toEqual([]);
    await db.campaign.update({ where: { id: campaign.id }, data: { startAt: new Date(Date.now() - 60_000) } });
    expect((await carousel()).map((banner) => banner.id)).toEqual([campaign.id]);
    await db.campaign.update({ where: { id: campaign.id }, data: { endAt: new Date(Date.now() - 1_000) } });
    expect(await carousel()).toEqual([]);
  });

  it("never turns property listings into advertising: with published listings and no campaign the carousel is empty", async () => {
    const owner = await registerUser({ displayName: "Lister", email: "lister@example.com", password: "secure-password-123" });
    const professional = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Lister Brokerage", countryCode: "GH" });
    const listing = await createMarketplaceNativeListing(owner.id, professional.id, {
      asset: { name: "Airport Hills Apartment", category: "apartment", purpose: "RENT", currencyCode: "GHS", priceMinor: "450000", countryCode: "GH", city: "Accra", mediaUrls: [], availableFrom: "2026-09-01", authorityEvidenceReady: true },
      listing: {
        listingType: "RENT", category: "apartment", title: "Furnished Airport Hills apartment", publicDescription: "A professionally marketed furnished apartment with pool.",
        rentAmountMinor: "450000", currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-09-01", countryCode: "GH", city: "Accra",
        media: [{ type: "PHOTO", publicUrl: "https://cdn.example.com/airport-hills.jpg" }], amenities: [],
      },
      listingAuthority: "BROKERAGE_AUTHORIZED",
    });
    await submitMarketplaceProfessionalListingVerification(owner.id, professional.id, listing.id, { status: "PENDING", evidence: [{ type: "marketing_authority", privateReference: "private/auth.pdf" }] });
    await verifyListingAsNesAfric(listing.id);
    await transitionMarketplaceProfessionalListing(owner.id, professional.id, listing.id, { status: "PENDING_REVIEW" });
    await transitionMarketplaceProfessionalListing(owner.id, professional.id, listing.id, { status: "PUBLISHED" });
    expect((await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe("PUBLISHED");

    expect(await carousel()).toEqual([]);
  });

  it("a campaign with only desktop artwork is still eligible; each surface falls back per the creative specification", async () => {
    const principal = await platformAdmin();
    const campaign = await createPlatformCampaign(principal, { name: "Desktop only", placement: HOMEPAGE, ...fields, mobileMediaUrl: undefined, nativeAppMediaUrl: undefined });
    expect((await carousel()).map((banner) => banner.id)).toEqual([campaign.id]);
    const admin = await getCampaignForPlatform(principal, campaign.id);
    expect(admin.creativeReadiness.surfaces).toEqual({
      desktopWeb: { url: creative.desktopMediaUrl, source: "own" },
      mobileWeb: { url: creative.desktopMediaUrl, source: "fallback" },
      nativeApp: { url: creative.desktopMediaUrl, source: "fallback" },
    });
    expect(admin.creativeReadiness.note).toBe("No own mobile web or app artwork: uses the next available creative.");
  });

  it("skips campaigns without artwork before priority and limit, so they never take a slot from one that can be shown", async () => {
    const principal = await platformAdmin();
    const none = { desktopMediaUrl: undefined, mobileMediaUrl: undefined, nativeAppMediaUrl: undefined };
    const artless = await createPlatformCampaign(principal, { name: "Artless", placement: HOMEPAGE, ...fields, ...none, priority: 100 });
    const shown = await createPlatformCampaign(principal, { name: "Artwork", placement: HOMEPAGE, ...fields, priority: 1 });
    const appOnly = await createPlatformCampaign(principal, { name: "App only", placement: HOMEPAGE, ...fields, ...none, nativeAppMediaUrl: creative.nativeAppMediaUrl, priority: 0 });

    // Carousel list: the artless top-priority campaign is not returned at all; app-only artwork is
    // still a valid homepage campaign (the app shows it; the web skips it).
    expect((await carousel()).map((banner) => banner.id)).toEqual([shown.id, appOnly.id]);
    const limited = await publicCampaignsRoute(new Request(`http://localhost/api/public/campaigns?placement=${HOMEPAGE}&countryCode=GH&limit=1`));
    expect(((await limited.json()) as { banners: { id: string }[] }).banners.map((banner) => banner.id)).toEqual([shown.id]);
    // Single banner: the next campaign with artwork, not an empty slot.
    const single = await publicCampaignsRoute(new Request(`http://localhost/api/public/campaigns?placement=${HOMEPAGE}&countryCode=GH`));
    expect(((await single.json()) as { banner: { id: string } | null }).banner?.id).toBe(shown.id);

    // Super Admin is told the artless one is not showing, and why.
    const admin = await getCampaignForPlatform(principal, artless.id);
    expect(admin.publicEligibility).toEqual({ eligible: false, reason: "No artwork uploaded — only the uploaded creative is shown" });
    expect(admin.creativeReadiness.note).toBe("No artwork: not shown anywhere until artwork is uploaded.");
  });

  it("web-only placements need web artwork; the text announcement bar needs none", async () => {
    const principal = await platformAdmin();
    const none = { desktopMediaUrl: undefined, mobileMediaUrl: undefined, nativeAppMediaUrl: undefined };
    await createPlatformCampaign(principal, { name: "App-only directory ad", placement: "PROFESSIONAL_FEATURED", ...fields, ...none, nativeAppMediaUrl: creative.nativeAppMediaUrl, priority: 50 });
    const web = await createPlatformCampaign(principal, { name: "Directory ad", placement: "PROFESSIONAL_FEATURED", ...fields, ...none, mobileMediaUrl: creative.mobileMediaUrl });
    const directory = await publicCampaignsRoute(new Request("http://localhost/api/public/campaigns?placement=PROFESSIONAL_FEATURED&countryCode=GH"));
    expect(((await directory.json()) as { banner: { id: string } | null }).banner?.id).toBe(web.id);

    const announcement = await createPlatformCampaign(principal, { name: "Notice", placement: "HOMEPAGE_ANNOUNCEMENT", ...fields, ...none });
    const bar = await publicCampaignsRoute(new Request("http://localhost/api/public/campaigns?placement=HOMEPAGE_ANNOUNCEMENT&countryCode=GH"));
    expect(((await bar.json()) as { banner: { id: string } | null }).banner?.id).toBe(announcement.id);
  });
});
