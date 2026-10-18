import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as officialPost } from "@/app/api/webhooks/whatsapp/route";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createTenantAccessInvitation } from "@/modules/tenants/access-invitations";
import { createMaintenanceRequest } from "@/modules/maintenance/service";
import { defaultChannelAdapters, type ChannelAdapters } from "@/modules/conversations/channels/registry";
import { linkWhatsAppIdentity } from "@/modules/whatsapp-assistant/identity";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";
import { db } from "@/platform/database/client";
import { connectWhatsAppChannel } from "./helpers/whatsapp-channel";
import { createLease } from "./helpers/lease";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SECRET = "test-app-secret";
const PHONE_NUMBER_ID = "100200300";
const TENANT = "233245550001";
// A minimal JPEG (SOI + JFIF header) so the upload pipeline's content sniffing accepts it.
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge", "StorageObject" CASCADE');
  await db.tenant.deleteMany();
}

let counter = 0;
const sent: string[] = [];
const adapters: ChannelAdapters = { ...defaultChannelAdapters, WHATSAPP: { ...defaultChannelAdapters.WHATSAPP, channel: "WHATSAPP", send: async (request) => { sent.push(request.body); return { status: "SENT", providerReference: `wamid.out.${++counter}` }; }, normalizeInbound: () => [], verifyWebhookSignature: () => ({ verified: false }) } };

