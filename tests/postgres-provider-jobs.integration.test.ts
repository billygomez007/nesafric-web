import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as officialPost } from "@/app/api/webhooks/whatsapp/route";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createMaintenanceRequest } from "@/modules/maintenance/service";
import { defaultChannelAdapters, type ChannelAdapters } from "@/modules/conversations/channels/registry";
import type { OutboundMessageRequest } from "@/modules/conversations/channels/types";
import { linkWhatsAppIdentity } from "@/modules/whatsapp-assistant/identity";
import { inviteNetworkProvider, respondToInvitation } from "@/modules/provider-network/service";
import { createRoutingRule } from "@/modules/maintenance-routing/rules";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";
import { db } from "@/platform/database/client";
import { connectWhatsAppChannel } from "./helpers/whatsapp-channel";
import { createLease } from "./helpers/lease";
import { VALID_JPEG } from "./helpers/images";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SECRET = "test-app-secret";
const PHONE_NUMBER_ID = "100200300";
const LANDLORD = "233241234567";
const TENANT = "233245550001";
const KWAME = "233201234567";
const YAW = "233241112223";
const JPEG = VALID_JPEG;

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge", "StorageObject" CASCADE');
  await db.tenant.deleteMany();
}

let counter = 0;
const sent: Array<OutboundMessageRequest & { providerReference: string }> = [];
const adapters: ChannelAdapters = { ...defaultChannelAdapters, WHATSAPP: { ...defaultChannelAdapters.WHATSAPP, channel: "WHATSAPP", send: async (request) => { const providerReference = `wamid.out.${++counter}`; sent.push({ ...request, providerReference }); return { status: "SENT", providerReference }; }, normalizeInbound: () => [], verifyWebhookSignature: () => ({ verified: false }) } };
const work = async (now?: Date) => { await runDueJobs(createJobHandlers(undefined, adapters), now); await runDueJobs(createJobHandlers(undefined, adapters), now); };

