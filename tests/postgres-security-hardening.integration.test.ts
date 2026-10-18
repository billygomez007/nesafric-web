import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as officialPost } from "@/app/api/webhooks/whatsapp/route";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createMaintenanceRequest } from "@/modules/maintenance/service";
import { upsertChannelConfig } from "@/modules/conversations/service";
import { defaultChannelAdapters, type ChannelAdapters } from "@/modules/conversations/channels/registry";
import type { OutboundMessageRequest } from "@/modules/conversations/channels/types";
import { linkWhatsAppIdentity, setWhatsAppOptOut, unlinkWhatsAppIdentity } from "@/modules/whatsapp-assistant/identity";
import { safeTemplateText } from "@/modules/whatsapp-assistant/outbound";
import { inviteNetworkProvider, respondToInvitation } from "@/modules/provider-network/service";
import { createRoutingRule, updateRoutingRule } from "@/modules/maintenance-routing/rules";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";
import { db } from "@/platform/database/client";
import { connectWhatsAppChannel } from "./helpers/whatsapp-channel";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SECRET = "test-app-secret";
const PHONE_NUMBER_ID = "100200300";
const LANDLORD = "233241234567";
const KWAME = "233201234567";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge" CASCADE');
  await db.tenant.deleteMany();
}

let counter = 0;
const sent: OutboundMessageRequest[] = [];
const adapters: ChannelAdapters = { ...defaultChannelAdapters, WHATSAPP: { ...defaultChannelAdapters.WHATSAPP, channel: "WHATSAPP", send: async (request) => { sent.push(request); return { status: "SENT", providerReference: `wamid.out.${++counter}` }; }, normalizeInbound: () => [], verifyWebhookSignature: () => ({ verified: false }) } };
const work = async () => { await runDueJobs(createJobHandlers(undefined, adapters)); await runDueJobs(createJobHandlers(undefined, adapters)); };