async function deliver(message: Record<string, unknown>) {
  const before = sent.length;
  const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "555", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, messages: [{ from: TENANT, timestamp: String(Math.floor(Date.now() / 1000)), ...message }] } }] }] });
  const response = await officialPost(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(payload).digest("hex")}` }, body: payload }));
  expect(response.status).toBe(200);
  await runDueJobs(createJobHandlers(undefined, adapters));
  await runDueJobs(createJobHandlers(undefined, adapters));
  await db.message.updateMany({ where: { direction: "INBOUND", processedAt: { not: null } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  return sent.slice(before).join("\n---\n");
}
const say = (body: string, id = `wamid.${++counter}`) => deliver({ id, type: "text", text: { body } });
const photo = (mediaId: string) => deliver({ id: `wamid.${++counter}`, type: "image", image: { id: mediaId, mime_type: "image/jpeg" } });

async function fixture() {
  const staff = await registerUser({ displayName: "NesAfric Support", email: "support@example.com", password: "secure-password-123" });
  const official = await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
  await connectWhatsAppChannel(staff.id, official.id, { enabled: true, config: { phoneNumberId: PHONE_NUMBER_ID, businessAccountId: "555", marketplaceAssistantEnabled: true } });
  vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.id);
  const landlord = await registerUser({ displayName: "Ama Owusu", email: "ama@example.com", password: "secure-password-123" });
  const organisation = await createOrganisation(landlord.id, { name: "Owusu Homes", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
  const property = await createProperty(landlord.id, organisation.id, { name: "Palm Court", referenceNumber: "PC-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }, { name: "A2" }] });
  const units = await db.unit.findMany({ where: { propertyId: property.id }, orderBy: { name: "asc" } });
  const tenantUser = await registerUser({ displayName: "Kofi Mensah", email: "kofi@example.com", password: "secure-password-123" });
  const { relationship } = await createTenant(landlord.id, organisation.id, { legalName: "Kofi Mensah", phone: `+${TENANT}` });
  await createLease(landlord.id, organisation.id, { referenceNumber: "L-1", propertyId: property.id, unitId: units[0].id, tenantOrganisationIds: [relationship.id], startDate: "2026-01-01", rentAmountMinor: "150000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE" });
  return { official, landlord, organisation, property, units, tenantUser, relationship };
}

/** Connect the tenancy to the tenant's account the way the landlord's access code does. */
async function connectTenancy(context: Awaited<ReturnType<typeof fixture>>) {
  await db.tenantOrganisation.update({ where: { id: context.relationship.id }, data: { userId: context.tenantUser.id } });
  await linkWhatsAppIdentity(TENANT, context.tenantUser.id, "SMS_OTP", context.official.id);
}

describe("PostgreSQL WhatsApp tenant maintenance reports", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    vi.stubEnv("WHATSAPP_PROVIDER_ACCESS_TOKEN", "test-token");
    vi.stubEnv("WHATSAPP_GRAPH_API_VERSION", "v21.0");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).startsWith("https://graph.facebook.com/")
      ? new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/media/1", mime_type: "image/jpeg", file_size: JPEG.length }))
      : new Response(JPEG, { headers: { "content-type": "image/jpeg" } })));
    sent.length = 0;
    await cleanDatabase();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("creates a referenced ticket with the photo from a tenant's WhatsApp report, once", async () => {
    const context = await fixture();
    await connectTenancy(context);
    expect(await say("The pipe under my kitchen sink is leaking since this morning")).toContain("Send up to 5 photos");
    expect(await photo("998877")).toContain("Photo 1 received");
    const confirm = await say("done");
    expect(confirm).toContain("Palm Court, A1");
    expect(confirm).toContain("Plumbing");
    expect(confirm).toContain("Urgency: urgent");
    const saved = await say("confirm", "wamid.confirm");
    expect(saved).toContain("Request NM-1001 is logged with Owusu Homes");
    expect(saved).toContain("Photos saved: 1 of 1");
    await say("confirm", "wamid.confirm");

    const requests = await db.maintenanceRequest.findMany({ where: { organisationId: context.organisation.id }, include: { attachments: true } });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ referenceNumber: "NM-1001", intakeChannel: "WHATSAPP", category: "plumbing", priority: "URGENT", tenantOrganisationId: context.relationship.id, unitId: context.units[0].id, reportedByUserId: context.tenantUser.id, originalReport: "The pipe under my kitchen sink is leaking since this morning" });
    expect(requests[0].attachments.map((attachment) => attachment.fileName)).toEqual(["whatsapp-998877.jpg"]);
    expect(await db.storageObject.count({ where: { targetType: "MAINTENANCE_ATTACHMENT", classification: "PRIVATE" } })).toBe(1);
    expect(await say("status NM-1001")).toContain("NM-1001: The pipe under my kitchen sink is leaking since this morning at Palm Court, A1 — received");
  });

  it("adds a repeated report to the open ticket instead of creating another", async () => {
    const context = await fixture();
    await connectTenancy(context);
    await say("report");
    await say("The kitchen tap is leaking");
    await say("skip");
    await say("confirm");
    await say("The kitchen tap is still leaking, worse now");
    expect(await say("skip")).toContain("You already have an open request NM-1001");
    await say("same");
    expect(await say("confirm")).toContain("Added to NM-1001");
    expect(await db.maintenanceRequest.count()).toBe(1);
    expect(await db.maintenanceHistory.count({ where: { type: "NOTE", note: { contains: "worse now" } } })).toBe(1);
  });

  it("never links a tenancy from a matching phone number alone, and reveals nothing before linking", async () => {
    const context = await fixture();
    // The landlord's tenant record has this number, but the tenancy was never connected to an account.
    const stranger = await registerUser({ displayName: "Someone Else", email: "someone@example.com", password: "secure-password-123" });
    expect(await say("report")).toContain("connect this WhatsApp number");
    await linkWhatsAppIdentity(TENANT, stranger.id, "SMS_OTP", context.official.id);
    const reply = await say("report");
    expect(reply).toContain("No active tenancy is connected");
    expect(reply).not.toContain("Palm Court");
    expect((await db.tenantOrganisation.findUniqueOrThrow({ where: { id: context.relationship.id } })).userId).toBeNull();
    expect(await db.maintenanceRequest.count()).toBe(0);
  });

  it("connects the tenancy with the landlord's access code, and removes the code from the transcript", async () => {
    const context = await fixture();
    await linkWhatsAppIdentity(TENANT, context.tenantUser.id, "SMS_OTP", context.official.id);
    const { code } = await createTenantAccessInvitation(context.landlord.id, context.organisation.id, context.relationship.id);
    expect(await say(code)).toContain("Your tenancy is connected: Palm Court, A1 (Owusu Homes)");
    expect((await db.tenantOrganisation.findUniqueOrThrow({ where: { id: context.relationship.id } })).userId).toBe(context.tenantUser.id);
    expect(await db.message.count({ where: { body: code } })).toBe(0);
    expect(await say("NT-AAAAA-BBBBB-CCCCC-DDDDD")).toContain("not valid");
  });

  it("asks which home when the tenant has several, and flags emergencies", async () => {
    const context = await fixture();
    await connectTenancy(context);
    await createLease(context.landlord.id, context.organisation.id, { referenceNumber: "L-2", propertyId: context.property.id, unitId: context.units[1].id, tenantOrganisationIds: [context.relationship.id], startDate: "2026-02-01", rentAmountMinor: "90000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE" });
    expect(await say("Sparks and smoke are coming from the socket")).toContain("Which home is this about?");
    await say("2");
    const confirm = await say("skip");
    expect(confirm).toContain("Palm Court, A2");
    expect(confirm).toContain("Urgency: emergency");
    expect(confirm).toContain("112");
    await say("confirm");
    expect(await db.maintenanceRequest.findFirstOrThrow()).toMatchObject({ priority: "EMERGENCY", category: "electrical", unitId: context.units[1].id });
  });

  it("numbers web-created requests in the same sequence", async () => {
    const context = await fixture();
    const first = await createMaintenanceRequest(context.landlord.id, context.organisation.id, { propertyId: context.property.id, title: "Gate hinge", description: "The gate hinge is loose.", category: "carpentry" }) as { referenceNumber: string | null };
    const second = await createMaintenanceRequest(context.landlord.id, context.organisation.id, { propertyId: context.property.id, title: "Roof", description: "Roof sheet loose.", category: "roofing" }) as { referenceNumber: string | null };
    expect([first.referenceNumber, second.referenceNumber]).toEqual(["NM-1001", "NM-1002"]);
  });
});
