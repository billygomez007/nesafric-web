import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createServiceProvider, getProvider, listServiceCategories, reviewProviderEvidence, reviewProviderIdentity, submitProviderVerification, updateServiceProvider } from "@/modules/providers/service";
import { discoverMarketplaceProviders, getPublicMarketplaceProvider, updateMarketplaceProfile } from "@/modules/marketplace/service";
import { removeServiceProviderLogo, uploadServiceProviderLogo } from "@/modules/documents/service";

/**
 * Provider logo management against PostgreSQL + the in-memory storage adapter: only the provider's
 * owner can upload or remove, replacing archives the old object, removing clears the link, and the
 * public marketplace payload only ever shows the current PUBLIC object's render URL.
 */

// Minimal valid PNG signature + IHDR header (sniffed as image/png; 1×1).
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex").toString("base64");
const png = (fileName = "logo.png") => ({ fileName, contentType: "image/png", dataBase64: PNG });

async function cleanDatabase() {
  await db.$executeRaw`TRUNCATE TABLE "MarketplaceEnquiryStatusHistory", "ProviderMarketplaceProfileHistory"`;
  await db.savedServiceProvider.deleteMany();
  await db.platformPrincipal.deleteMany();
  await db.providerMarketplaceServiceArea.deleteMany();
  await db.providerMarketplaceCategory.deleteMany();
  await db.providerMarketplaceProfile.deleteMany();
  await db.providerVerificationConsent.deleteMany();
  await db.providerVerificationHistory.deleteMany();
  await db.providerEvidence.deleteMany();
  await db.providerServiceArea.deleteMany();
  await db.serviceProviderCategory.deleteMany();
  await db.serviceProvider.deleteMany();
  await db.storageObjectHistory.deleteMany();
  await db.storageObject.deleteMany({ where: { targetType: "SERVICE_PROVIDER_LOGO" } });
  await db.domainEvent.deleteMany();
  await db.auditEvent.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
}

