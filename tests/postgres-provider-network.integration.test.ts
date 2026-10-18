import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as officialPost } from "@/app/api/webhooks/whatsapp/route";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { upsertChannelConfig } from "@/modules/conversations/service";
import { defaultChannelAdapters, type ChannelAdapters } from "@/modules/conversations/channels/registry";
import type { OutboundMessageRequest } from "@/modules/conversations/channels/types";
import { linkWhatsAppIdentity } from "@/modules/whatsapp-assistant/identity";
import { eligibleNetworkProviders, inviteNetworkProvider, providerJobsForUser, respondToInvitation } from "@/modules/provider-network/service";
import { addProviderToDirectory, createServiceProvider } from "@/modules/providers/service";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";
import { db } from "@/platform/database/client";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SECRET = "test-app-secret";
const PHONE_NUMBER_ID = "100200300";
const LANDLORD = "233241234567";
const PLUMBER = "233201234567";
const ELECTRICIAN = "233207654321";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge" CASCADE');
  await db.tenant.deleteMany();
}

let counter = 0;
const sent: OutboundMessageRequest[] = [];
const adapters: ChannelAdapters = { ...defaultChannelAdapters, WHATSAPP: { ...defaultChannelAdapters.WHATSAPP, channel: "WHATSAPP", send: async (request) => { sent.push(request); return { status: "SENT", providerReference: `wamid.out.${++counter}` }; }, normalizeInbound: () => [], verifyWebhookSignature: () => ({ verified: false }) } };

