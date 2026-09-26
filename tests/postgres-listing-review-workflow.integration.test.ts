import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { addMarketplaceMember, createMarketplaceProfessional } from "@/modules/marketplace-professionals/service";
import {
  createMarketplaceNativeListing, getPublicListing, searchPublicListings, submitMarketplaceListingForReview,
  transitionMarketplaceProfessionalListing, updateMarketplaceNativeListing,
} from "@/modules/listings/service";
import {
  getVerificationQueueForPlatform, rejectListingForPlatform, requestListingChangesForPlatform, verifyAndPublishListingForPlatform,
} from "@/modules/platform-admin/service";

/**
 * One review workflow: the professional submits (listing + authority verification together), a
 * platform admin verifies & publishes, rejects, or returns it for changes — all through the
 * listing lifecycle, in transactions, with history and audit.
 */

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
}

const PHOTO = "https://images.nesafric.com/public/properties/test/cover.jpg";

function nativeInput(overrides: { photo?: boolean; title?: string } = {}) {
  const title = overrides.title ?? "Three-bedroom house, East Legon";
  return {
    asset: {
      name: title, category: "HOUSE", purpose: "RENT", bedrooms: 3, bathrooms: 3, currencyCode: "GHS", priceMinor: "950000",
      countryCode: "GH", city: "Accra", district: "Ayawaso West", locality: "East Legon", amenities: [], mediaUrls: [],
      availableFrom: "2026-10-01", authorityEvidenceReady: true,
    },
    listing: {
      listingType: "RENT", category: "HOUSE", title, publicDescription: "A bright family home close to schools and shops.",
      rentAmountMinor: "950000", currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-10-01",
      countryCode: "GH", city: "Accra", district: "Ayawaso West", locality: "East Legon",
      media: overrides.photo === false ? [] : [{ type: "PHOTO", publicUrl: PHOTO }], amenities: [],
    },
    listingAuthority: "MANAGING_AGENT",
  };
}

const EVIDENCE = { evidence: { type: "owner_mandate", reference: "Mandate dated 12 Sept 2026, held at the Accra office" } };