async function say(from: string, body: string) {
  const before = sent.length;
  const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "555", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, messages: [{ id: `wamid.${++counter}`, from, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }] } }] }] });
  expect((await officialPost(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(payload).digest("hex")}` }, body: payload }))).status).toBe(200);
  await work();
  await db.message.updateMany({ where: { direction: "INBOUND", processedAt: { not: null } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  return sent.slice(before).filter((request) => request.recipientAddress === from).map((request) => request.body).join("\n---\n");
}

async function fixture() {
  const staff = await registerUser({ displayName: "NesAfric Support", email: "support@example.com", password: "secure-password-123" });
  const official = await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
  await connectWhatsAppChannel(staff.id, official.id, { enabled: true, config: { phoneNumberId: PHONE_NUMBER_ID, businessAccountId: "555", marketplaceAssistantEnabled: true } });
  vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.id);
  const landlord = await registerUser({ displayName: "Ama Owusu", email: "ama@example.com", password: "secure-password-123" });
  const organisation = await createOrganisation(landlord.id, { name: "Owusu Homes", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
  await linkWhatsAppIdentity(LANDLORD, landlord.id, "SMS_OTP", official.id);
  const property = await createProperty(landlord.id, organisation.id, { name: "Palm Court", referenceNumber: "PC-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }] });
  const kwame = (await respondToInvitation((await inviteNetworkProvider(landlord.id, organisation.id, { displayName: "Kwame Plumbing", phone: `+${KWAME}`, scopeCategories: ["plumbing"], autoDispatchAllowed: true })).id, `+${KWAME}`, true)).providerOrganisationId!;
  const rule = await createRoutingRule(landlord.id, organisation.id, { name: "Plumbing", category: "plumbing", primaryProviderOrganisationId: kwame, authorizationMode: "PRE_AUTHORIZED", spendingCapMinor: "20000" });
  const report = () => createMaintenanceRequest(landlord.id, organisation.id, { propertyId: property.id, title: "Pipe leaking", description: "Kitchen pipe leaking", category: "plumbing", priority: "URGENT", intakeChannel: "WHATSAPP" }) as Promise<{ id: string; referenceNumber: string }>;
  sent.length = 0;
  return { staff, official, landlord, organisation, property, kwame, rule, report };
}

describe("PostgreSQL security hardening", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    vi.stubEnv("WHATSAPP_TEMPLATE_WORK_ORDER", "nesafric_work_order:en");
    vi.stubEnv("WHATSAPP_TEMPLATE_NOTIFICATION", "nesafric_notification:en");
    vi.stubEnv("WHATSAPP_TEMPLATE_PROVIDER_INVITE", "nesafric_provider_invite:en");
    sent.length = 0;
    await cleanDatabase();
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("never approves a quote other than the one the landlord was shown", async () => {
    const context = await fixture();
    const request = await context.report();
    await work();
    await say(KWAME, `accept ${request.referenceNumber}`);
    await say(KWAME, `quote ${request.referenceNumber} 300`);
    expect(await say(LANDLORD, `approve ${request.referenceNumber}`)).toContain("GHS 300.00");
    await say(KWAME, `quote ${request.referenceNumber} 5000`);
    expect(await say(LANDLORD, "confirm")).toContain("replaced or already decided");
    expect(await db.maintenanceApproval.count({ where: { status: "APPROVED" } })).toBe(0);
    expect((await db.workOrder.findFirstOrThrow({ where: { maintenanceRequestId: request.id } })).authorizedSpendMinor).toBe(BigInt(20000));
  });

  it("sends nothing business-initiated to a number that replied STOP", async () => {
    const context = await fixture();
    await setWhatsAppOptOut(db, KWAME, true);
    const request = await context.report();
    await work();
    expect(await db.maintenanceDispatchAttempt.findFirstOrThrow({ where: { maintenanceRequestId: request.id } })).toMatchObject({ status: "CONTACT_FAILED", reason: expect.stringContaining("opted out") });
    expect(sent).toHaveLength(0);
    const invitation = await inviteNetworkProvider(context.landlord.id, context.organisation.id, { displayName: "Kwame again", phone: `+${KWAME}`, scopeCategories: ["hvac"] }).catch((error) => error);
    expect(invitation.code ?? invitation.deliveryFailureReason).toBeTruthy();
  });

  it("limits invitations and keeps customer text out of official templates", async () => {
    const context = await fixture();
    const declined = await inviteNetworkProvider(context.landlord.id, context.organisation.id, { displayName: "Esi", phone: "+233205550001", scopeCategories: ["cleaning"] });
    await respondToInvitation(declined.id, "+233205550001", false);
    await expect(inviteNetworkProvider(context.landlord.id, context.organisation.id, { displayName: "Esi", phone: "+233205550001", scopeCategories: ["cleaning"] })).rejects.toMatchObject({ code: "RECENTLY_DECLINED" });
    for (let index = 0; index < 18; index += 1) await inviteNetworkProvider(context.landlord.id, context.organisation.id, { displayName: `P${index}`, phone: `+23320555${String(1000 + index)}`, scopeCategories: ["cleaning"] });
    await expect(inviteNetworkProvider(context.landlord.id, context.organisation.id, { displayName: "One more", phone: "+233205559999", scopeCategories: ["cleaning"] })).rejects.toMatchObject({ code: "INVITATION_LIMIT" });
    expect(safeTemplateText("Your MoMo is locked, call +233 24 123 4567 or visit https://evil.example/x now")).toBe("Your MoMo is locked, call or visit now");
  });

  it("does not let an organisation use a WhatsApp number that belongs to another", async () => {
    const context = await fixture();
    const other = await registerUser({ displayName: "Other", email: "other@example.com", password: "secure-password-123" });
    const otherOrganisation = await createOrganisation(other.id, { name: "Other Estates", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    await expect(upsertChannelConfig(other.id, otherOrganisation.id, "WHATSAPP", { enabled: true, config: { phoneNumberId: PHONE_NUMBER_ID } })).rejects.toMatchObject({ code: "WHATSAPP_NUMBER_PLATFORM_ASSIGNED" });
    await expect(upsertChannelConfig(context.staff.id, context.official.id, "WHATSAPP", { enabled: true, config: { phoneNumberId: PHONE_NUMBER_ID, marketplaceAssistantEnabled: true } })).resolves.toBeTruthy();
  });

  it("discards an unfinished onboarding when the number is unlinked", async () => {
    const context = await fixture();
    await say(LANDLORD, "register");
    await say(LANDLORD, "1");
    await unlinkWhatsAppIdentity(LANDLORD, context.official.id);
    expect((await db.onboardingDraft.findFirstOrThrow()).status).toBe("ABANDONED");
  });

  it("removes signed photo links from the stored transcript once sent", async () => {
    const context = await fixture();
    const request = await context.report();
    await work();
    await db.maintenanceAttachment.create({ data: { maintenanceRequestId: request.id, fileKey: "maintenance/test-photo.jpg", fileName: "photo.jpg", contentType: "image/jpeg" } });
    await say(KWAME, `accept ${request.referenceNumber}`);
    const reply = await say(KWAME, `photos ${request.referenceNumber}`);
    expect(reply).toContain("links expire in 15 minutes");
    const stored = await db.message.findFirstOrThrow({ where: { direction: "OUTBOUND", body: { contains: "Photo links" } } });
    expect(stored.body).not.toContain("http");
    expect(stored.containsSensitiveData).toBe(true);
  });

  it("requires approval and assignment rights to change what a rule may spend", async () => {
    const context = await fixture();
    const manager = await registerUser({ displayName: "Manager", email: "manager@example.com", password: "secure-password-123" });
    const member = await db.organisationMember.create({ data: { organisationId: context.organisation.id, userId: manager.id } });
    const permission = await db.permission.findUniqueOrThrow({ where: { key: "maintenance.manage" } });
    const role = await db.role.upsert({ where: { key: "test_maintenance_manager_only" }, update: {}, create: { key: "test_maintenance_manager_only", name: "Manage only", isSystem: false, permissions: { create: { permissionId: permission.id } } } });
    await db.membershipRole.create({ data: { memberId: member.id, roleId: role.id } });
    await expect(updateRoutingRule(manager.id, context.organisation.id, context.rule.id, { spendingCapMinor: "900000" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateRoutingRule(manager.id, context.organisation.id, context.rule.id, { name: "Plumbing (renamed)" })).resolves.toMatchObject({ name: "Plumbing (renamed)" });
  });
});