async function deliver(from: string, message: Record<string, unknown>) {
  const before = sent.length;
  const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "555", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, messages: [{ id: `wamid.${++counter}`, from, timestamp: String(Math.floor(Date.now() / 1000)), ...message }] } }] }] });
  expect((await officialPost(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(payload).digest("hex")}` }, body: payload }))).status).toBe(200);
  await work();
  await db.message.updateMany({ where: { direction: "INBOUND", processedAt: { not: null } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  return sent.slice(before).filter((request) => request.recipientAddress === from).map((request) => request.body).join("\n---\n");
}
const say = (from: string, body: string) => deliver(from, { type: "text", text: { body } });
const toNumber = (phone: string) => sent.filter((request) => request.recipientAddress === phone);

async function fixture(ruleOverrides: Record<string, unknown> = {}) {
  const staff = await registerUser({ displayName: "NesAfric Support", email: "support@example.com", password: "secure-password-123" });
  const official = await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
  vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.id);
  await connectWhatsAppChannel(staff.id, official.id, { enabled: true, config: { phoneNumberId: PHONE_NUMBER_ID, businessAccountId: "555", marketplaceAssistantEnabled: true } });
  const landlord = await registerUser({ displayName: "Ama Owusu", email: "ama@example.com", password: "secure-password-123" });
  const organisation = await createOrganisation(landlord.id, { name: "Owusu Homes", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
  await linkWhatsAppIdentity(LANDLORD, landlord.id, "SMS_OTP", official.id);
  const property = await createProperty(landlord.id, organisation.id, { name: "Palm Court", referenceNumber: "PC-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }] });
  const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
  const tenantUser = await registerUser({ displayName: "Kofi Mensah", email: "kofi@example.com", password: "secure-password-123" });
  const { relationship } = await createTenant(landlord.id, organisation.id, { legalName: "Kofi Mensah", phone: `+${TENANT}` });
  await db.tenantOrganisation.update({ where: { id: relationship.id }, data: { userId: tenantUser.id } });
  await linkWhatsAppIdentity(TENANT, tenantUser.id, "SMS_OTP", official.id);
  await createLease(landlord.id, organisation.id, { referenceNumber: "L-1", propertyId: property.id, unitId: unit.id, tenantOrganisationIds: [relationship.id], startDate: "2026-01-01", rentAmountMinor: "150000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE" });
  const join = async (name: string, phone: string) => (await respondToInvitation((await inviteNetworkProvider(landlord.id, organisation.id, { displayName: name, phone: `+${phone}`, scopeCategories: ["plumbing"], autoDispatchAllowed: true })).id, `+${phone}`, true)).providerOrganisationId!;
  const kwame = await join("Kwame Plumbing", KWAME);
  const yaw = await join("Yaw Pipes", YAW);
  await createRoutingRule(landlord.id, organisation.id, { name: "Plumbing", category: "plumbing", primaryProviderOrganisationId: kwame, backupProviderOrganisationIds: [yaw], authorizationMode: "PRE_AUTHORIZED", spendingCapMinor: "30000", responseTimeoutMinutes: 30, maxAttempts: 2, ...ruleOverrides });
  const request = await createMaintenanceRequest(tenantUser.id, organisation.id, { propertyId: property.id, unitId: unit.id, tenantOrganisationId: relationship.id, title: "Kitchen sink pipe leaking", description: "The pipe under the kitchen sink is leaking", category: "plumbing", priority: "URGENT", intakeChannel: "WHATSAPP" }) as { id: string; referenceNumber: string };
  sent.length = 0;
  await work();
  return { official, landlord, organisation, request, ref: request.referenceNumber, kwame, yaw };
}

describe("PostgreSQL provider job actions over WhatsApp", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    vi.stubEnv("WHATSAPP_TEMPLATE_WORK_ORDER", "nesafric_work_order:en");
    vi.stubEnv("WHATSAPP_TEMPLATE_NOTIFICATION", "nesafric_notification:en");
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

  it("runs a job from the Accept button to a completed, evidenced repair, and lets the tenant dispute it", async () => {
    const { request, ref } = await fixture();
    const workOrder = toNumber(KWAME)[0];
    expect(workOrder.whatsappTemplate?.name).toBe("nesafric_work_order");

    // The provider taps Accept on the template: the reply carries the work order's message id.
    expect(await deliver(KWAME, { type: "button", context: { id: workOrder.providerReference }, button: { text: "Accept", payload: "Accept" } })).toContain(`Accepted.\n${ref} for Owusu Homes`);
    expect((await db.maintenanceRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("ASSIGNED");
    expect(toNumber(TENANT).at(-1)?.body).toContain("Kwame Plumbing has accepted your repair");

    expect(await say(KWAME, `visit ${ref} 2099-01-05 10:00`)).toContain("noted");
    expect(await say(KWAME, `start ${ref}`)).toContain("in progress");
    expect(await say(KWAME, `done ${ref}`)).toContain("What work did you do?");
    await say(KWAME, "Replaced the waste pipe and seal");
    await say(KWAME, "250");
    expect(await deliver(KWAME, { type: "image", image: { id: "445566", mime_type: "image/jpeg" } })).toContain("Photo 1 saved");
    await say(KWAME, "done");
    expect(await say(KWAME, "no")).toContain("Cost: GHS 250.00");
    expect(await say(KWAME, "confirm")).toContain("recorded as completed");

    const done = await db.maintenanceRequest.findUniqueOrThrow({ where: { id: request.id }, include: { attachments: true, workOrders: true } });
    expect(done.status).toBe("CLOSED");
    expect(done.workOrders[0]).toMatchObject({ status: "COMPLETED", actualCostAmountMinor: expect.anything() });
    expect(done.workOrders[0].actualCostAmountMinor?.toString()).toBe("25000");
    expect(done.attachments.map((attachment) => attachment.fileName)).toContain("completion-445566.jpg");
    expect(toNumber(TENANT).at(-1)?.body).toContain(`Reply ok ${ref}`);
    expect(await db.maintenanceEscalation.count({ where: { reason: "COST_OVER_AUTHORISED" } })).toBe(0);

    expect(await say(TENANT, `problem ${ref.toLowerCase()}`)).toContain("reopened");
    expect((await db.maintenanceRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("IN_PROGRESS");
    expect(await db.maintenanceEscalation.count({ where: { reason: "TENANT_DISPUTE" } })).toBe(1);
  });

  it("pauses a quote above the authorised amount until the landlord approves it", async () => {
    const { request, ref } = await fixture();
    await say(KWAME, `accept ${ref}`);
    expect(await say(KWAME, `quote ${ref} 450 replace the whole trap`)).toContain("sent for approval");
    const approval = await db.maintenanceApproval.findFirstOrThrow({ where: { maintenanceRequestId: request.id } });
    expect(approval).toMatchObject({ status: "PENDING" });
    expect(approval.requestedAmountMinor.toString()).toBe("45000");
    expect(await db.maintenanceEscalation.count({ where: { reason: "QUOTE_OVER_LIMIT" } })).toBe(1);
    expect((await db.workOrder.findFirstOrThrow({ where: { maintenanceRequestId: request.id } })).authorizedSpendMinor).toBe(BigInt(30000));

    // A provider cannot approve their own quote.
    expect(await say(KWAME, `approve ${ref}`)).toContain("cannot approve");
    expect(await say(LANDLORD, `approve ${ref}`)).toContain("Please confirm: approve the quote of GHS 450.00");
    expect((await db.maintenanceApproval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("PENDING");
    await say(LANDLORD, "confirm");
    expect((await db.maintenanceApproval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("APPROVED");
    expect((await db.workOrder.findFirstOrThrow({ where: { maintenanceRequestId: request.id } })).authorizedSpendMinor).toBe(BigInt(45000));
    expect(toNumber(KWAME).at(-1)?.body).toContain("is approved");
  });

  it("accepts a quote within the authorised amount, and escalates a cost above it", async () => {
    const { request, ref } = await fixture();
    await say(KWAME, `accept ${ref}`);
    expect(await say(KWAME, `quote ${ref} 200`)).toContain("within what is authorised");
    expect(await db.maintenanceApproval.count({ where: { maintenanceRequestId: request.id } })).toBe(0);
    await say(KWAME, `done ${ref}`);
    await say(KWAME, "Fixed");
    await say(KWAME, "600");
    await say(KWAME, "skip");
    await say(KWAME, "the cabinet floor is rotten");
    await say(KWAME, "confirm");
    expect(await db.maintenanceEscalation.count({ where: { reason: "COST_OVER_AUTHORISED" } })).toBe(1);
    expect(await db.maintenanceEscalation.count({ where: { reason: "FURTHER_WORK_REQUESTED" } })).toBe(1);
  });

  it("refuses a late accept after the job moved on, and other providers' jobs", async () => {
    const { ref } = await fixture();
    expect(await say(YAW, `accept ${ref}`)).toContain("is not one of your open jobs");
    // One pass at the first deadline only: the backup's own deadline is 30 minutes later.
    await runDueJobs(createJobHandlers(undefined, adapters), new Date(Date.now() + 31 * 60_000));
    await work();
    // Kwame's attempt timed out and Yaw was asked instead.
    expect(await say(KWAME, `accept ${ref}`)).toContain("is not one of your open jobs");
    expect(await say(YAW, `accept ${ref}`)).toContain("Accepted.");
  });

  it("waits for the landlord's verification when the rule requires it", async () => {
    const { request, ref } = await fixture({ requireCompletionVerification: true });
    await say(KWAME, `accept ${ref}`);
    await say(KWAME, `done ${ref}`);
    await say(KWAME, "Fixed the leak");
    await say(KWAME, "100");
    await say(KWAME, "skip");
    await say(KWAME, "no");
    expect(await say(KWAME, "confirm")).toContain("waiting for verification");
    expect((await db.maintenanceRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("COMPLETED");
    await say(LANDLORD, `verify ${ref}`);
    await say(LANDLORD, "confirm");
    expect((await db.maintenanceRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("CLOSED");
  });
});
