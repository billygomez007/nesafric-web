import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { addMaintenanceNote, createMaintenanceRequest } from "@/modules/maintenance/service";
import { advanceReport } from "@/modules/whatsapp-assistant/maintenance/report";
import { assistantStateSchema } from "@/modules/whatsapp-assistant/schemas";
import { getObjectStorageAdapter } from "@/platform/storage/registry";
import { db } from "@/platform/database/client";
import { createLease } from "./helpers/lease";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// A minimal JPEG (SOI + JFIF header) that the upload pipeline's content sniffing accepts.
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge", "StorageObject" CASCADE');
  await db.tenant.deleteMany();
}

async function memberWith(organisationId: string, email: string, keys: string[]) {
  const user = await registerUser({ displayName: email, email, password: "secure-password-123" });
  const member = await db.organisationMember.create({ data: { organisationId, userId: user.id } });
  const permissions = await db.permission.findMany({ where: { key: { in: keys } } });
  const role = await db.role.create({ data: { key: `test_${randomUUID()}`, name: email, isSystem: false, permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) } } });
  await db.membershipRole.create({ data: { memberId: member.id, roleId: role.id } });
  return { user, member };
}

async function tenancy(landlordId: string, organisationId: string, propertyId: string, unitId: string, name: string, reference: string) {
  const user = await registerUser({ displayName: name, email: `${reference.toLowerCase()}@example.com`, password: "secure-password-123" });
  const { relationship } = await createTenant(landlordId, organisationId, { legalName: name });
  await db.tenantOrganisation.update({ where: { id: relationship.id }, data: { userId: user.id } });
  await createLease(landlordId, organisationId, { referenceNumber: reference, propertyId, unitId, tenantOrganisationIds: [relationship.id], startDate: "2026-01-01", rentAmountMinor: "100000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE" });
  return { user, relationship };
}

