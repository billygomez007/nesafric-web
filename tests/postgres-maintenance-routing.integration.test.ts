import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as officialPost } from "@/app/api/webhooks/whatsapp/route";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createMaintenanceRequest } from "@/modules/maintenance/service";
import { defaultChannelAdapters, type ChannelAdapters } from "@/modules/conversations/channels/registry";
import type { OutboundDeliveryResult, OutboundMessageRequest } from "@/modules/conversations/channels/types";
import { linkWhatsAppIdentity } from "@/modules/whatsapp-assistant/identity";
import { inviteNetworkProvider, respondToInvitation } from "@/modules/provider-network/service";
import { createRoutingRule } from "@/modules/maintenance-routing/rules";
import { recordDispatchDecline, routeMaintenanceRequest } from "@/modules/maintenance-routing/dispatch";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";
import { db } from "@/platform/database/client";
import { connectWhatsAppChannel } from "./helpers/whatsapp-channel";
import { createLease } from "./helpers/lease";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SECRET = "test-app-secret";
const PHONE_NUMBER_ID = "100200300";
const LANDLORD = "233241234567";
const KWAME = "+233201234567";
const YAW = "+233241112223";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge" CASCADE');
  await db.tenant.deleteMany();
}

let counter = 0;
let sendResult: () => OutboundDeliveryResult = () => ({ status: "SENT", providerReference: `wamid.out.${++counter}` });
const sent: OutboundMessageRequest[] = [];
const adapters: ChannelAdapters = { ...defaultChannelAdapters, WHATSAPP: { ...defaultChannelAdapters.WHATSAPP, channel: "WHATSAPP", send: async (request) => { sent.push(request); return sendResult(); }, normalizeInbound: () => [], verifyWebhookSignature: () => ({ verified: false }) } };
const work = async (now?: Date) => { await runDueJobs(createJobHandlers(undefined, adapters), now); await runDueJobs(createJobHandlers(undefined, adapters), now); };