async function setup() {
  const owner = await registerUser({ displayName: "Broker Owner", email: "review-owner@example.com", password: "secure-password-123" });
  const professional = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Review Brokerage", countryCode: "GH" });
  const adminUser = await registerUser({ displayName: "Platform Admin", email: "review-admin@example.com", password: "secure-password-123" });
  const admin = await db.platformPrincipal.create({ data: { userId: adminUser.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
  return { owner, professional, admin };
}

async function fresh(listingId: string) {
  return db.listing.findUniqueOrThrow({ where: { id: listingId }, include: { media: true, verificationEvidence: true, statusHistory: { orderBy: { createdAt: "asc" } }, verificationHistory: { orderBy: { createdAt: "asc" } } } });
}

async function submitted() {
  const context = await setup();
  const listing = await createMarketplaceNativeListing(context.owner.id, context.professional.id, nativeInput());
  await submitMarketplaceListingForReview(context.owner.id, context.professional.id, listing.id, EVIDENCE);
  return { ...context, listing: await fresh(listing.id) };
}

describe("PostgreSQL listing review workflow", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => { await cleanDatabase(); await db.$disconnect(); });

  it("submits a draft, unverified listing with a photo for review and verification in one step", async () => {
    const { owner, professional } = await setup();
    const listing = await createMarketplaceNativeListing(owner.id, professional.id, nativeInput());
    expect(listing).toMatchObject({ status: "DRAFT", verificationStatus: "UNVERIFIED" });

    await submitMarketplaceListingForReview(owner.id, professional.id, listing.id, EVIDENCE);

    const after = await fresh(listing.id);
    expect(after).toMatchObject({ id: listing.id, status: "PENDING_REVIEW", verificationStatus: "PENDING", evidenceReady: true });
    expect(after.submittedAt).toBeInstanceOf(Date);
    expect(after.verificationEvidence).toMatchObject([{ type: "owner_mandate", privateReference: EVIDENCE.evidence.reference, submittedByUserId: owner.id }]);
    expect(after.statusHistory.at(-1)).toMatchObject({ fromStatus: "DRAFT", toStatus: "PENDING_REVIEW", actorUserId: owner.id });
    expect(after.verificationHistory.at(-1)).toMatchObject({ fromStatus: "UNVERIFIED", toStatus: "PENDING", actorUserId: owner.id });
    const actions = (await db.auditEvent.findMany({ where: { entityId: listing.id } })).map(({ action }) => action);
    expect(actions).toEqual(expect.arrayContaining(["listing.verification_submitted", "listing.status_changed", "listing.pending_review"]));
  });

  it("refuses to submit a listing without a photo, or without authority evidence, and changes nothing", async () => {
    const { owner, professional } = await setup();
    const noPhoto = await createMarketplaceNativeListing(owner.id, professional.id, nativeInput({ photo: false, title: "No photo yet" }));
    await expect(submitMarketplaceListingForReview(owner.id, professional.id, noPhoto.id, EVIDENCE)).rejects.toMatchObject({ code: "LISTING_INCOMPLETE" });
    expect(await fresh(noPhoto.id)).toMatchObject({ status: "DRAFT", verificationStatus: "UNVERIFIED", verificationEvidence: [] });

    const noEvidence = await createMarketplaceNativeListing(owner.id, professional.id, nativeInput({ title: "No evidence yet" }));
    await expect(submitMarketplaceListingForReview(owner.id, professional.id, noEvidence.id, {})).rejects.toMatchObject({ code: "VERIFICATION_EVIDENCE_REQUIRED" });
    // The old one-click transition can no longer put an unverified listing into review either.
    await expect(transitionMarketplaceProfessionalListing(owner.id, professional.id, noEvidence.id, { status: "PENDING_REVIEW" })).rejects.toMatchObject({ code: "VERIFICATION_EVIDENCE_REQUIRED" });
    expect(await fresh(noEvidence.id)).toMatchObject({ status: "DRAFT", verificationStatus: "UNVERIFIED" });
  });

  it("goes straight to review when verification is already pending", async () => {
    const { owner, professional, admin } = await submitted();
    const listing = (await db.listing.findFirstOrThrow({ where: { marketplaceProfessionalId: professional.id } }));
    await requestListingChangesForPlatform(admin, listing.id, { expectedUpdatedAt: listing.updatedAt, note: "Please add the plot size." });
    await submitMarketplaceListingForReview(owner.id, professional.id, listing.id, {});
    const after = await fresh(listing.id);
    expect(after).toMatchObject({ status: "PENDING_REVIEW", verificationStatus: "PENDING" });
    expect(after.verificationEvidence).toHaveLength(1);
    expect(after.verificationHistory).toHaveLength(1);
  });

  it("verifies and publishes a pending listing, keeping its id and photos, and it becomes public", async () => {
    const { admin, listing } = await submitted();
    const mediaIds = listing.media.map(({ id }) => id);

    await verifyAndPublishListingForPlatform(admin, listing.id, { expectedUpdatedAt: listing.updatedAt });

    const after = await fresh(listing.id);
    expect(after).toMatchObject({ id: listing.id, status: "PUBLISHED", verificationStatus: "VERIFIED" });
    expect(after.publishedAt).toBeInstanceOf(Date);
    expect(after.media.map(({ id }) => id)).toEqual(mediaIds);
    expect(after.verificationHistory.at(-1)).toMatchObject({ fromStatus: "PENDING", toStatus: "VERIFIED", actorUserId: admin.userId });
    expect(after.statusHistory.at(-1)).toMatchObject({ fromStatus: "PENDING_REVIEW", toStatus: "PUBLISHED", actorUserId: admin.userId });
    expect(await db.platformAuditEvent.count({ where: { entityId: listing.id, action: "platform_admin.listing_verified_and_published", platformPrincipalId: admin.id } })).toBe(1);
    expect(await db.listing.count()).toBe(1);

    expect((await getPublicListing(listing.id)).listing.id).toBe(listing.id);
    expect((await searchPublicListings({ country: "GH" })).items.map(({ id }: { id: string }) => id)).toContain(listing.id);
  });

  it("refuses Verify & publish without a photo and rolls the verification back", async () => {
    const { admin, listing } = await submitted();
    await db.listingMedia.deleteMany({ where: { listingId: listing.id } });
    const current = await fresh(listing.id);
    await expect(verifyAndPublishListingForPlatform(admin, listing.id, { expectedUpdatedAt: current.updatedAt })).rejects.toMatchObject({ code: "LISTING_INCOMPLETE" });
    expect(await fresh(listing.id)).toMatchObject({ status: "PENDING_REVIEW", verificationStatus: "PENDING" });
  });

  it("rolls back verification when a publication rule fails inside the transaction", async () => {
    const { admin, listing } = await submitted();
    // The marketplace asset is no longer available: ensurePublicationReady refuses after verification was applied.
    await db.marketplaceAsset.update({ where: { id: listing.marketplaceAssetId! }, data: { availabilityStatus: "SOLD" } });
    await expect(verifyAndPublishListingForPlatform(admin, listing.id, { expectedUpdatedAt: listing.updatedAt })).rejects.toMatchObject({ code: "ASSET_NOT_AVAILABLE" });
    const after = await fresh(listing.id);
    expect(after).toMatchObject({ status: "PENDING_REVIEW", verificationStatus: "PENDING" });
    expect(after.verificationHistory).toHaveLength(1);
  });

  it("refuses Verify & publish from the wrong status, on a stale review, or when verification was never submitted", async () => {
    const { owner, professional, admin } = await setup();
    const draft = await createMarketplaceNativeListing(owner.id, professional.id, nativeInput());
    await expect(verifyAndPublishListingForPlatform(admin, draft.id, { expectedUpdatedAt: draft.updatedAt })).rejects.toMatchObject({ code: "LISTING_NOT_IN_REVIEW" });

    await submitMarketplaceListingForReview(owner.id, professional.id, draft.id, EVIDENCE);
    await expect(verifyAndPublishListingForPlatform(admin, draft.id, { expectedUpdatedAt: draft.updatedAt })).rejects.toMatchObject({ code: "LISTING_CHANGED" });

    // A legacy listing that reached review without verification is never published directly.
    const legacy = await createMarketplaceNativeListing(owner.id, professional.id, nativeInput({ title: "Legacy in review" }));
    await db.$transaction(async (tx) => {
      await tx.listingStatusHistory.create({
        data: {
          listingId: legacy.id,
          actorUserId: owner.id,
          fromStatus: "DRAFT",
          toStatus: "PENDING_REVIEW",
          note: "Legacy review state fixture without verification submission.",
        },
      });
      await tx.listing.update({
        where: { id: legacy.id },
        data: { status: "PENDING_REVIEW" },
      });
    });
    const legacyNow = await fresh(legacy.id);
    await expect(verifyAndPublishListingForPlatform(admin, legacy.id, { expectedUpdatedAt: legacyNow.updatedAt })).rejects.toMatchObject({ code: "LISTING_VERIFICATION_NOT_SUBMITTED" });
    expect(await fresh(legacy.id)).toMatchObject({ status: "PENDING_REVIEW", verificationStatus: "UNVERIFIED" });
  });

  it("refuses review decisions from platform roles without listing verification permission", async () => {
    const { listing } = await submitted();
    for (const role of ["SUPPORT_AGENT", "READ_ONLY", "BILLING_ADMIN"] as const) {
      const user = await registerUser({ displayName: role, email: `${role.toLowerCase()}@example.com`, password: "secure-password-123" });
      const principal = await db.platformPrincipal.create({ data: { userId: user.id, role, status: "ACTIVE", createdVia: "MANUAL" } });
      await expect(verifyAndPublishListingForPlatform(principal, listing.id, { expectedUpdatedAt: listing.updatedAt })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(requestListingChangesForPlatform(principal, listing.id, { expectedUpdatedAt: listing.updatedAt, note: "No." })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(rejectListingForPlatform(principal, listing.id, { expectedUpdatedAt: listing.updatedAt, note: "No." })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await fresh(listing.id)).toMatchObject({ status: "PENDING_REVIEW", verificationStatus: "PENDING" });
  });

  it("does not let a professional agent publish a listing that is only pending verification", async () => {
    const { owner, professional, listing } = await submitted();
    const agent = await registerUser({ displayName: "Agent", email: "review-agent@example.com", password: "secure-password-123" });
    await addMarketplaceMember(owner.id, professional.id, { email: agent.email, role: "AGENT" });
    await expect(transitionMarketplaceProfessionalListing(agent.id, professional.id, listing.id, { status: "PUBLISHED" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(transitionMarketplaceProfessionalListing(owner.id, professional.id, listing.id, { status: "PUBLISHED" })).rejects.toMatchObject({ code: "LISTING_NOT_VERIFIED" });
  });

  it("returns a listing for changes with a note the professional can act on, keeping evidence", async () => {
    const { owner, professional, admin, listing } = await submitted();
    await expect(requestListingChangesForPlatform(admin, listing.id, { expectedUpdatedAt: listing.updatedAt, note: "" })).rejects.toBeTruthy();
    await requestListingChangesForPlatform(admin, listing.id, { expectedUpdatedAt: listing.updatedAt, note: "Add the plot size and a front photo." });

    let after = await fresh(listing.id);
    expect(after).toMatchObject({ status: "DRAFT", verificationStatus: "PENDING" });
    expect(after.statusHistory.at(-1)).toMatchObject({ fromStatus: "PENDING_REVIEW", toStatus: "DRAFT", note: "Add the plot size and a front photo.", actorUserId: admin.userId });
    expect(after.verificationEvidence).toHaveLength(1);

    const edited = await updateMarketplaceNativeListing(owner.id, professional.id, listing.id, nativeInput({ title: "Three-bedroom house on a full plot, East Legon" }));
    expect(edited.id).toBe(listing.id);
    await submitMarketplaceListingForReview(owner.id, professional.id, listing.id, {});
    after = await fresh(listing.id);
    expect(after).toMatchObject({ id: listing.id, status: "PENDING_REVIEW", verificationStatus: "PENDING", title: "Three-bedroom house on a full plot, East Legon" });
  });

  it("rejects a listing and its verification, and the professional can edit and resubmit", async () => {
    const { owner, professional, admin, listing } = await submitted();
    await rejectListingForPlatform(admin, listing.id, { expectedUpdatedAt: listing.updatedAt, note: "The mandate reference could not be confirmed." });

    let after = await fresh(listing.id);
    expect(after).toMatchObject({ status: "REJECTED", verificationStatus: "REJECTED" });
    expect(after.rejectedAt).toBeInstanceOf(Date);
    expect(after.statusHistory.at(-1)).toMatchObject({ toStatus: "REJECTED", note: "The mandate reference could not be confirmed." });
    expect(after.verificationEvidence).toHaveLength(1);

    await updateMarketplaceNativeListing(owner.id, professional.id, listing.id, nativeInput({ title: "Three-bedroom house, East Legon (updated)" }));
    await submitMarketplaceListingForReview(owner.id, professional.id, listing.id, { evidence: { type: "listing_authority", reference: "Signed agency agreement no. 2026-114" } });
    after = await fresh(listing.id);
    expect(after).toMatchObject({ id: listing.id, status: "PENDING_REVIEW", verificationStatus: "PENDING" });
    expect(after.statusHistory.slice(-2).map(({ toStatus }) => toStatus)).toEqual(["DRAFT", "PENDING_REVIEW"]);
    expect(after.verificationEvidence).toHaveLength(2);
  });

  it("shows reviewers what they need, and hides private evidence from roles that cannot decide", async () => {
    const { admin, listing } = await submitted();
    const queue = await getVerificationQueueForPlatform(admin);
    expect(queue.canDecideListings).toBe(true);
    expect(queue.listings[0]).toMatchObject({
      id: listing.id, status: "PENDING_REVIEW", verificationStatus: "PENDING", photoCount: 1, readinessProblems: [],
      cover: { publicUrl: PHOTO }, rentAmountMinor: "950000", evidence: [{ type: "owner_mandate", privateReference: EVIDENCE.evidence.reference }],
    });

    const readerUser = await registerUser({ displayName: "Reader", email: "review-reader@example.com", password: "secure-password-123" });
    const reader = await db.platformPrincipal.create({ data: { userId: readerUser.id, role: "READ_ONLY", status: "ACTIVE", createdVia: "MANUAL" } });
    const readerQueue = await getVerificationQueueForPlatform(reader);
    expect(readerQueue.canDecideListings).toBe(false);
    expect(readerQueue.listings[0].evidence[0]).not.toHaveProperty("privateReference");
  });
});