async function fixture() {
  const landlord = await registerUser({ displayName: "Ama Owusu", email: "ama@example.com", password: "secure-password-123" });
  const organisation = await createOrganisation(landlord.id, { name: "Owusu Homes", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
  const property = await createProperty(landlord.id, organisation.id, { name: "Palm Court", referenceNumber: "PC-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }, { name: "A2" }] });
  const [unitA, unitB] = await db.unit.findMany({ where: { propertyId: property.id }, orderBy: { name: "asc" } });
  return { landlord, organisation, property, unitA, unitB };
}
type Context = Awaited<ReturnType<typeof fixture>>;

const request = (context: Context, overrides: Record<string, unknown>) => ({ propertyId: context.property.id, title: "Kitchen pipe leaking", description: "The kitchen pipe is leaking", category: "plumbing", ...overrides });
const keysOf = (value: unknown) => Object.keys(value as object).sort();

describe("PostgreSQL #41 review findings: idempotent returns and media attachments", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_PROVIDER_ACCESS_TOKEN", "test-token");
    vi.stubEnv("WHATSAPP_GRAPH_API_VERSION", "v21.0");
    await cleanDatabase();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  afterAll(async () => {
    await cleanDatabase();
    await db.role.deleteMany({ where: { key: { startsWith: "test_" }, isSystem: false } });
    await db.$disconnect();
  });

  describe("re-authorising an idempotent return", () => {
    it("gives a creator without maintenance.read only a receipt, never the request's internal details", async () => {
      const context = await fixture();
      const { user: creator } = await memberWith(context.organisation.id, "creator@example.com", ["maintenance.create"]);
      const input = request(context, { intakeReference: "web:form-123" });
      const first = await createMaintenanceRequest(creator.id, context.organisation.id, input) as { id: string };
      await addMaintenanceNote(context.landlord.id, context.organisation.id, first.id, { note: "STAFF-ONLY: tenant owes two months" });
      const replay = await createMaintenanceRequest(creator.id, context.organisation.id, input);
      expect(keysOf(replay)).toEqual(["createdAt", "id", "referenceNumber", "status"]);
      expect((replay as { id: string }).id).toBe(first.id);
      expect(JSON.stringify(replay)).not.toContain("STAFF-ONLY");
    });

    it("refuses a replay once the reporter no longer has the request's tenancy, even with another tenancy of their own", async () => {
      const context = await fixture();
      const tenant = await tenancy(context.landlord.id, context.organisation.id, context.property.id, context.unitA.id, "Kofi", "L-A");
      const original = request(context, { unitId: context.unitA.id, tenantOrganisationId: tenant.relationship.id, intakeReference: "whatsapp:wamid.revoked" });
      const first = await createMaintenanceRequest(tenant.user.id, context.organisation.id, original) as { id: string };
      // The landlord moves Kofi to a new tenancy record; the old one is no longer his.
      await db.tenantOrganisation.update({ where: { id: tenant.relationship.id }, data: { userId: null } });
      const { relationship: newTenancy } = await createTenant(context.landlord.id, context.organisation.id, { legalName: "Kofi (new lease)" });
      await db.tenantOrganisation.update({ where: { id: newTenancy.id }, data: { userId: tenant.user.id } });
      await createLease(context.landlord.id, context.organisation.id, { referenceNumber: "L-A2", propertyId: context.property.id, unitId: context.unitB.id, tenantOrganisationIds: [newTenancy.id], startDate: "2026-02-01", rentAmountMinor: "100000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE" });

      await expect(createMaintenanceRequest(tenant.user.id, context.organisation.id, { ...original, unitId: context.unitB.id, tenantOrganisationId: newTenancy.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(createMaintenanceRequest(tenant.user.id, context.organisation.id, original)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await db.maintenanceRequest.count()).toBe(1);
      expect((await db.maintenanceRequest.findUniqueOrThrow({ where: { id: first.id } })).tenantOrganisationId).toBe(tenant.relationship.id);
    });

    it("does not let another tenant reach a request through its reference", async () => {
      const context = await fixture();
      const kofi = await tenancy(context.landlord.id, context.organisation.id, context.property.id, context.unitA.id, "Kofi", "L-K");
      const esi = await tenancy(context.landlord.id, context.organisation.id, context.property.id, context.unitB.id, "Esi", "L-E");
      await createMaintenanceRequest(kofi.user.id, context.organisation.id, request(context, { unitId: context.unitA.id, tenantOrganisationId: kofi.relationship.id, intakeReference: "whatsapp:wamid.kofi" }));
      await expect(createMaintenanceRequest(esi.user.id, context.organisation.id, request(context, { unitId: context.unitB.id, tenantOrganisationId: esi.relationship.id, intakeReference: "whatsapp:wamid.kofi" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("returns the same request, with the caller's usual view, on an authorised retry", async () => {
      const context = await fixture();
      const tenant = await tenancy(context.landlord.id, context.organisation.id, context.property.id, context.unitA.id, "Kofi", "L-R");
      const input = request(context, { unitId: context.unitA.id, tenantOrganisationId: tenant.relationship.id, intakeReference: "whatsapp:wamid.retry" });
      const first = await createMaintenanceRequest(tenant.user.id, context.organisation.id, input) as { id: string };
      await addMaintenanceNote(context.landlord.id, context.organisation.id, first.id, { note: "STAFF-ONLY note" });
      const again = await createMaintenanceRequest(tenant.user.id, context.organisation.id, input) as { id: string; referenceNumber: string };
      expect(again.id).toBe(first.id);
      expect(again).not.toHaveProperty("history");
      expect(JSON.stringify(again)).not.toContain("STAFF-ONLY");
      const staff = await createMaintenanceRequest(context.landlord.id, context.organisation.id, request(context, { intakeReference: "web:staff-1" })) as { id: string };
      const staffAgain = await createMaintenanceRequest(context.landlord.id, context.organisation.id, request(context, { intakeReference: "web:staff-1" }));
      expect(staffAgain).toMatchObject({ id: staff.id, history: expect.any(Array) });
      expect(await db.maintenanceRequest.count()).toBe(2);
    });
  });

  describe("one attachment per WhatsApp photo", () => {
    const failing = new Set<string>();
    beforeEach(() => {
      failing.clear();
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        const id = /graph\.facebook\.com\/v21\.0\/(\d+)/.exec(String(url))?.[1];
        if (id) return failing.has(id) ? new Response("{}", { status: 500 }) : new Response(JSON.stringify({ url: `https://lookaside.fbsbx.com/media/${id}`, mime_type: "image/jpeg", file_size: JPEG.length }));
        return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
      }));
    });

    async function reportState(context: Context, media: string[]) {
      const tenant = await tenancy(context.landlord.id, context.organisation.id, context.property.id, context.unitA.id, "Kofi", "L-M");
      const state = assistantStateSchema.parse({ workflow: "report", report: {
        step: "confirm", selected: 0, description: "The kitchen pipe is leaking", media: media.map((id) => ({ id, mimeType: "image/jpeg" })),
        choices: [{ tenantOrganisationId: tenant.relationship.id, organisationId: context.organisation.id, organisationName: "Owusu Homes", propertyId: context.property.id, propertyName: "Palm Court", unitId: context.unitA.id, unitName: "A1" }],
        classification: { category: "plumbing", priority: "URGENT", safetyHazard: false, title: "Kitchen pipe leaking", source: "rules" },
      } });
      return { tenant, state, linked: { user: { id: tenant.user.id, displayName: "Kofi" } }, reset: () => assistantStateSchema.parse({}) };
    }
    const outcome = async () => {
      const [request] = await db.maintenanceRequest.findMany({ include: { attachments: true } });
      const objects = await db.storageObject.findMany({ where: { targetType: "MAINTENANCE_ATTACHMENT" } });
      const stored = await Promise.all(objects.map(async (object) => Boolean(await getObjectStorageAdapter().getObject(object.storageKey, "PRIVATE"))));
      return { tickets: await db.maintenanceRequest.count(), files: request?.attachments.map((attachment) => attachment.fileName).sort() ?? [], storageObjects: objects.length, allStored: stored.every(Boolean) };
    };

    it("attaches each distinct photo once when several workers confirm the same message at once, with no orphaned files", async () => {
      const context = await fixture();
      const { state, linked, reset } = await reportState(context, ["1111", "2222"]);
      const adapter = getObjectStorageAdapter();
      const puts = vi.spyOn(adapter, "putObject");
      const deletes = vi.spyOn(adapter, "deleteObject");
      const confirm = () => advanceReport({ body: "confirm", kind: "text", messageId: "wamid.media.race" }, linked, state, reset);
      const replies = await Promise.all([confirm(), confirm(), confirm(), confirm()]);
      expect(replies.every((reply) => reply?.reply.includes("Photos saved: 2 of 2"))).toBe(true);
      expect(await outcome()).toEqual({ tickets: 1, files: ["whatsapp-1111.jpg", "whatsapp-2222.jpg"], storageObjects: 2, allStored: true });
      // Every byte stored by a losing worker was deleted again.
      expect(puts.mock.calls.length - deletes.mock.calls.length).toBe(2);
    });

    it("keeps a failed photo retryable, and the retry adds only what is missing", async () => {
      const context = await fixture();
      const { state, linked, reset } = await reportState(context, ["1111", "2222", "3333"]);
      failing.add("2222");
      const first = await advanceReport({ body: "confirm", kind: "text", messageId: "wamid.media.retry" }, linked, state, reset);
      expect(first?.reply).toContain("Photos saved: 2 of 3");
      expect((await outcome()).files).toEqual(["whatsapp-1111.jpg", "whatsapp-3333.jpg"]);

      // Storage itself fails once on the retry, then works.
      failing.clear();
      const put = vi.spyOn(getObjectStorageAdapter(), "putObject").mockRejectedValueOnce(new Error("storage unavailable"));
      const second = await advanceReport({ body: "confirm", kind: "text", messageId: "wamid.media.retry" }, linked, state, reset);
      expect(second?.reply).toContain("Photos saved: 2 of 3");
      put.mockRestore();
      const third = await advanceReport({ body: "confirm", kind: "text", messageId: "wamid.media.retry" }, linked, state, reset);
      expect(third?.reply).toContain("Photos saved: 3 of 3");
      expect(await outcome()).toEqual({ tickets: 1, files: ["whatsapp-1111.jpg", "whatsapp-2222.jpg", "whatsapp-3333.jpg"], storageObjects: 3, allStored: true });
    });
  });
});