async function say(body: string) {
  const before = sent.length;
  const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "555", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, messages: [{ id: `wamid.${++counter}`, from: LANDLORD, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }] } }] }] });
  expect((await officialPost(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(payload).digest("hex")}` }, body: payload }))).status).toBe(200);
  await work();
  await db.message.updateMany({ where: { direction: "INBOUND", processedAt: { not: null } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  return sent.slice(before).map((request) => request.body).join("\n---\n");
}

async function fixture() {
  const staff = await registerUser({ displayName: "NesAfric Support", email: "support@example.com", password: "secure-password-123" });
  const official = await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
  await connectWhatsAppChannel(staff.id, official.id, { enabled: true, config: { phoneNumberId: PHONE_NUMBER_ID, businessAccountId: "555", marketplaceAssistantEnabled: true } });
  vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.id);
  const landlord = await registerUser({ displayName: "Ama Owusu", email: "ama@example.com", password: "secure-password-123" });
  const organisation = await createOrganisation(landlord.id, { name: "Owusu Homes", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
  await linkWhatsAppIdentity(LANDLORD, landlord.id, "SMS_OTP", official.id);
  const property = await createProperty(landlord.id, organisation.id, { name: "Palm Court", referenceNumber: "PC-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", city: "East Legon", units: [{ name: "A1" }] });
  const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
  const tenantUser = await registerUser({ displayName: "Kofi Mensah", email: "kofi@example.com", password: "secure-password-123" });
  const { relationship } = await createTenant(landlord.id, organisation.id, { legalName: "Kofi Mensah", phone: "+233245550001" });
  await db.tenantOrganisation.update({ where: { id: relationship.id }, data: { userId: tenantUser.id } });
  await createLease(landlord.id, organisation.id, { referenceNumber: "L-1", propertyId: property.id, unitId: unit.id, tenantOrganisationIds: [relationship.id], startDate: "2026-01-01", rentAmountMinor: "150000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE" });
  const join = async (name: string, phone: string, limit: string | null) => {
    const invitation = await inviteNetworkProvider(landlord.id, organisation.id, { displayName: name, phone, scopeCategories: ["plumbing"], autoDispatchAllowed: true, spendingLimitMinor: limit });
    return (await respondToInvitation(invitation.id, phone, true)).providerOrganisationId!;
  };
  const kwame = await join("Kwame Plumbing", KWAME, "30000");
  const yaw = await join("Yaw Pipes", YAW, null);
  sent.length = 0;
  return { official, landlord, organisation, property, unit, tenantUser, relationship, kwame, yaw };
}
type Context = Awaited<ReturnType<typeof fixture>>;

const plumbingRule = (context: Context, overrides: Record<string, unknown> = {}) => createRoutingRule(context.landlord.id, context.organisation.id, {
  name: "Plumbing", category: "plumbing", primaryProviderOrganisationId: context.kwame, backupProviderOrganisationIds: [context.yaw],
  authorizationMode: "PRE_AUTHORIZED", spendingCapMinor: "50000", responseTimeoutMinutes: 30, maxAttempts: 2, ...overrides,
});
const report = (context: Context, description = "The pipe under the kitchen sink is leaking", priority: string = "URGENT") => createMaintenanceRequest(context.tenantUser.id, context.organisation.id, {
  propertyId: context.property.id, unitId: context.unit.id, tenantOrganisationId: context.relationship.id, title: "Kitchen sink pipe leaking", description, category: "plumbing", priority, intakeChannel: "WHATSAPP",
}) as Promise<{ id: string; referenceNumber: string }>;
const toNumber = (phone: string) => sent.filter((request) => request.recipientAddress === phone.slice(1));

describe("PostgreSQL maintenance routing and controlled dispatch", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    vi.stubEnv("WHATSAPP_TEMPLATE_WORK_ORDER", "nesafric_work_order:en");
    sendResult = () => ({ status: "SENT", providerReference: `wamid.out.${++counter}` });
    sent.length = 0;
    await cleanDatabase();
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("sends a tenant's plumbing report to the rule's plumber with the authorised scope, once", async () => {
    const context = await fixture();
    await plumbingRule(context);
    const request = await report(context);
    await work();
    await routeMaintenanceRequest(context.organisation.id, request.id);

    const workOrders = await db.workOrder.findMany({ where: { maintenanceRequestId: request.id }, include: { providerAssignments: true, dispatchAttempts: true } });
    expect(workOrders).toHaveLength(1);
    // The cap is the lower of the rule's 500 and the plumber's own 300.
    expect(workOrders[0]).toMatchObject({ authorizationMode: "PRE_AUTHORIZED", authorizedSpendMinor: BigInt(30000) });
    expect(workOrders[0].dispatchAttempts.map((attempt) => [attempt.attemptNumber, attempt.status, attempt.providerOrganisationId])).toEqual([[1, "CONTACTED", context.kwame]]);
    expect(workOrders[0].providerAssignments.map((assignment) => assignment.status)).toEqual(["PENDING"]);
    expect((await db.maintenanceRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("TRIAGED");

    const [message] = toNumber(KWAME);
    expect(message.whatsappTemplate?.name).toBe("nesafric_work_order");
    expect(message.whatsappTemplate?.bodyParameters?.slice(0, 5)).toEqual(["Owusu Homes", request.referenceNumber, "Palm Court, A1, East Legon", "Kitchen sink pipe leaking", "urgent"]);
    expect(message.whatsappTemplate?.bodyParameters?.[5]).toContain("up to GHS 300.00");
    expect(JSON.stringify(message)).not.toContain("Kofi");
    expect(toNumber(YAW)).toHaveLength(0);
    expect(await db.maintenanceRoutingDecision.findFirstOrThrow({ where: { maintenanceRequestId: request.id } })).toMatchObject({ outcome: "DISPATCHED" });
  });

  it("tries the backup after a decline, then escalates when nobody answers", async () => {
    const context = await fixture();
    await plumbingRule(context);
    const request = await report(context);
    await work();
    const first = await db.maintenanceDispatchAttempt.findFirstOrThrow({ where: { maintenanceRequestId: request.id } });
    await recordDispatchDecline(context.organisation.id, first.id, "Fully booked");
    await work();
    expect(toNumber(YAW)).toHaveLength(1);
    expect(await db.maintenanceEscalation.count({ where: { reason: "PROVIDER_DECLINED" } })).toBe(1);
    expect((await db.providerAssignment.findFirstOrThrow({ where: { providerId: (await db.providerOrganisation.findUniqueOrThrow({ where: { id: context.kwame } })).providerId } })).status).toBe("DECLINED");

    // Yaw never answers: after the timeout the rule's two attempts are used up.
    await work(new Date(Date.now() + 31 * 60_000));
    const attempts = await db.maintenanceDispatchAttempt.findMany({ where: { maintenanceRequestId: request.id }, orderBy: { attemptNumber: "asc" } });
    expect(attempts.map((attempt) => attempt.status)).toEqual(["DECLINED", "NO_RESPONSE"]);
    expect(await db.maintenanceEscalation.count({ where: { reason: "NO_PROVIDER_ACCEPTED" } })).toBe(1);
  });

  it("does not dispatch under a paused rule, and the landlord can pause by work type on WhatsApp", async () => {
    const context = await fixture();
    await plumbingRule(context);
    expect(await say("pause plumbing dispatch")).toContain("Please confirm: pause Plumbing");
    await say("confirm");
    const request = await report(context);
    await work();
    expect(await db.workOrder.count({ where: { maintenanceRequestId: request.id } })).toBe(0);
    expect(await db.maintenanceRoutingDecision.findFirstOrThrow({ where: { maintenanceRequestId: request.id } })).toMatchObject({ outcome: "RULE_PAUSED" });
    expect(await db.maintenanceEscalation.count({ where: { maintenanceRequestId: request.id, reason: "RULE_PAUSED" } })).toBe(1);
    expect(await db.auditEvent.count({ where: { action: "maintenance_rule.paused" } })).toBe(1);
  });

  it("escalates emergencies immediately as critical", async () => {
    const context = await fixture();
    await plumbingRule(context);
    const request = await report(context, "Burst pipe, water is flooding the flat", "EMERGENCY");
    await work();
    expect(await db.maintenanceEscalation.findFirstOrThrow({ where: { maintenanceRequestId: request.id, level: "CRITICAL" } })).toMatchObject({ reason: "SAFETY" });
  });

  it("never sends the job again when the work order's delivery is unconfirmed", async () => {
    const context = await fixture();
    await plumbingRule(context);
    sendResult = () => ({ status: "FAILED", unconfirmed: true, retryable: false, failureReason: "timed out" });
    const request = await report(context);
    await work();
    await routeMaintenanceRequest(context.organisation.id, request.id);
    await work(new Date(Date.now() + 5 * 60_000));
    expect(toNumber(KWAME)).toHaveLength(1);
    expect(await db.maintenanceDispatchAttempt.count({ where: { maintenanceRequestId: request.id } })).toBe(1);
    expect(await db.workOrder.count({ where: { maintenanceRequestId: request.id } })).toBe(1);
  });

  it("escalates instead of guessing when no rule, two equal rules, or no template applies", async () => {
    const context = await fixture();
    const none = await report(context);
    await work();
    expect(await db.maintenanceRoutingDecision.findFirstOrThrow({ where: { maintenanceRequestId: none.id } })).toMatchObject({ outcome: "NO_RULE" });

    await plumbingRule(context, { name: "Plumbing A" });
    await plumbingRule(context, { name: "Plumbing B" });
    const ambiguous = await report(context, "The bathroom tap drips");
    await work();
    expect(await db.maintenanceRoutingDecision.findFirstOrThrow({ where: { maintenanceRequestId: ambiguous.id } })).toMatchObject({ outcome: "AMBIGUOUS_RULES" });
    expect(await db.workOrder.count()).toBe(0);

    await db.maintenanceRoutingRule.updateMany({ where: { name: "Plumbing B" }, data: { archivedAt: new Date() } });
    vi.stubEnv("WHATSAPP_TEMPLATE_WORK_ORDER", "");
    const unsent = await report(context, "The shower drain is blocked");
    await work();
    expect(await db.maintenanceDispatchAttempt.findFirstOrThrow({ where: { maintenanceRequestId: unsent.id } })).toMatchObject({ status: "CONTACT_FAILED" });
    expect(await db.maintenanceEscalation.count({ where: { maintenanceRequestId: unsent.id, reason: "WORK_ORDER_NOT_SENT" } })).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it("creates a rule over WhatsApp only after the summary is confirmed", async () => {
    const context = await fixture();
    await say("add rule");
    await say("plumbing");
    expect(await say("1")).toContain("Backups if Kwame Plumbing");
    await say("2");
    await say("1");
    await say("500");
    const summary = await say("default");
    expect(summary).toContain("Send to: Kwame Plumbing, then Yaw Pipes");
    expect(summary).toContain("repair up to a limit (up to GHS 500)");
    expect(await db.maintenanceRoutingRule.count()).toBe(0);
    await say("confirm");
    expect(await db.maintenanceRoutingRule.findFirstOrThrow()).toMatchObject({ category: "plumbing", primaryProviderOrganisationId: context.kwame, backupProviderOrganisationIds: [context.yaw], authorizationMode: "PRE_AUTHORIZED", spendingCapMinor: BigInt(50000), responseTimeoutMinutes: 60, createdByUserId: context.landlord.id });
  });
});
