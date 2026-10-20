import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createServiceProvider } from "@/modules/providers/service";
import { uploadOrganisationDocument, uploadProviderEvidenceDocument, uploadProviderPortfolioImage, uploadServiceProviderLogo } from "@/modules/documents/service";
import { createProperty } from "@/modules/assets/service";
import { createListing, updateListing } from "@/modules/listings/service";
import { GET as publicMedia } from "@/app/api/public/media/[...key]/route";
import { cleanupAbandonedUploads, runUploadAndDraftCleanup, UPLOAD_CLEANUP_GRACE_MS } from "@/modules/documents/cleanup";
import { randomUUID } from "node:crypto";
import { getObjectStorageAdapter } from "@/platform/storage";
import { db } from "@/platform/database/client";
import { makeImage } from "./helpers/images";

vi.setConfig({ testTimeout: 60_000 });

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "WhatsAppFlowDraft", "ServiceProvider", "StorageObject" CASCADE');
}

const image = async (colour: string) => ({ fileName: "photo.png", contentType: "image/png", dataBase64: (await makeImage({ colour, format: "png", width: 300, height: 300 })).toString("base64") });
const age = (ids: string[]) => db.storageObject.updateMany({ where: { id: { in: ids } }, data: { createdAt: new Date(Date.now() - UPLOAD_CLEANUP_GRACE_MS - 60_000) } });
const stored = (key: string) => getObjectStorageAdapter().getObject(key, "PUBLIC");

