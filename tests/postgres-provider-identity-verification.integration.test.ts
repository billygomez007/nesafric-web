import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createMaintenanceRequest, createWorkOrder, transitionMaintenanceRequest } from "@/modules/maintenance/service";
import {
  addProviderToDirectory,
  assignProviderToWorkOrder,
  createServiceProvider,
  listServiceCategories,
  listPendingProviderIdentityReviews,
  getProviderIdentityReviewDetail,
  reviewProviderEvidence,
  reviewProviderIdentity,
  reviewProviderVerification,
  submitProviderVerification,
} from "@/modules/providers/service";
import { discoverMarketplaceProviders, getPublicMarketplaceProvider, updateMarketplaceProfile } from "@/modules/marketplace/service";
import { getSignedStorageAccess, uploadProviderEvidenceDocument } from "@/modules/documents/service";

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]);
function base64(buffer: Buffer) {
  return buffer.toString("base64");
}

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
}

async function makePlatformReviewer(email: string) {
  const user = await registerUser({ displayName: "Platform Reviewer", email, password: "secure-password-123" });
  await db.platformPrincipal.create({ data: { userId: user.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
  return user;
}

async function addLandlordMember(organisationId: string, userId: string, roleKey: string) {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const member = await db.organisationMember.create({ data: { organisationId, userId } });
  await db.membershipRole.create({ data: { memberId: member.id, roleId: role.id } });
  return member;
}

describe("PostgreSQL Phase 23 Property Service Professional identity verification", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("gates public listing on approved Ghana Card evidence and platform identity verification", async () => {
    const artisanUser = await registerUser({ displayName: "Identity Artisan", email: "identity-artisan@example.com", password: "secure-password-123" });
    const categories = await listServiceCategories();
    const plumbing = categories.find(({ key }) => key === "plumbing")!;
    const provider = await createServiceProvider(artisanUser.id, {
      type: "INDIVIDUAL", displayName: "Identity Artisan", contactEmail: "identity-artisan@example.com",
      categoryIds: [plumbing.id], serviceAreas: [],
    });

    // 1. A brand-new, unverified provider must not be able to become publicly listed.
    await expect(updateMarketplaceProfile(artisanUser.id, provider.id, {
      listed: true, categoryIds: [plumbing.id], serviceAreas: [{ countryCode: "GH", city: "Accra" }],
    })).rejects.toMatchObject({ code: "PROVIDER_NOT_VERIFIED" });

    const frontUpload = await uploadProviderEvidenceDocument(artisanUser.id, provider.id, {
      evidenceType: "GHANA_CARD_FRONT", fileName: "ghana-card-front.jpg", contentType: "image/jpeg", dataBase64: base64(JPEG_BYTES),
    });
    const backUpload = await uploadProviderEvidenceDocument(artisanUser.id, provider.id, {
      evidenceType: "GHANA_CARD_BACK", fileName: "ghana-card-back.jpg", contentType: "image/jpeg", dataBase64: base64(JPEG_BYTES),
    });
    // Ghana Card evidence must always be namespaced under the private provider-evidence prefix —
    // never mixed with a public media namespace regardless of storage backend.
    expect(frontUpload.storageObject.storageKey.startsWith("private/provider-evidence/")).toBe(true);
    expect(frontUpload.storageObject.classification).toBe("PRIVATE");
    await submitProviderVerification(artisanUser.id, provider.id, {
      evidence: [
        { type: "GHANA_CARD_FRONT", reference: frontUpload.attached.reference },
        { type: "GHANA_CARD_BACK", reference: backUpload.attached.reference },
      ],
    });

    // Still not listable while the platform review queue is pending — even after evidence exists.
    await expect(updateMarketplaceProfile(artisanUser.id, provider.id, {
      listed: true, categoryIds: [plumbing.id], serviceAreas: [{ countryCode: "GH", city: "Accra" }],
    })).rejects.toMatchObject({ code: "PROVIDER_NOT_VERIFIED" });

    // 6. A provider cannot approve their own verification — they hold no PlatformPrincipal.
    await expect(reviewProviderIdentity(artisanUser, provider.id, { status: "VERIFIED" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reviewProviderEvidence(artisanUser, frontUpload.attached.id, { status: "APPROVED" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });

    // 7. A normal (non-platform) provider cannot reach the platform review queue.
    await expect(listPendingProviderIdentityReviews(artisanUser)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getProviderIdentityReviewDetail(artisanUser, provider.id)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const platformReviewer = await makePlatformReviewer("identity-reviewer@example.com");
    expect((await listPendingProviderIdentityReviews(platformReviewer)).map((p) => p.id)).toContain(provider.id);

    // Cannot verify identity before Ghana Card evidence is actually approved.
    await expect(reviewProviderIdentity(platformReviewer, provider.id, { status: "VERIFIED" }))
      .rejects.toMatchObject({ code: "GHANA_CARD_EVIDENCE_REQUIRED" });

    await reviewProviderEvidence(platformReviewer, frontUpload.attached.id, { status: "APPROVED" });
    await reviewProviderEvidence(platformReviewer, backUpload.attached.id, { status: "APPROVED" });
    // Only pending evidence may be reviewed — a second attempt on an already-decided document fails.
    await expect(reviewProviderEvidence(platformReviewer, frontUpload.attached.id, { status: "APPROVED" }))
      .rejects.toMatchObject({ code: "INVALID_EVIDENCE_REVIEW_STATE" });

    const verified = await reviewProviderIdentity(platformReviewer, provider.id, { status: "VERIFIED" });
    expect(verified.verificationStatus).toBe("VERIFIED");
    expect(verified.identityVerifiedAt).not.toBeNull();

    // 11. Only now can the provider actually become publicly listed and discoverable.
    await updateMarketplaceProfile(artisanUser.id, provider.id, {
      listed: true, categoryIds: [plumbing.id], serviceAreas: [{ countryCode: "GH", city: "Accra" }],
    });
    const results = await discoverMarketplaceProviders({ country: "GH" });
    expect(results.items.map((item) => item.id)).toContain(provider.id);
    const publicProfile = await getPublicMarketplaceProvider(provider.id);
    expect(publicProfile.provider.id).toBe(provider.id);

    // 4. Public marketplace responses must never leak identity evidence in any form.
    const serializedDiscovery = JSON.stringify(results);
    const serializedProfile = JSON.stringify(publicProfile);
    for (const leak of [frontUpload.attached.reference, backUpload.attached.reference, "GHANA_CARD", "reviewStatus"]) {
      expect(serializedDiscovery).not.toContain(leak);
      expect(serializedProfile).not.toContain(leak);
    }

    // 11 (continued). If verification later moves away from VERIFIED (e.g. suspension by a
    // landlord who added this provider to their directory), public discovery must exclude the
    // provider immediately — even though `listed` itself was never touched.
    const landlord = await registerUser({ displayName: "Suspend Landlord", email: "suspend-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(landlord.id, { name: "Suspend Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await addProviderToDirectory(landlord.id, organisation.id, { providerId: provider.id });
    await reviewProviderVerification(landlord.id, organisation.id, provider.id, { status: "SUSPENDED", reason: "Under review" });
    expect((await discoverMarketplaceProviders({ country: "GH" })).items.map((item) => item.id)).not.toContain(provider.id);
    await expect(getPublicMarketplaceProvider(provider.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    // 10. A suspended provider cannot receive a new work-order assignment.
    const property = await createProperty(landlord.id, organisation.id, {
      name: "Suspend Property", referenceNumber: "SUSPEND-1", category: "Residential", countryCode: "GH", currencyCode: "GHS",
    });
    const maintenance = await createMaintenanceRequest(landlord.id, organisation.id, {
      propertyId: property.id, title: "Suspended provider dispatch", description: "Should be blocked", category: "plumbing",
    });
    await transitionMaintenanceRequest(landlord.id, organisation.id, maintenance.id, { status: "TRIAGED" });
    const workOrder = await createWorkOrder(landlord.id, organisation.id, maintenance.id, { title: "Blocked assignment", currencyCode: "GHS" });
    await expect(assignProviderToWorkOrder(landlord.id, organisation.id, workOrder.id, { providerId: provider.id }))
      .rejects.toMatchObject({ code: "PROVIDER_NOT_READY" });
  });

  it("keeps identity evidence private: cross-provider, unrelated-landlord, and cross-organisation access are all denied", async () => {
    const artisanUser = await registerUser({ displayName: "Private Artisan", email: "private-artisan@example.com", password: "secure-password-123" });
    const otherArtisanUser = await registerUser({ displayName: "Other Artisan", email: "other-artisan@example.com", password: "secure-password-123" });
    const provider = await createServiceProvider(artisanUser.id, { type: "INDIVIDUAL", displayName: "Private Artisan", contactEmail: "private-artisan@example.com" });
    const otherProvider = await createServiceProvider(otherArtisanUser.id, { type: "INDIVIDUAL", displayName: "Other Artisan", contactEmail: "other-artisan@example.com" });

    const upload = await uploadProviderEvidenceDocument(artisanUser.id, provider.id, {
      evidenceType: "GHANA_CARD_FRONT", fileName: "ghana-card-front.jpg", contentType: "image/jpeg", dataBase64: base64(JPEG_BYTES),
    });
    const storageObjectId = upload.storageObject.id;

    // 2. Another provider (no relationship at all) cannot read this evidence.
    await expect(getSignedStorageAccess(otherArtisanUser.id, null, storageObjectId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(uploadProviderEvidenceDocument(otherArtisanUser.id, provider.id, {
      evidenceType: "GHANA_CARD_BACK", fileName: "not-mine.jpg", contentType: "image/jpeg", dataBase64: base64(JPEG_BYTES),
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // The owner can read their own evidence.
    await expect(getSignedStorageAccess(artisanUser.id, null, storageObjectId)).resolves.toMatchObject({ url: expect.any(String) });

    // 3. A landlord who has never added this provider to their directory cannot read it, even
    // with a full `provider.verify` role in their own unrelated organisation.
    const unrelatedLandlord = await registerUser({ displayName: "Unrelated Landlord", email: "unrelated-landlord@example.com", password: "secure-password-123" });
    const unrelatedOrg = await createOrganisation(unrelatedLandlord.id, { name: "Unrelated Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await expect(getSignedStorageAccess(unrelatedLandlord.id, unrelatedOrg.id, storageObjectId)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // A landlord who DOES have this provider in their directory, but lacks `provider.verify`
    // (only a plain viewer role), still cannot read the raw identity evidence.
    const viewerLandlord = await registerUser({ displayName: "Viewer Landlord", email: "viewer-landlord@example.com", password: "secure-password-123" });
    const viewerOrg = await createOrganisation(viewerLandlord.id, { name: "Viewer Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await addProviderToDirectory(viewerLandlord.id, viewerOrg.id, { providerId: provider.id });
    const outsideViewer = await registerUser({ displayName: "Directory Viewer", email: "directory-viewer@example.com", password: "secure-password-123" });
    await addLandlordMember(viewerOrg.id, outsideViewer.id, "viewer");
    await expect(getSignedStorageAccess(outsideViewer.id, viewerOrg.id, storageObjectId)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // A landlord who has this provider in their directory AND holds `provider.verify` can read it.
    await expect(getSignedStorageAccess(viewerLandlord.id, viewerOrg.id, storageObjectId)).resolves.toMatchObject({ url: expect.any(String) });

    // 8. Cross-organisation platform-review actions are scoped correctly: a landlord cannot
    // review a provider that was never added to their own directory (NOT_FOUND, not FORBIDDEN,
    // matching this codebase's existing org-scoping idiom).
    await expect(reviewProviderVerification(unrelatedLandlord.id, unrelatedOrg.id, otherProvider.id, { status: "VERIFIED" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("preserves immutable evidence history across resubmission and never lets an unverified provider read as VERIFIED anywhere public", async () => {
    const artisanUser = await registerUser({ displayName: "Resubmit Artisan", email: "resubmit-artisan@example.com", password: "secure-password-123" });
    const provider = await createServiceProvider(artisanUser.id, { type: "INDIVIDUAL", displayName: "Resubmit Artisan", contactEmail: "resubmit-artisan@example.com" });

    await submitProviderVerification(artisanUser.id, provider.id, {
      evidence: [{ type: "GHANA_CARD_FRONT", reference: "evidence/front-v1" }, { type: "GHANA_CARD_BACK", reference: "evidence/back-v1" }],
    });
    const platformReviewer = await makePlatformReviewer("resubmit-reviewer@example.com");
    const firstFront = await db.providerEvidence.findFirstOrThrow({ where: { providerId: provider.id, type: "GHANA_CARD_FRONT" } });
    await reviewProviderEvidence(platformReviewer, firstFront.id, { status: "REJECTED", reason: "Image too blurry to read" });
    expect((await reviewProviderIdentity(platformReviewer, provider.id, { status: "REQUIRES_MORE_INFORMATION", reason: "Re-upload a clearer Ghana Card front" })).verificationStatus)
      .toBe("REQUIRES_MORE_INFORMATION");

    // 9. Resubmitting a clearer document supersedes the old, rejected one rather than deleting it.
    await submitProviderVerification(artisanUser.id, provider.id, {
      evidence: [{ type: "GHANA_CARD_FRONT", reference: "evidence/front-v2" }, { type: "GHANA_CARD_BACK", reference: "evidence/back-v1" }],
    });
    const supersededFront = await db.providerEvidence.findUniqueOrThrow({ where: { id: firstFront.id } });
    expect(supersededFront.reviewStatus).toBe("SUPERSEDED");
    expect(supersededFront.rejectionReason).toBe("Image too blurry to read");
    const newFront = await db.providerEvidence.findFirstOrThrow({ where: { providerId: provider.id, reference: "evidence/front-v2" } });
    expect(newFront.reviewStatus).toBe("PENDING");
    expect(supersededFront.supersededByEvidenceId).toBe(newFront.id);

    // Never verified — public discovery must never surface it as VERIFIED, even if `listed` were
    // somehow forced true out-of-band (defense in depth: the ranking query itself hard-filters on
    // verificationStatus, independent of the `listed` flag).
    await db.providerMarketplaceProfile.create({
      data: { providerId: provider.id, listed: true, serviceAreas: { create: [{ countryCode: "GH", city: "Accra" }] } },
    });
    expect((await discoverMarketplaceProviders({ country: "GH" })).items.map((item) => item.id)).not.toContain(provider.id);
    await expect(getPublicMarketplaceProvider(provider.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