async function listedProvider(displayName: string) {
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const owner = await registerUser({ displayName, email: `${slug}@example.com`, password: "secure-password-123" });
  const category = (await listServiceCategories()).find(({ key }) => key === "plumbing")!;
  const provider = await createServiceProvider(owner.id, { type: "INDIVIDUAL", displayName, contactEmail: `${slug}@example.com`, categoryIds: [category.id] });
  await submitProviderVerification(owner.id, provider.id, {
    evidence: [{ type: "GHANA_CARD_FRONT", reference: `private/${slug}-front` }, { type: "GHANA_CARD_BACK", reference: `private/${slug}-back` }],
  });
  const reviewer = await registerUser({ displayName: "Reviewer", email: `reviewer-${slug}@example.com`, password: "secure-password-123" });
  await db.platformPrincipal.create({ data: { userId: reviewer.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
  for (const evidence of await db.providerEvidence.findMany({ where: { providerId: provider.id, reviewStatus: "PENDING" } })) {
    await reviewProviderEvidence(reviewer, evidence.id, { status: "APPROVED" });
  }
  await reviewProviderIdentity(reviewer, provider.id, { status: "VERIFIED" });
  await updateServiceProvider(owner.id, provider.id, { availabilityStatus: "AVAILABLE", acceptingWork: true });
  await updateMarketplaceProfile(owner.id, provider.id, {
    listed: true,
    categoryIds: [category.id],
    serviceAreas: [{ countryCode: "GH", region: "Greater Accra", city: "Accra" }],
  });
  return { providerId: provider.id, ownerId: owner.id };
}

const logoObjects = (providerId: string) =>
  db.storageObject.findMany({ where: { targetType: "SERVICE_PROVIDER_LOGO", targetId: providerId }, orderBy: { createdAt: "asc" } });

describe("PostgreSQL service provider logo management", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("lets the owner upload, replace and remove, archiving superseded objects and keeping the public payload current", async () => {
    const { providerId, ownerId } = await listedProvider("Kwame Plumbing Services");
    expect((await getPublicMarketplaceProvider(providerId)).provider.logo).toBeNull();
    expect(await getProvider(ownerId, null, providerId)).toMatchObject({ logo: null, viewerIsOwner: true });

    const first = await uploadServiceProviderLogo(ownerId, providerId, png("first.png"));
    const [firstObject] = await logoObjects(providerId);
    expect(firstObject).toMatchObject({ classification: "PUBLIC", archivedAt: null, contentType: "image/png" });
    expect(first.logoUrl).toContain(firstObject.storageKey);
    const publicFirst = (await getPublicMarketplaceProvider(providerId)).provider;
    expect(publicFirst.logo).toEqual({ url: first.logoUrl });
    expect((await getProvider(ownerId, null, providerId)).logo).toEqual({ url: first.logoUrl });

    const second = await uploadServiceProviderLogo(ownerId, providerId, png("second.png"));
    const objects = await logoObjects(providerId);
    expect(objects).toHaveLength(2);
    expect(objects[0].archivedAt).not.toBeNull();
    expect(objects[1].archivedAt).toBeNull();
    expect(await db.storageObjectHistory.count({ where: { storageObjectId: objects[0].id, action: "ARCHIVED" } })).toBe(1);
    expect((await db.serviceProvider.findUniqueOrThrow({ where: { id: providerId } })).logoStorageObjectId).toBe(objects[1].id);
    const publicSecond = (await discoverMarketplaceProviders({})).items.find(({ id }) => id === providerId)!;
    expect(publicSecond.logo).toEqual({ url: second.logoUrl });
    expect(second.logoUrl).not.toBe(first.logoUrl);
    // Only the render URL is public: no storage ids, keys-as-fields, classification or bucket data.
    expect(Object.keys(publicSecond.logo!)).toEqual(["url"]);
    expect(JSON.stringify(publicSecond)).not.toContain(objects[1].id);
    expect(JSON.stringify(publicSecond)).not.toContain("logoStorageObjectId");

    expect(await removeServiceProviderLogo(ownerId, providerId)).toEqual({ id: providerId, logo: null });
    expect((await logoObjects(providerId)).every(({ archivedAt }) => archivedAt !== null)).toBe(true);
    expect((await db.serviceProvider.findUniqueOrThrow({ where: { id: providerId } })).logoStorageObjectId).toBeNull();
    expect((await getPublicMarketplaceProvider(providerId)).provider.logo).toBeNull();
    // Removing again is harmless.
    expect(await removeServiceProviderLogo(ownerId, providerId)).toEqual({ id: providerId, logo: null });
  });

  it("refuses another user's upload or removal and never shows an archived object", async () => {
    const { providerId, ownerId } = await listedProvider("Kwame Plumbing Services");
    const other = await listedProvider("Ama Cleaning");
    const stranger = await registerUser({ displayName: "Stranger", email: "stranger-logo@example.com", password: "secure-password-123" });

    await uploadServiceProviderLogo(ownerId, providerId, png());
    for (const userId of [stranger.id, other.ownerId]) {
      await expect(uploadServiceProviderLogo(userId, providerId, png("hijack.png"))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(removeServiceProviderLogo(userId, providerId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const objects = await logoObjects(providerId);
    expect(objects).toHaveLength(1);
    expect(objects[0].archivedAt).toBeNull();
    expect((await getProvider(stranger.id, null, providerId).catch((error) => error))).toMatchObject({ code: "FORBIDDEN" });

    // An object archived out of band (e.g. by an admin) stops rendering even while still linked.
    await db.storageObject.update({ where: { id: objects[0].id }, data: { archivedAt: new Date() } });
    expect((await getPublicMarketplaceProvider(providerId)).provider.logo).toBeNull();
    expect((await getProvider(ownerId, null, providerId)).logo).toBeNull();
  });

  it("rejects non-images and oversized files on the server, whatever the client sent", async () => {
    const { providerId, ownerId } = await listedProvider("Kwame Plumbing Services");
    const pdf = Buffer.from("%PDF-1.4\n%fake").toString("base64");
    await expect(uploadServiceProviderLogo(ownerId, providerId, { fileName: "logo.png", contentType: "image/png", dataBase64: pdf }))
      .rejects.toMatchObject({ code: "UNSUPPORTED_FILE_TYPE" });
    const big = Buffer.concat([Buffer.from(PNG, "base64"), Buffer.alloc(2 * 1024 * 1024)]).toString("base64");
    await expect(uploadServiceProviderLogo(ownerId, providerId, { fileName: "logo.png", contentType: "image/png", dataBase64: big }))
      .rejects.toMatchObject({ code: "LOGO_TOO_LARGE", status: 413 });
    expect(await logoObjects(providerId)).toHaveLength(0);
  });

  it("treats an archived provider as having no owner", async () => {
    const { providerId, ownerId } = await listedProvider("Kwame Plumbing Services");
    await db.serviceProvider.update({ where: { id: providerId }, data: { archivedAt: new Date() } });
    await expect(uploadServiceProviderLogo(ownerId, providerId, png())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(removeServiceProviderLogo(ownerId, providerId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