async function say(from: string, body: string) {
  const before = sent.length;
  const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "555", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, messages: [{ id: `wamid.${++counter}`, from, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }] } }] }] });
  const response = await officialPost(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(payload).digest("hex")}` }, body: payload }));
  expect(response.status).toBe(200);
  await runDueJobs(createJobHandlers(undefined, adapters));
  await runDueJobs(createJobHandlers(undefined, adapters));
  await db.message.updateMany({ where: { direction: "INBOUND", processedAt: { not: null } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  return sent.slice(before).map((request) => request.body).join("\n---\n");
}

async function fixture() {
  const staff = await registerUser({ displayName: "NesAfric Support", email: "support@example.com", password: "secure-password-123" });
  const official = await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
  await upsertChannelConfig(staff.id, official.id, "WHATSAPP", { enabled: true, config: { phoneNumberId: PHONE_NUMBER_ID, businessAccountId: "555", marketplaceAssistantEnabled: true } });
  vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.id);
  const landlord = await registerUser({ displayName: "Ama Owusu", email: "ama@example.com", password: "secure-password-123" });
  const organisation = await createOrganisation(landlord.id, { name: "Owusu Homes", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
  const palm = await createProperty(landlord.id, organisation.id, { name: "Palm Court", referenceNumber: "PC-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }] });
  const sunset = await createProperty(landlord.id, organisation.id, { name: "Sunset Villas", referenceNumber: "SV-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "B1" }] });
  await linkWhatsAppIdentity(LANDLORD, landlord.id, "SMS_OTP", official.id);
  return { official, landlord, organisation, palm, sunset };
}

describe("PostgreSQL private provider network", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    vi.stubEnv("WHATSAPP_TEMPLATE_PROVIDER_INVITE", "nesafric_provider_invite:en");
    sent.length = 0;
    await cleanDatabase();
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("adds a private plumber over WhatsApp, who joins only after accepting from the invited number", async () => {
    const { organisation, palm, sunset } = await fixture();
    expect(await say(LANDLORD, "add provider")).toContain("name, phone, work");
    expect(await say(LANDLORD, "Kwame Plumbing, 0201234567, plumber")).toContain("1. Palm Court");
    await say(LANDLORD, "1");
    await say(LANDLORD, "yes");
    const summary = await say(LANDLORD, "500");
    expect(summary).toContain("Properties: Palm Court");
    expect(summary).toContain("up to GHS 500");
    // Nothing is created before the landlord confirms.
    expect(await db.providerNetworkInvitation.count()).toBe(0);
    const confirmation = await say(LANDLORD, "confirm");
    expect(confirmation).toContain("Invitation sent to Kwame Plumbing");

    const invite = sent.find((request) => request.recipientAddress === PLUMBER)!;
    expect(invite.whatsappTemplate).toEqual({ name: "nesafric_provider_invite", language: "en", bodyParameters: ["Owusu Homes", "plumbing"] });
    expect(await db.providerOrganisation.count()).toBe(0);
    expect(await eligibleNetworkProviders(organisation.id, { category: "plumbing", propertyId: palm.id })).toEqual([]);

    expect(await say(PLUMBER, "accept")).toContain("joined the maintenance network of Owusu Homes for plumbing");
    const user = await db.user.findUniqueOrThrow({ where: { phoneE164: `+${PLUMBER}` } });
    const entry = await db.providerOrganisation.findFirstOrThrow({ where: { landlordOrganisationId: organisation.id }, include: { provider: true, propertyScopes: true } });
    expect(entry).toMatchObject({ status: "ACTIVE", consentMethod: "WHATSAPP_REPLY", scopeCategories: ["plumbing"], allPropertiesScope: false, autoDispatchAllowed: true, spendingLimitMinor: BigInt(50000) });
    expect(entry.consentedAt).not.toBeNull();
    expect(entry.provider.individualUserId).toBe(user.id);
    expect(entry.propertyScopes.map((scope) => scope.propertyId)).toEqual([palm.id]);
    expect(await db.auditEvent.count({ where: { action: "provider_network.accepted" } })).toBe(1);

    expect((await eligibleNetworkProviders(organisation.id, { category: "plumbing", propertyId: palm.id })).map((item) => item.id)).toEqual([entry.id]);
    expect(await eligibleNetworkProviders(organisation.id, { category: "plumbing", propertyId: sunset.id })).toEqual([]);
    expect(await eligibleNetworkProviders(organisation.id, { category: "electrical", propertyId: palm.id })).toEqual([]);
  });

  it("records a decline without creating a provider, and refuses answers from any other number", async () => {
    const { landlord, organisation } = await fixture();
    const invitation = await inviteNetworkProvider(landlord.id, organisation.id, { displayName: "Volta Electric", phone: "0207654321", scopeCategories: ["electrical"] });
    await expect(respondToInvitation(invitation.id, `+${PLUMBER}`, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await say(ELECTRICIAN, "decline")).toContain("declined");
    expect((await db.providerNetworkInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe("DECLINED");
    expect(await db.serviceProvider.count()).toBe(0);
    await expect(respondToInvitation(invitation.id, `+${ELECTRICIAN}`, true)).rejects.toMatchObject({ code: "INVITATION_CLOSED" });
  });

  it("sends nothing to the provider when no approved invitation template is configured", async () => {
    vi.stubEnv("WHATSAPP_TEMPLATE_PROVIDER_INVITE", "");
    const { landlord, organisation } = await fixture();
    const invitation = await inviteNetworkProvider(landlord.id, organisation.id, { displayName: "Kwame Plumbing", phone: "0201234567", scopeCategories: ["plumbing"] });
    expect(invitation.deliveryFailureReason).toContain("WHATSAPP_TEMPLATE_PROVIDER_INVITE");
    expect(await db.message.count({ where: { direction: "OUTBOUND" } })).toBe(0);
    // Inviting the same number again updates the pending invitation.
    await inviteNetworkProvider(landlord.id, organisation.id, { displayName: "Kwame Plumbing Ltd", phone: "+233201234567", scopeCategories: ["plumbing", "hvac"] });
    expect(await db.providerNetworkInvitation.count()).toBe(1);
  });

  it("lets the landlord suspend, resume, switch off automatic jobs and reassign, each after confirmation", async () => {
    const { landlord, organisation, palm } = await fixture();
    const first = await inviteNetworkProvider(landlord.id, organisation.id, { displayName: "Kwame Plumbing", phone: "0201234567", scopeCategories: ["plumbing"], autoDispatchAllowed: true });
    const second = await inviteNetworkProvider(landlord.id, organisation.id, { displayName: "Yaw Pipes", phone: "0241112223", scopeCategories: ["general_maintenance"], autoDispatchAllowed: true });
    const kwame = await respondToInvitation(first.id, `+${PLUMBER}`, true);
    const yaw = await respondToInvitation(second.id, "+233241112223", true);
    const eligible = async () => (await eligibleNetworkProviders(organisation.id, { category: "plumbing", propertyId: palm.id })).map((entry) => entry.id);

    expect(await say(LANDLORD, "providers")).toContain("1. Kwame Plumbing: plumbing, active, automatic jobs on");
    expect(await say(LANDLORD, "suspend provider 1")).toContain("Please confirm: suspend Kwame Plumbing");
    expect(await eligible()).toEqual([kwame.providerOrganisationId]);
    await say(LANDLORD, "confirm");
    expect(await eligible()).toEqual([]);
    await say(LANDLORD, "providers");
    await say(LANDLORD, "resume provider 1");
    await say(LANDLORD, "confirm");
    expect(await eligible()).toEqual([kwame.providerOrganisationId]);

    await say(LANDLORD, "providers");
    await say(LANDLORD, "auto off provider 1");
    await say(LANDLORD, "cancel");
    expect(await eligible()).toEqual([kwame.providerOrganisationId]);
    await say(LANDLORD, "auto off provider 1");
    await say(LANDLORD, "confirm");
    expect(await eligible()).toEqual([]);

    await say(LANDLORD, "providers");
    await say(LANDLORD, "reassign provider 1 to 2");
    await say(LANDLORD, "confirm");
    expect(await eligible()).toEqual([yaw.providerOrganisationId]);
    expect((await db.providerOrganisation.findUniqueOrThrow({ where: { id: kwame.providerOrganisationId! } })).scopeCategories).toEqual([]);
    expect(await db.auditEvent.count({ where: { action: { in: ["provider_network.suspended", "provider_network.resumed", "provider_network.updated", "provider_network.reassigned"] } } })).toBe(4);
  });

  it("never uses web directory entries without consent for automatic dispatch", async () => {
    const { landlord, organisation, palm } = await fixture();
    const owner = await registerUser({ displayName: "Marketplace Plumber", email: "mp@example.com", password: "secure-password-123" });
    const provider = await createServiceProvider(owner.id, { type: "INDIVIDUAL", displayName: "Marketplace Plumber", contactPhone: "+233209998887" });
    const entry = await addProviderToDirectory(landlord.id, organisation.id, { providerId: provider.id });
    await db.providerOrganisation.update({ where: { id: entry.id }, data: { scopeCategories: ["plumbing"], autoDispatchAllowed: true } });
    expect(await eligibleNetworkProviders(organisation.id, { category: "plumbing", propertyId: palm.id })).toEqual([]);
    // A marketplace provider must be invited on the number on their profile.
    await expect(inviteNetworkProvider(landlord.id, organisation.id, { displayName: "Marketplace Plumber", phone: "0201234567", existingProviderId: provider.id, scopeCategories: ["plumbing"] })).rejects.toMatchObject({ code: "PROVIDER_PHONE_MISMATCH" });
  });

  it("shows a provider only their own assigned jobs, without tenant details", async () => {
    const { landlord, organisation, palm } = await fixture();
    const invitation = await inviteNetworkProvider(landlord.id, organisation.id, { displayName: "Kwame Plumbing", phone: "0201234567", scopeCategories: ["plumbing"] });
    const joined = await respondToInvitation(invitation.id, `+${PLUMBER}`, true);
    const entry = await db.providerOrganisation.findUniqueOrThrow({ where: { id: joined.providerOrganisationId! } });

    const other = await registerUser({ displayName: "Other Landlord", email: "other@example.com", password: "secure-password-123" });
    const otherOrganisation = await createOrganisation(other.id, { name: "Other Estates", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    const otherProperty = await createProperty(other.id, otherOrganisation.id, { name: "Secret Towers", referenceNumber: "ST-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "Z9" }] });
    const otherProviderOwner = await registerUser({ displayName: "Other Plumber", email: "op@example.com", password: "secure-password-123" });
    const otherProvider = await createServiceProvider(otherProviderOwner.id, { type: "INDIVIDUAL", displayName: "Other Plumber" });

    const job = async (organisationId: string, userId: string, propertyId: string, providerId: string, title: string) => {
      const request = await db.maintenanceRequest.create({ data: { organisationId, propertyId, reportedByUserId: userId, title, description: "Tenant Kofi Mensah, phone 0241234567, reports a leak.", category: "plumbing" } });
      const workOrder = await db.workOrder.create({ data: { organisationId, maintenanceRequestId: request.id, propertyId, createdByUserId: userId, title, currencyCode: "GHS" } });
      await db.providerAssignment.create({ data: { landlordOrganisationId: organisationId, workOrderId: workOrder.id, providerId, assignedByUserId: userId } });
    };
    await job(organisation.id, landlord.id, palm.id, entry.providerId, "Fix kitchen leak");
    await job(otherOrganisation.id, other.id, otherProperty.id, otherProvider.id, "Secret job");

    const user = await db.user.findUniqueOrThrow({ where: { phoneE164: `+${PLUMBER}` } });
    const { jobs } = await providerJobsForUser(user.id);
    expect(jobs.map((item) => item.workOrder.title)).toEqual(["Fix kitchen leak"]);
    const reply = await say(PLUMBER, "jobs");
    expect(reply).toContain("Fix kitchen leak at Palm Court for Owusu Homes (awaiting your answer)");
    expect(reply).not.toContain("Secret");
    expect(reply).not.toContain("Kofi");
    // Being in one landlord's network gives no access to that landlord's records.
    expect(await say(PLUMBER, "account")).not.toContain("Managing Owusu Homes");
  });
});
