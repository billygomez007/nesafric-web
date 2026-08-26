import http from "node:http";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createListing } from "@/modules/listings/service";
import { createMaintenanceRequest } from "@/modules/maintenance/service";
import { createLease } from "./helpers/lease";
import { createMoveInInspection, scheduleMoveIn } from "@/modules/lease-execution/service";
import { createMoveOutInspection, scheduleMoveOut } from "@/modules/move-out/service";
import {
  archiveStorageObject,
  getSignedStorageAccess,
  listDocumentCenter,
  restoreStorageObject,
  uploadOrganisationDocument,
} from "@/modules/documents/service";
import { getObjectStorageAdapter, verifyLocalObjectToken } from "@/platform/storage";

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]);
const PLAIN_TEXT_BYTES = Buffer.from("This is not an image, pdf, or any recognised file signature.");

function base64(buffer: Buffer) {
  return buffer.toString("base64");
}

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
}

async function addMember(organisationId: string, userId: string, roleKey: string) {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const member = await db.organisationMember.create({ data: { organisationId, userId } });
  await db.membershipRole.create({ data: { memberId: member.id, roleId: role.id } });
  return member;
}

describe("PostgreSQL Phase 19 provider-neutral object storage", () => {
  beforeEach(async () => {
    await cleanDatabase();
    process.env.STORAGE_PROVIDER = "memory";
    delete process.env.STORAGE_MAX_UPLOAD_BYTES;
    delete process.env.MALWARE_SCAN_BASE_URL;
  });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("validates MIME by file bytes, stores metadata, enforces org isolation, and supports signed/public access plus archive history", async () => {
    const owner = await registerUser({ displayName: "Storage Owner", email: "storage-owner@example.com", password: "secure-password-123" });
    const outsider = await registerUser({ displayName: "Storage Outsider", email: "storage-outsider@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Storage Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const otherOrganisation = await createOrganisation(outsider.id, { name: "Other Storage Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const property = await createProperty(owner.id, organisation.id, {
      name: "Storage House", referenceNumber: "STORE-001", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }],
    });
    const otherProperty = await createProperty(outsider.id, otherOrganisation.id, {
      name: "Other House", referenceNumber: "OTHER-001", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [],
    });
    const listing = await createListing(owner.id, organisation.id, {
      propertyId: property.id, listingType: "RENT", category: "apartment", title: "Storage listing",
      publicDescription: "A well documented listing used to validate upload behaviour end to end.",
      rentAmountMinor: "300000", currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-09-01", countryCode: "GH",
    });
    const otherListing = await createListing(outsider.id, otherOrganisation.id, {
      propertyId: otherProperty.id, listingType: "RENT", category: "apartment", title: "Other listing",
      publicDescription: "A different organisation's listing that must never be reachable cross-tenant.",
      rentAmountMinor: "300000", currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-09-01", countryCode: "GH",
    });

    // Invalid file: declared as an image but the bytes are plain text — sniffed by content, not the declared MIME.
    await expect(uploadOrganisationDocument(owner.id, organisation.id, {
      targetType: "LISTING_MEDIA", targetId: listing.id, mediaType: "PHOTO",
      fileName: "fake.jpg", contentType: "image/jpeg", dataBase64: base64(PLAIN_TEXT_BYTES),
    })).rejects.toMatchObject({ code: "UNSUPPORTED_FILE_TYPE" });

    // Oversized file rejected before ever touching storage.
    process.env.STORAGE_MAX_UPLOAD_BYTES = "8";
    await expect(uploadOrganisationDocument(owner.id, organisation.id, {
      targetType: "LISTING_MEDIA", targetId: listing.id, mediaType: "PHOTO",
      fileName: "big.jpg", contentType: "image/jpeg", dataBase64: base64(JPEG_BYTES),
    })).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    delete process.env.STORAGE_MAX_UPLOAD_BYTES;

    // Org isolation: cannot upload against another organisation's listing.
    await expect(uploadOrganisationDocument(owner.id, organisation.id, {
      targetType: "LISTING_MEDIA", targetId: otherListing.id, mediaType: "PHOTO",
      fileName: "cross-tenant.jpg", contentType: "image/jpeg", dataBase64: base64(JPEG_BYTES),
    })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Successful PUBLIC upload (explicit opt-in — private by default otherwise).
    const publicUpload = await uploadOrganisationDocument(owner.id, organisation.id, {
      targetType: "LISTING_MEDIA", targetId: listing.id, mediaType: "PHOTO", classification: "PUBLIC",
      fileName: "../../etc/passwd.jpg", contentType: "image/jpeg", dataBase64: base64(JPEG_BYTES),
    });
    expect(publicUpload.storageObject).toMatchObject({ classification: "PUBLIC", contentType: "image/jpeg", origin: "UPLOADED", malwareScanStatus: "SKIPPED" });
    expect(publicUpload.storageObject.sha256).toHaveLength(64);
    // Safe filename strips path traversal and forces a truthful extension from sniffed content.
    expect(publicUpload.storageObject.safeFileName).not.toContain("..");
    expect(publicUpload.storageObject.safeFileName.endsWith(".jpg")).toBe(true);
    const publicAccess = await getSignedStorageAccess(owner.id, organisation.id, publicUpload.storageObject.id);
    expect(publicAccess.expiresAt).toBeNull();
    expect(publicAccess.url).toMatch(/\/api\/public\/media\//);

    // Successful PRIVATE upload (default) — a working signed URL, verifiable via the same HMAC scheme the local streaming route checks.
    const privateUpload = await uploadOrganisationDocument(owner.id, organisation.id, {
      targetType: "LISTING_MEDIA", targetId: listing.id, mediaType: "PHOTO",
      fileName: "interior.jpg", contentType: "image/jpeg", dataBase64: base64(JPEG_BYTES),
    });
    expect(privateUpload.storageObject.classification).toBe("PRIVATE");
    const signed = await getSignedStorageAccess(owner.id, organisation.id, privateUpload.storageObject.id);
    expect(signed.expiresAt).toBeInstanceOf(Date);
    const signedUrl = new URL(signed.url, "http://localhost");
    const token = signedUrl.searchParams.get("token")!;
    const expires = Number(signedUrl.searchParams.get("expires"));
    expect(verifyLocalObjectToken(privateUpload.storageObject.storageKey, token, expires).verified).toBe(true);
    expect(verifyLocalObjectToken(privateUpload.storageObject.storageKey, "wrong-token", expires).verified).toBe(false);
    const stored = await getObjectStorageAdapter().getObject(privateUpload.storageObject.storageKey);
    expect(stored?.body.equals(JPEG_BYTES)).toBe(true);

    // Cross-organisation members cannot resolve a signed URL for someone else's object.
    await expect(getSignedStorageAccess(outsider.id, otherOrganisation.id, privateUpload.storageObject.id)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Listing media is attached with real ordering metadata.
    const mediaRow = await db.listingMedia.findUniqueOrThrow({ where: { id: privateUpload.attached.id } });
    expect(mediaRow.storageKey).toBe(privateUpload.storageObject.storageKey);
    expect(mediaRow.sortOrder).toBeGreaterThanOrEqual(1);

    // The upload is discoverable through the (staff-only) Document Center.
    const center = await listDocumentCenter(owner.id, organisation.id, { type: "LISTING_MEDIA" });
    expect(center.items.some((item) => item.id === privateUpload.storageObject.id)).toBe(true);

    // Archive policy/history (item 1): archiving records history and blocks further signed access; restoring reverses it.
    await archiveStorageObject(owner.id, organisation.id, privateUpload.storageObject.id, { reason: "Superseded photo" });
    const archived = await db.storageObject.findUniqueOrThrow({ where: { id: privateUpload.storageObject.id } });
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.archiveReason).toBe("Superseded photo");
    const history = await db.storageObjectHistory.findMany({ where: { storageObjectId: privateUpload.storageObject.id } });
    expect(history.map(({ action }) => action)).toContain("ARCHIVED");
    await expect(getSignedStorageAccess(owner.id, organisation.id, privateUpload.storageObject.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await restoreStorageObject(owner.id, organisation.id, privateUpload.storageObject.id);
    expect((await db.storageObject.findUniqueOrThrow({ where: { id: privateUpload.storageObject.id } })).archivedAt).toBeNull();
    const restoredHistory = await db.storageObjectHistory.findMany({ where: { storageObjectId: privateUpload.storageObject.id }, orderBy: { createdAt: "asc" } });
    expect(restoredHistory.map(({ action }) => action)).toEqual(["ARCHIVED", "RESTORED"]);

    // document.uploaded / document.archived audit + domain events (item 9).
    const auditActions = (await db.auditEvent.findMany({ where: { organisationId: organisation.id, entityType: "storage_object" } })).map(({ action }) => action);
    expect(auditActions).toContain("document.uploaded");
    expect(auditActions).toContain("document.archived");
    const eventNames = (await db.domainEvent.findMany({ where: { organisationId: organisation.id, aggregateType: "storage_object" } })).map(({ name }) => name);
    expect(eventNames).toContain("document.uploaded");
  });

  it("enforces the malware scan hook end-to-end (clean, infected, and provider-error paths)", async () => {
    const owner = await registerUser({ displayName: "Scan Owner", email: "scan-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Scan Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const property = await createProperty(owner.id, organisation.id, {
      name: "Scan House", referenceNumber: "SCAN-001", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [],
    });
    const request = await createMaintenanceRequest(owner.id, organisation.id, {
      propertyId: property.id, title: "Leaking tap", description: "The kitchen tap is leaking steadily.", category: "plumbing",
    });

    let nextResult: { status: string } = { status: "clean" };
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(nextResult));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Failed to bind malware scan test server.");
    process.env.MALWARE_SCAN_BASE_URL = `http://127.0.0.1:${address.port}`;

    try {
      nextResult = { status: "clean" };
      const clean = await uploadOrganisationDocument(owner.id, organisation.id, {
        targetType: "MAINTENANCE_ATTACHMENT", targetId: request.id, fileName: "tap.jpg", contentType: "image/jpeg", dataBase64: base64(JPEG_BYTES),
      });
      expect(clean.storageObject.malwareScanStatus).toBe("CLEAN");

      nextResult = { status: "infected" };
      await expect(uploadOrganisationDocument(owner.id, organisation.id, {
        targetType: "MAINTENANCE_ATTACHMENT", targetId: request.id, fileName: "virus.jpg", contentType: "image/jpeg", dataBase64: base64(JPEG_BYTES),
      })).rejects.toMatchObject({ code: "MALWARE_DETECTED" });
      const infectedCount = await db.storageObject.count({ where: { organisationId: organisation.id, malwareScanStatus: "INFECTED" } });
      expect(infectedCount).toBe(0); // an infected file is never persisted as a StorageObject row.

      await new Promise<void>((resolve) => server.close(() => resolve()));
      await expect(uploadOrganisationDocument(owner.id, organisation.id, {
        targetType: "MAINTENANCE_ATTACHMENT", targetId: request.id, fileName: "unreachable.jpg", contentType: "image/jpeg", dataBase64: base64(JPEG_BYTES),
      })).rejects.toMatchObject({ code: "MALWARE_SCAN_FAILED" });
    } finally {
      server.close();
      delete process.env.MALWARE_SCAN_BASE_URL;
    }
  });

  it("connects media to move-in and move-out inspections (item 2), appending real files to the correct inspection area", async () => {
    const owner = await registerUser({ displayName: "Inspection Owner", email: "inspection-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Inspection Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const ownerMember = await db.organisationMember.findFirstOrThrow({ where: { organisationId: organisation.id, userId: owner.id } });
    const property = await createProperty(owner.id, organisation.id, { name: "Inspection House", referenceNumber: "INSP-001", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }] });
    const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
    const { relationship } = await createTenant(owner.id, organisation.id, { legalName: "Inspection Tenant", email: "inspection-tenant@example.com", countryCode: "GH" });
    const lease = await createLease(owner.id, organisation.id, {
      referenceNumber: "INSP-LEASE-001", propertyId: property.id, unitId: unit.id, tenantOrganisationIds: [relationship.id],
      startDate: "2026-01-01", endDate: "2026-12-31", rentAmountMinor: "150000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE",
    });

    await scheduleMoveIn(owner.id, organisation.id, lease.id, { scheduledDate: "2026-01-01", responsibleMemberId: ownerMember.id });
    const moveInInspection = await createMoveInInspection(owner.id, organisation.id, lease.id, {
      inspectorMemberId: ownerMember.id, inspectedAt: "2026-01-01T09:00:00Z", overallCondition: "GOOD",
      areas: [{ name: "Kitchen", condition: "GOOD" }],
    });
    const moveInArea = moveInInspection.areas[0]!;
    const moveInUpload = await uploadOrganisationDocument(owner.id, organisation.id, {
      targetType: "MOVE_IN_INSPECTION_MEDIA", targetId: moveInInspection.id, areaId: moveInArea.id,
      fileName: "kitchen-move-in.jpg", contentType: "image/jpeg", dataBase64: base64(JPEG_BYTES),
    });
    const refreshedMoveInArea = await db.moveInInspectionArea.findUniqueOrThrow({ where: { id: moveInArea.id } });
    expect(refreshedMoveInArea.media).toEqual([{ storageObjectId: moveInUpload.storageObject.id, storageKey: moveInUpload.storageObject.storageKey, fileName: "kitchen-move-in.jpg", contentType: "image/jpeg" }]);
    // Wrong inspection/area combination is rejected, never silently attached to the wrong record.
    await expect(uploadOrganisationDocument(owner.id, organisation.id, {
      targetType: "MOVE_IN_INSPECTION_MEDIA", targetId: moveInInspection.id, areaId: "00000000-0000-4000-8000-000000000000",
      fileName: "wrong-area.jpg", contentType: "image/jpeg", dataBase64: base64(JPEG_BYTES),
    })).rejects.toMatchObject({ code: "INVALID_INSPECTION_AREA" });

    const moveOut = await scheduleMoveOut(owner.id, organisation.id, lease.id, { scheduledDate: "2026-12-01", responsibleMemberId: ownerMember.id });
    // Move-out inspection evidence must exist *before* the inspection is created (Phase 12 makes
    // completed inspection areas permanently immutable): upload against the MoveOut record first,
    // then embed the resulting storage key when creating the (atomically immutable) inspection.
    const preUpload = await uploadOrganisationDocument(owner.id, organisation.id, {
      targetType: "MOVE_OUT_INSPECTION_MEDIA", targetId: moveOut.id,
      fileName: "kitchen-damage.jpg", contentType: "image/jpeg", dataBase64: base64(JPEG_BYTES),
    });
    const moveOutInspection = await createMoveOutInspection(owner.id, organisation.id, lease.id, {
      inspectorMemberId: ownerMember.id, inspectedAt: "2026-12-01T09:00:00Z", overallCondition: "FAIR", cleaningCondition: "CLEANING_REQUIRED",
      areas: [{ name: "Kitchen", condition: "DAMAGED", media: [{ storageKey: preUpload.storageObject.storageKey, fileName: "kitchen-damage.jpg", contentType: "image/jpeg" }] }],
    });
    const moveOutArea = moveOutInspection.areas[0]!;
    expect(moveOutArea.media).toEqual([{ storageKey: preUpload.storageObject.storageKey, fileName: "kitchen-damage.jpg", contentType: "image/jpeg" }]);
    // Uploading further evidence against the MoveOut record itself still works after the
    // inspection is completed — only the completed MoveOutInspectionArea row is immutable.
    const lateUpload = await uploadOrganisationDocument(owner.id, organisation.id, {
      targetType: "MOVE_OUT_INSPECTION_MEDIA", targetId: moveOut.id,
      fileName: "late-photo.jpg", contentType: "image/jpeg", dataBase64: base64(JPEG_BYTES),
    });
    expect(lateUpload.storageObject.id).toBeTruthy();

    // Both inspection media types are discoverable via the Document Center, scoped by inspection id.
    const byMoveInInspection = await listDocumentCenter(owner.id, organisation.id, { inspectionId: moveInInspection.id });
    expect(byMoveInInspection.items.map((item) => item.id)).toEqual([moveInUpload.storageObject.id]);
    const byMoveOutInspection = await listDocumentCenter(owner.id, organisation.id, { inspectionId: moveOutInspection.id });
    expect(byMoveOutInspection.items.map((item) => item.id)).toContain(preUpload.storageObject.id);
  });

  it("requires organisation-scoped document.manage (not merely read access) to archive/restore a StorageObject", async () => {
    const owner = await registerUser({ displayName: "Archive Owner", email: "archive-owner@example.com", password: "secure-password-123" });
    const manager = await registerUser({ displayName: "Archive Manager", email: "archive-manager@example.com", password: "secure-password-123" });
    const viewer = await registerUser({ displayName: "Archive Viewer", email: "archive-viewer@example.com", password: "secure-password-123" });
    const tenantUser = await registerUser({ displayName: "Archive Tenant", email: "archive-tenant@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Archive Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await addMember(organisation.id, manager.id, "property_manager");
    await addMember(organisation.id, viewer.id, "viewer");
    const property = await createProperty(owner.id, organisation.id, {
      name: "Archive House", referenceNumber: "ARCH-001", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }],
    });
    const listing = await createListing(owner.id, organisation.id, {
      propertyId: property.id, listingType: "RENT", category: "apartment", title: "Archive listing",
      publicDescription: "A listing used to validate archive/restore write-permission enforcement end to end.",
      rentAmountMinor: "300000", currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-09-01", countryCode: "GH",
    });
    const { relationship } = await createTenant(owner.id, organisation.id, { legalName: "Archive Tenant Org", email: "archive-tenant@example.com", countryCode: "GH" });
    await db.tenantOrganisation.update({ where: { id: relationship.id }, data: { userId: tenantUser.id } });

    const upload = await uploadOrganisationDocument(owner.id, organisation.id, {
      targetType: "LISTING_MEDIA", targetId: listing.id, mediaType: "PHOTO",
      fileName: "archive-target.jpg", contentType: "image/jpeg", dataBase64: base64(JPEG_BYTES),
    });

    // A viewer only holds `document.read` (and `listing.read`) — reading is not enough to archive.
    await expect(archiveStorageObject(viewer.id, organisation.id, upload.storageObject.id, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    // A tenant, who has no staff permissions at all, is likewise denied.
    await expect(archiveStorageObject(tenantUser.id, organisation.id, upload.storageObject.id, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.storageObject.findUniqueOrThrow({ where: { id: upload.storageObject.id } })).archivedAt).toBeNull();

    // A manager holding `document.manage` succeeds.
    await archiveStorageObject(manager.id, organisation.id, upload.storageObject.id, { reason: "No longer needed" });
    expect((await db.storageObject.findUniqueOrThrow({ where: { id: upload.storageObject.id } })).archivedAt).not.toBeNull();

    // The same enforcement applies to restore: viewer/tenant denied, manager (document.manage) succeeds.
    await expect(restoreStorageObject(viewer.id, organisation.id, upload.storageObject.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(restoreStorageObject(tenantUser.id, organisation.id, upload.storageObject.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.storageObject.findUniqueOrThrow({ where: { id: upload.storageObject.id } })).archivedAt).not.toBeNull();
    await restoreStorageObject(manager.id, organisation.id, upload.storageObject.id);
    expect((await db.storageObject.findUniqueOrThrow({ where: { id: upload.storageObject.id } })).archivedAt).toBeNull();
  });

  afterEach(() => {
    delete process.env.STORAGE_MAX_UPLOAD_BYTES;
    delete process.env.MALWARE_SCAN_BASE_URL;
  });
});
