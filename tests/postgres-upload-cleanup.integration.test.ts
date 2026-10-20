import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createServiceProvider } from "@/modules/providers/service";
import { uploadProviderPortfolioImage, uploadServiceProviderLogo } from "@/modules/documents/service";
import { cleanupAbandonedUploads, runUploadAndDraftCleanup, UPLOAD_CLEANUP_GRACE_MS } from "@/modules/documents/cleanup";
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
