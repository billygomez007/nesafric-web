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
import { linkWhatsAppIdentity } from "@/modules/whatsapp-assistant/identity";
import { escalate } from "@/modules/maintenance-routing/dispatch";
import { scheduleDueDigests, updateNotificationPreference } from "@/modules/staff-notifications/service";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";
import { db } from "@/platform/database/client";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SECRET = "test-app-secret";
const PHONE_NUMBER_ID = "100200300";
const LANDLORD = "233241234567";
const VIEWER = "233241234568";
const OTHER = "233241234569";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge" CASCADE');
  await db.tenant.deleteMany();
}

let counter = 0;
const sent: OutboundMessageRequest[] = [];
const adapters: ChannelAdapters = { ...defaultChannelAdapters, WHATSAPP: { ...defaultChannelAdapters.WHATSAPP, channel: "WHATSAPP", send: async (request) => { sent.push(request); return { status: "SENT", providerReference: `wamid.out.${++counter}` }; }, normalizeInbound: () => [], verifyWebhookSignature: () => ({ verified: false }) } };
const work = async () => { await runDueJobs(createJobHandlers(undefined, adapters)); await runDueJobs(createJobHandlers(undefined, adapters)); };
const to = (phone: string) => sent.filter((request) => request.recipientAddress === phone);

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
  await upsertChannelConfig(staff.id, official.id, "WHATSAPP", { enabled: true, config: { phoneNumberId: PHONE_NUMBER_ID, businessAccountId: "555", marketplaceAssistantEnabled: true } });
  vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.id);
  const landlord = await registerUser({ displayName: "Ama Owusu", email: "ama@example.com", password: "secure-password-123" });
  const organisation = await createOrganisation(landlord.id, { name: "Owusu Homes", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
  await linkWhatsAppIdentity(LANDLORD, landlord.id, "SMS_OTP", official.id);
  const property = await createProperty(landlord.id, organisation.id, { name: "Palm Court", referenceNumber: "PC-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }] });
  const viewer = await registerUser({ displayName: "Viewer", email: "viewer@example.com", password: "secure-password-123" });
  const viewerMember = await db.organisationMember.create({ data: { organisationId: organisation.id, userId: viewer.id } });
  // A role that can read maintenance but not payments or costs.
  const permission = await db.permission.findUniqueOrThrow({ where: { key: "maintenance.read" } });
  const role = await db.role.upsert({ where: { key: "test_maintenance_reader" }, update: {}, create: { key: "test_maintenance_reader", name: "Maintenance reader", isSystem: false, permissions: { create: { permissionId: permission.id } } } });
  await db.membershipRole.create({ data: { memberId: viewerMember.id, roleId: role.id } });
  await linkWhatsAppIdentity(VIEWER, viewer.id, "SMS_OTP", official.id);
  const member = await db.organisationMember.findFirstOrThrow({ where: { organisationId: organisation.id, userId: landlord.id } });
  const request = await createMaintenanceRequest(landlord.id, organisation.id, { propertyId: property.id, title: "Kitchen tap leaking", description: "The kitchen tap is leaking", category: "plumbing", priority: "URGENT" }) as { id: string; referenceNumber: string };
  sent.length = 0;
  return { official, landlord, organisation, property, member, viewer, viewerMember, request };
}

describe("PostgreSQL landlord alerts, digest and questions", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    vi.stubEnv("WHATSAPP_TEMPLATE_NOTIFICATION", "nesafric_notification:en");
    sent.length = 0;
    await cleanDatabase();
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("sends critical alerts at once even to a member who wants attention items in the digest", async () => {
    const context = await fixture();
    await updateNotificationPreference(context.member.id, context.organisation.id, { attentionInDigest: true });
    await escalate(db, { organisationId: context.organisation.id, requestId: context.request.id, level: "ATTENTION", reason: "PROVIDER_DECLINED", detail: `${context.request.referenceNumber}: a provider declined.`, dedupeKey: "t:attention" });
    await escalate(db, { organisationId: context.organisation.id, requestId: context.request.id, level: "CRITICAL", reason: "SAFETY", detail: `${context.request.referenceNumber}: gas smell reported.`, dedupeKey: "t:critical" });
    await work();
    await work();
    const alerts = to(LANDLORD);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].body).toContain("URGENT: NM-1001: gas smell reported.");
    // Outside the 24-hour window the approved template carries the text.
    expect(alerts[0].whatsappTemplate?.name).toBe("nesafric_notification");
    expect(await db.staffNotification.findFirstOrThrow({ where: { memberId: context.member.id, level: "ATTENTION" } })).toMatchObject({ status: "SKIPPED" });
    // A viewer cannot approve maintenance and is not an alert recipient.
    expect(to(VIEWER)).toHaveLength(0);
  });

  it("sends one digest per day from real records, with costs only for members allowed to see them", async () => {
    const context = await fixture();
    await db.workOrder.create({ data: { organisationId: context.organisation.id, maintenanceRequestId: context.request.id, propertyId: context.property.id, createdByUserId: context.landlord.id, title: "Fix tap", currencyCode: "GHS", status: "COMPLETED", completedAt: new Date(), actualCostAmountMinor: "25000" } });
    const evening = new Date(); evening.setUTCHours(19, 0, 0, 0);
    await scheduleDueDigests(evening);
    await scheduleDueDigests(evening);
    await work();
    const digests = to(LANDLORD);
    expect(digests).toHaveLength(1);
    expect(digests[0].body).toContain("New requests: 1 (NM-1001)");
    expect(digests[0].body).toContain("Completed: 1, costing GHS 250.00");
    expect(await db.staffNotification.count({ where: { kind: "DIGEST", memberId: context.member.id } })).toBe(1);
    // Before the digest hour nothing is queued.
    const morning = new Date(evening); morning.setUTCHours(6);
    await db.staffNotification.deleteMany();
    await db.backgroundJob.deleteMany({ where: { type: "daily-digest" } });
    expect((await scheduleDueDigests(morning)).queued).toBe(0);
  });

  it("skips a quiet day unless the member asked for no-activity summaries", async () => {
    const context = await fixture();
    await db.maintenanceRequest.update({ where: { id: context.request.id }, data: { createdAt: new Date(Date.now() - 3 * 86_400_000) } });
    const evening = new Date(); evening.setUTCHours(19, 0, 0, 0);
    await scheduleDueDigests(evening);
    await work();
    expect(to(LANDLORD)).toHaveLength(0);
    expect(await db.staffNotification.findFirstOrThrow({ where: { kind: "DIGEST" } })).toMatchObject({ status: "SKIPPED", detail: "No activity." });
  });

  it("answers landlord questions from their own records only", async () => {
    const context = await fixture();
    await db.lease.create({ data: { organisationId: context.organisation.id, propertyId: context.property.id, referenceNumber: "L-9", startDate: new Date("2026-01-01"), endDate: new Date(Date.now() + 20 * 86_400_000), rentAmountMinor: "100000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE" } });
    expect(await say(LANDLORD, "Show ticket NM-1001")).toContain("NM-1001: Kitchen tap leaking");
    expect(await say(LANDLORD, "Which units have open maintenance requests?")).toContain("Palm Court: NM-1001 Kitchen tap leaking (new)");
    expect(await say(LANDLORD, "Which repairs need my approval?")).toContain("Nothing is waiting");
    expect(await say(LANDLORD, "Show upcoming lease expirations.")).toContain("Leases ending in the next 60 days");
    expect(await say(LANDLORD, "How many units do I manage?")).toContain("1 property, 1 unit");
    expect(await say(LANDLORD, "Show today's maintenance costs")).toContain("Owusu Homes: GHS 0.00");
    expect(await say(LANDLORD, "Add another electrician")).toContain("name, phone, work");
    await say(LANDLORD, "cancel");
    expect(await say(LANDLORD, "Set a quote approval limit for this building")).toContain("set limit rule");
    expect(await say(VIEWER, "Show today's maintenance costs")).toContain("does not include maintenance costs");

    // Another landlord with their own NM-1001 sees only theirs; someone with no portfolio sees none.
    const other = await registerUser({ displayName: "Other", email: "other@example.com", password: "secure-password-123" });
    const otherOrganisation = await createOrganisation(other.id, { name: "Other Estates", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    const otherProperty = await createProperty(other.id, otherOrganisation.id, { name: "Secret Towers", referenceNumber: "ST-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [] });
    await createMaintenanceRequest(other.id, otherOrganisation.id, { propertyId: otherProperty.id, title: "Roof leak", description: "Roof leak in hall", category: "roofing" });
    await linkWhatsAppIdentity(OTHER, other.id, "SMS_OTP", context.official.id);
    const theirs = await say(OTHER, "show ticket NM-1001");
    expect(theirs).toContain("Roof leak");
    expect(theirs).not.toContain("Kitchen");
  });

  it("changes digest settings on request", async () => {
    const context = await fixture();
    expect(await say(LANDLORD, "digest at 7")).toContain("7:00");
    expect(await say(LANDLORD, "alerts in digest")).toContain("Urgent safety alerts still come at once");
    expect(await db.notificationPreference.findUniqueOrThrow({ where: { memberId: context.member.id } })).toMatchObject({ digestHour: 7, attentionInDigest: true });
  });
});