describe("PostgreSQL abandoned-upload cleanup", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => { await cleanDatabase(); await db.$disconnect(); });

  it("deletes only unreferenced, old files: never a current logo, a portfolio image in use, or a recent upload", async () => {
    const user = await registerUser({ displayName: "Kwame Asante", email: "kwame@example.com", password: "secure-password-123" });
    const provider = await createServiceProvider(user.id, { type: "INDIVIDUAL", displayName: "Kwame Plumbing", contactPhone: "+233201234567" }) as { id: string };
    await uploadServiceProviderLogo(user.id, provider.id, await image("#111111"));
    await uploadServiceProviderLogo(user.id, provider.id, await image("#222222")); // archives the first logo
    const kept = await uploadProviderPortfolioImage(user.id, provider.id, await image("#333333"));
    const removed = await uploadProviderPortfolioImage(user.id, provider.id, await image("#444444"));
    // An image whose database row disappeared (as if a removal's file deletion failed).
    await db.providerPortfolioImage.delete({ where: { id: removed.id } });

    const objects = await db.storageObject.findMany({ orderBy: { createdAt: "asc" } });
    expect(objects).toHaveLength(4);
    const [oldLogo, currentLogo, keptImage, orphanImage] = objects;
    expect(oldLogo.archivedAt).not.toBeNull();
    // A recent orphan is inside the grace period.
    expect((await cleanupAbandonedUploads()).deleted).toBe(0);

    await age(objects.map((object) => object.id));
    expect(await cleanupAbandonedUploads()).toEqual({ deleted: 2 });
    expect(await stored(oldLogo.storageKey)).toBeNull();
    expect(await stored(orphanImage.storageKey)).toBeNull();
    expect(await stored(currentLogo.storageKey)).not.toBeNull();
    expect(await stored(keptImage.storageKey)).not.toBeNull();
    expect((await db.storageObject.findUniqueOrThrow({ where: { id: orphanImage.id } })).metadata).toMatchObject({ storageDeletedAt: expect.any(String) });
    expect(await db.providerPortfolioImage.findUnique({ where: { id: kept.id } })).not.toBeNull();
    // Each file is cleaned once.
    expect((await cleanupAbandonedUploads()).deleted).toBe(0);
  });

  async function landlordListing(email = "ama@example.com", name = "Owusu Homes") {
    const owner = await registerUser({ displayName: name, email, password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name, type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    const property = await createProperty(owner.id, organisation.id, { name: `${name} Court`, referenceNumber: `P-${randomUUID().slice(0, 6)}`, category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [] });
    const listing = await createListing(owner.id, organisation.id, { propertyId: property.id, listingType: "RENT", category: "HOUSE", title: `${name} house`, publicDescription: "A family house with a garden and parking space.", rentAmountMinor: "300000", currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-11-01", countryCode: "GH", city: "Accra" }) as { id: string };
    const upload = async () => (await uploadOrganisationDocument(owner.id, organisation.id, { targetType: "LISTING_MEDIA", targetId: listing.id, mediaType: "PHOTO", classification: "PUBLIC", ...(await image("#5a5a5a")) })) as unknown as { storageObject: { id: string; storageKey: string }; attached: { id: string } };
    return { owner, organisation, listing, upload };
  }

  it("never lets a stale save re-attach a file the cleanup deletes: one of them wins, never both", async () => {
    const { owner, organisation, listing, upload } = await landlordListing();
    for (let round = 0; round < 6; round += 1) {
      const photo = await upload();
      // The photo row is gone (removed) but its file and object remain, older than the grace period.
      await db.listingMedia.delete({ where: { id: photo.attached.id } });
      await age([photo.storageObject.id]);
      const stale = { media: [{ type: "PHOTO", publicUrl: "https://images.example.com/photo.jpg", storageKey: photo.storageObject.storageKey }] };
      const [cleaned, saved] = await Promise.allSettled([cleanupAbandonedUploads(), updateListing(owner.id, organisation.id, listing.id, stale)]);
      expect(cleaned.status).toBe("fulfilled");
      const object = await db.storageObject.findUniqueOrThrow({ where: { id: photo.storageObject.id } });
      const referenced = await db.listingMedia.count({ where: { storageKey: photo.storageObject.storageKey } });
      const file = await stored(photo.storageObject.storageKey);
      if (saved.status === "fulfilled") {
        // The save won: the file is shown again, so it was not deleted or marked.
        expect([referenced, Boolean(file), (object.metadata as Record<string, unknown> | null)?.storageDeletedAt]).toEqual([1, true, undefined]);
      } else {
        // The cleanup won: the save was refused and nothing points at the deleted file.
        expect(saved.reason).toMatchObject({ code: "INVALID_LISTING_MEDIA" });
        expect([referenced, file]).toEqual([0, null]);
      }
      await db.listingMedia.deleteMany({ where: { listingId: listing.id } });
    }
  });

  it("refuses storage keys from another listing or organisation, so a removal can never delete their files", async () => {
    const victim = await landlordListing("victim@example.com", "Victim Homes");
    const theirs = await victim.upload();
    const attacker = await landlordListing("attacker@example.com", "Attacker Homes");
    const injected = { media: [{ type: "PHOTO", publicUrl: "https://example.com/x.jpg", storageKey: theirs.storageObject.storageKey }] };
    await expect(updateListing(attacker.owner.id, attacker.organisation.id, attacker.listing.id, injected)).rejects.toMatchObject({ code: "INVALID_LISTING_MEDIA" });
    expect(await db.listingMedia.count({ where: { listingId: attacker.listing.id } })).toBe(0);
    expect(await stored(theirs.storageObject.storageKey)).not.toBeNull();
  });

  it("never touches evidence, attachments, application documents or campaign creative, and keeps HEIC evidence private and unchanged", async () => {
    const user = await registerUser({ displayName: "Kwame Asante", email: "kwame@example.com", password: "secure-password-123" });
    const provider = await createServiceProvider(user.id, { type: "INDIVIDUAL", displayName: "Kwame Plumbing", contactPhone: "+233201234567" }) as { id: string };
    // A HEIC file is accepted for evidence as uploaded (it is not re-encoded) and stays private.
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic", "latin1"), Buffer.alloc(200, 7)]);
    const evidence = await uploadProviderEvidenceDocument(user.id, provider.id, { evidenceType: "BUSINESS_REGISTRATION", fileName: "certificate.heic", contentType: "image/heic", dataBase64: heic.toString("base64") }) as { storageObject: { id: string; storageKey: string; classification: string } };
    expect([evidence.storageObject.classification, evidence.storageObject.storageKey.startsWith("private/")]).toEqual(["PRIVATE", true]);
    expect((await getObjectStorageAdapter().getObject(evidence.storageObject.storageKey, "PRIVATE"))?.body.equals(heic)).toBe(true);
    expect((await publicMedia(new Request("http://localhost/x"), { params: Promise.resolve({ key: evidence.storageObject.storageKey.split("/") }) })).status).toBe(404);

    // Other kinds, old, archived and referenced by nothing: still never cleanup candidates.
    const others = await Promise.all(["MAINTENANCE_ATTACHMENT", "APPLICATION_DOCUMENT", "CAMPAIGN_CREATIVE", "MOVE_IN_INSPECTION_MEDIA"].map(async (targetType) => {
      const storageKey = `private/test/${targetType.toLowerCase()}/${randomUUID()}.jpg`;
      await getObjectStorageAdapter().putObject({ key: storageKey, body: Buffer.from("x"), contentType: "image/jpeg", classification: "PRIVATE" });
      return db.storageObject.create({ data: { storageKey, origin: "UPLOADED", classification: "PRIVATE", targetType, targetId: randomUUID(), originalFileName: "x.jpg", safeFileName: "x.jpg", declaredContentType: "image/jpeg", contentType: "image/jpeg", sizeBytes: 1, sha256: "0".repeat(64), uploadedByUserId: user.id, malwareScanStatus: "SKIPPED", archivedAt: new Date() } });
    }));
    await age([evidence.storageObject.id, ...others.map((object) => object.id)]);
    expect(await cleanupAbandonedUploads()).toEqual({ deleted: 0 });
    for (const object of others) expect(await getObjectStorageAdapter().getObject(object.storageKey, "PRIVATE")).not.toBeNull();
    expect(await getObjectStorageAdapter().getObject(evidence.storageObject.storageKey, "PRIVATE")).not.toBeNull();
  });

  it("expires lapsed WhatsApp drafts and leaves open ones", async () => {
    const user = await registerUser({ displayName: "Abena", email: "abena@example.com", password: "secure-password-123" });
    await createOrganisation(user.id, { name: "Abena", type: "OTHER", countryCode: "GH" });
    const draft = (expiresAt: Date) => db.whatsAppFlowDraft.create({ data: { address: `+23320${Math.floor(Math.random() * 1e7)}`, userId: user.id, kind: "BUSINESS_APPLICATION", step: "name", data: {}, expiresAt } });
    const lapsed = await draft(new Date(Date.now() - 1000));
    const open = await draft(new Date(Date.now() + 60_000));
    expect(await runUploadAndDraftCleanup()).toMatchObject({ expiredDrafts: 1 });
    expect((await db.whatsAppFlowDraft.findUniqueOrThrow({ where: { id: lapsed.id } })).status).toBe("EXPIRED");
    expect((await db.whatsAppFlowDraft.findUniqueOrThrow({ where: { id: open.id } })).status).toBe("OPEN");
  });
});
