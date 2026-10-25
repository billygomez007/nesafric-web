import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as officialPost } from "@/app/api/webhooks/whatsapp/route";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createListing, createMarketplaceLead, createViewingRequest, transitionListing, updateListingVerification, updateMarketplaceLead, updateViewingRequest } from "@/modules/listings/service";
import { createMaintenanceRequest } from "@/modules/maintenance/service";
import { createTenant } from "@/modules/tenants/service";
import { createTenantAccessInvitation, redeemTenantAccessCode, revokeTenantAccessInvitation } from "@/modules/tenants/access-invitations";
import { createMarketplaceProfessional, reviewMarketplaceVerification } from "@/modules/marketplace-professionals/service";
import { defaultChannelAdapters, type ChannelAdapters } from "@/modules/conversations/channels/registry";
import type { OutboundDeliveryResult, OutboundMessageRequest } from "@/modules/conversations/channels/types";
import { linkWhatsAppIdentity, setWhatsAppOptOut } from "@/modules/whatsapp-assistant/identity";
import { templateContentHash, templateCreationPayload } from "@/modules/whatsapp-templates/format";
import { metaTemplateName, utilityTemplate, type UtilityTemplate } from "@/modules/whatsapp-templates/registry";
import { approvedTemplate, submitTemplates, syncTemplateStatuses } from "@/modules/whatsapp-templates/state";
import { dispatchUtilityEvents } from "@/modules/whatsapp-templates/dispatch";
import type { MetaTemplate, MetaTemplateClient } from "@/modules/whatsapp-templates/meta-client";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";
import { db } from "@/platform/database/client";
import { createLease } from "./helpers/lease";
import { amendLease, transitionLease } from "@/modules/lifecycle/service";
import { createPlatformAdmin, connectWhatsAppChannel } from "./helpers/whatsapp-channel";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });

const SECRET = "test-app-secret";
const PHONE_NUMBER_ID = "100200300";
const WABA = "555";
const SEEKER = "233241110001";
const AGENT = "233241110002";
const TENANT = "233241110003";
const LANDLORD = "233241110004";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge", "WhatsAppTemplateState", "WhatsAppUtilityDispatch" CASCADE');
  await db.tenant.deleteMany();
}

let counter = 0;
const sent: OutboundMessageRequest[] = [];
let nextResult: OutboundDeliveryResult | null = null;
const adapters: ChannelAdapters = {
  ...defaultChannelAdapters,
  WHATSAPP: {
    ...defaultChannelAdapters.WHATSAPP, channel: "WHATSAPP", normalizeInbound: () => [], verifyWebhookSignature: () => ({ verified: false }),
    send: async (request) => {
      if (nextResult) { const result = nextResult; nextResult = null; return result; }
      sent.push(request);
      return { status: "SENT", providerReference: `wamid.out.${++counter}` };
    },
  },
};
const work = async () => { await runDueJobs(createJobHandlers(undefined, adapters)); await runDueJobs(createJobHandlers(undefined, adapters)); };
const templatesTo = (phone: string) => sent.filter((request) => request.recipientAddress === phone && request.whatsappTemplate);
const dispatches = (templateKey: string) => db.whatsAppUtilityDispatch.findMany({ where: { templateKey }, orderBy: { createdAt: "asc" } });

async function webhook(payload: unknown, secret = SECRET) {
  const body = JSON.stringify(payload);
  return officialPost(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` }, body }));
}

async function approve(...keys: string[]) {
  for (const key of keys) {
    const template = utilityTemplate(key);
    const where = { wabaId_metaName_language: { wabaId: WABA, metaName: metaTemplateName(template), language: "en" } };
    const data = { status: "APPROVED", metaCategory: "UTILITY", contentHash: templateContentHash(template), metaTemplateId: `meta-${key}` };
    await db.whatsAppTemplateState.upsert({ where, update: data, create: { templateKey: key, wabaId: WABA, metaName: metaTemplateName(template), language: "en", version: 1, ...data } });
  }
}

const remoteOf = (template: UtilityTemplate, status: string, extra: Partial<MetaTemplate> = {}): MetaTemplate => {
  const payload = templateCreationPayload(template);
  return { id: `meta-${template.key}`, name: payload.name, language: "en", status, category: "UTILITY", components: payload.components as MetaTemplate["components"], ...extra };
};
const fakeClient = (remote: MetaTemplate[]) => ({ list: vi.fn(async () => remote), create: vi.fn(async () => ({ id: "meta-new", status: "PENDING", category: "UTILITY" })) }) satisfies MetaTemplateClient;

async function official() {
  const staff = await registerUser({ displayName: "NesAfric Support", email: "support@utility.test", password: "secure-password-123" });
  const organisation = await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
  vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", organisation.id);
  await connectWhatsAppChannel(staff.id, organisation.id, { enabled: true, config: { phoneNumberId: PHONE_NUMBER_ID, businessAccountId: WABA, marketplaceAssistantEnabled: true } });
  return organisation;
}

async function publishedListing() {
  const owner = await registerUser({ displayName: "Abena Agyei", email: "abena@utility.test", password: "secure-password-123" });
  const organisation = await createOrganisation(owner.id, { name: "Agyei Lettings", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
  const property = await createProperty(owner.id, organisation.id, { name: "Spintex Villa", referenceNumber: "SV-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
  const listing = await createListing(owner.id, organisation.id, {
    propertyId: property.id, listingType: "RENT", category: "house", title: "3-bedroom house in Spintex", publicDescription: "A family house close to the main road.",
    rentAmountMinor: "450000", currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-11-01", countryCode: "GH", city: "Accra", locality: "Spintex", enquiryEnabled: true,
    media: [{ type: "PHOTO", publicUrl: "https://cdn.example.com/listing/photo.jpg", mimeType: "image/jpeg", sortOrder: 1 }],
  });
  await updateListingVerification(owner.id, organisation.id, listing.id, { status: "PENDING", evidence: [{ type: "OWNERSHIP_OR_AUTHORITY", privateReference: "private/evidence/deed.pdf", metadata: {} }] });
  await updateListingVerification(owner.id, organisation.id, listing.id, { status: "VERIFIED", note: "Checked." });
  await transitionListing(owner.id, organisation.id, listing.id, { status: "PENDING_REVIEW" });
  await transitionListing(owner.id, organisation.id, listing.id, { status: "PUBLISHED" });
  return { owner, organisation, property, listing };
}

/** A text from `from` to the official number; returns the plain-text replies it got. */
async function inbound(from: string, body: string) {
  const before = sent.length;
  await webhook({ object: "whatsapp_business_account", entry: [{ id: WABA, changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, messages: [{ from, id: `wamid.in.${++counter}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }] } }] }] });
  await work();
  return sent.slice(before).filter((request) => request.recipientAddress === from && !request.whatsappTemplate).map(({ body: text }) => text).join("\n");
}

/** Marks the setup's own events as decided, so each test sees only the events it causes. */
async function settle() {
  await dispatchUtilityEvents();
  await work();
  sent.length = 0;
}

describe("PostgreSQL WhatsApp Utility templates", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    vi.stubEnv("WHATSAPP_TEMPLATE_WABA_ID", WABA);
    vi.stubEnv("WHATSAPP_UTILITY_EVENTS_SINCE", new Date(Date.now() - 60 * 60_000).toISOString());
    sent.length = 0;
    nextResult = null;
    await cleanDatabase();
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("syncs Meta's status for the official WABA only, and reports templates it does not manage", async () => {
    const officialOrg = await official();
    const client = fakeClient([remoteOf(utilityTemplate("U01"), "APPROVED"), remoteOf(utilityTemplate("U02"), "REJECTED", { rejected_reason: "INVALID_FORMAT" }), { id: "x", name: "nesafric_notification", language: "en", status: "APPROVED", category: "UTILITY" }]);
    const result = await syncTemplateStatuses({ client });
    expect(client.list).toHaveBeenCalledWith(WABA);
    expect(result.states).toHaveLength(30);
    expect(result.states.find(({ templateKey }) => templateKey === "U01")).toMatchObject({ status: "APPROVED", metaCategory: "UTILITY", contentHash: templateContentHash(utilityTemplate("U01")) });
    expect(result.states.find(({ templateKey }) => templateKey === "U02")).toMatchObject({ status: "REJECTED", rejectedReason: "INVALID_FORMAT" });
    expect(result.states.find(({ templateKey }) => templateKey === "U03")).toMatchObject({ status: "NOT_SUBMITTED" });
    expect(result.unmanaged).toEqual([{ name: "nesafric_notification", language: "en", status: "APPROVED", category: "UTILITY" }]);
    expect(await approvedTemplate(db, utilityTemplate("U01"))).toMatchObject({ approved: true, name: "nes_property_enquiry_received" });
    expect(await db.auditEvent.count({ where: { organisationId: officialOrg.id, action: "whatsapp_template.status_synced" } })).toBeGreaterThan(0);

    // A different WABA in the deployment settings stops everything before Meta is called.
    vi.stubEnv("WHATSAPP_TEMPLATE_WABA_ID", "999");
    const other = fakeClient([]);
    await expect(syncTemplateStatuses({ client: other })).rejects.toThrow(/does not match/);
    expect(other.list).not.toHaveBeenCalled();
  });

  it("submits only final, valid templates that are not already on Meta, and never resubmits a rejection", async () => {
    await official();
    const remote = [remoteOf(utilityTemplate("U01"), "APPROVED"), remoteOf(utilityTemplate("U02"), "REJECTED", { rejected_reason: "TAG_CONTENT_MISMATCH" })];
    await expect(submitTemplates({ keys: ["U05"], confirmWabaId: WABA, client: fakeClient(remote) })).rejects.toThrow(/switched off/);
    vi.stubEnv("WHATSAPP_TEMPLATE_SUBMISSION_ENABLED", "true");
    await expect(submitTemplates({ keys: ["U05"], confirmWabaId: "777", client: fakeClient(remote) })).rejects.toThrow(/not the official one/);

    // Every catalogue body now passes the format checks (tests/whatsapp-utility-templates.unit.test.ts);
    // text that fails one is refused by `submit` before Meta is called.

    const client = fakeClient(remote);
    const { outcomes } = await submitTemplates({ keys: ["U01", "U02", "U05"], confirmWabaId: WABA, client });
    expect(outcomes.map(({ key, result }) => `${key}:${result}`)).toEqual(["U01:SKIPPED", "U02:SKIPPED", "U05:SUBMITTED"]);
    expect(outcomes[0].reason).toMatch(/Already on Meta as APPROVED; not overwritten/);
    expect(outcomes[1].reason).toMatch(/Rejected by Meta \(TAG_CONTENT_MISMATCH\).*not resubmitted automatically/);
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(client.create).toHaveBeenCalledWith(WABA, templateCreationPayload(utilityTemplate("U05")));
    expect(await db.whatsAppTemplateState.findFirstOrThrow({ where: { templateKey: "U05" } })).toMatchObject({ status: "PENDING", metaTemplateId: "meta-new", submittedAt: expect.any(Date) });
    expect(await db.auditEvent.count({ where: { action: "whatsapp_template.submitted", entityId: "U05" } })).toBe(1);

    // A flagged template is submitted only once a person acknowledges the flag.
    const flagged = utilityTemplate("U13") as { reviewFlag?: string };
    flagged.reviewFlag = "Check the workspace wording.";
    try {
      expect((await submitTemplates({ keys: ["U13"], confirmWabaId: WABA, client })).outcomes[0]).toMatchObject({ result: "SKIPPED", reason: expect.stringMatching(/Needs review/) });
      expect((await submitTemplates({ keys: ["U13"], confirmWabaId: WABA, client, acknowledgeFlags: ["U13"] })).outcomes[0].result).toBe("SUBMITTED");
    } finally {
      delete flagged.reviewFlag;
    }
  });

  it("records template review webhooks, and stops sending a template Meta moves to Marketing", async () => {
    await official();
    await approve("U01");
    const status = (event: string, reason?: string) => ({ object: "whatsapp_business_account", entry: [{ id: WABA, changes: [{ field: "message_template_status_update", value: { event, message_template_id: 42, message_template_name: "nes_property_enquiry_received", message_template_language: "en", ...(reason ? { reason } : {}) } }] }] });
    expect((await webhook(status("PAUSED"), "wrong-secret")).status).toBe(401);
    expect((await webhook(status("PAUSED"))).status).toBe(200);
    expect((await webhook(status("PAUSED"))).status).toBe(200);
    await work();
    expect(await db.backgroundJob.count({ where: { type: "whatsapp-template-status" } })).toBe(1);
    expect(await db.whatsAppTemplateState.findFirstOrThrow({ where: { templateKey: "U01" } })).toMatchObject({ status: "PAUSED" });
    expect(await approvedTemplate(db, utilityTemplate("U01"))).toMatchObject({ approved: false, reason: expect.stringMatching(/PAUSED/) });

    await webhook(status("APPROVED"));
    await webhook({ object: "whatsapp_business_account", entry: [{ id: WABA, changes: [{ field: "template_category_update", value: { message_template_id: 42, message_template_name: "nes_property_enquiry_received", message_template_language: "en", previous_category: "UTILITY", new_category: "MARKETING" } }] }] });
    await work();
    expect(await db.whatsAppTemplateState.findFirstOrThrow({ where: { templateKey: "U01" } })).toMatchObject({ status: "APPROVED", metaCategory: "MARKETING" });
    expect(await approvedTemplate(db, utilityTemplate("U01"))).toMatchObject({ approved: false, reason: expect.stringMatching(/MARKETING, not UTILITY/) });
    expect(await db.auditEvent.count({ where: { action: { in: ["whatsapp_template.status_changed", "whatsapp_template.category_changed"] } } })).toBe(3);

    // Another WABA's template events never reach the official state.
    await webhook({ ...status("REJECTED"), entry: [{ ...status("REJECTED").entry[0], id: "777" }] });
    await work();
    expect(await db.whatsAppTemplateState.findFirstOrThrow({ where: { templateKey: "U01" } })).toMatchObject({ status: "APPROVED" });
  });

  it("sends an enquiry acknowledgement only to an enquirer who opted in, once, after approval, and tracks its delivery", async () => {
    await official();
    const { owner, organisation, listing } = await publishedListing();
    await settle();
    const unapproved = await createMarketplaceLead(listing.id, undefined, { name: "Ama Mensah", phone: "0241110001", whatsappUpdatesConsent: true });
    await dispatchUtilityEvents();
    expect((await dispatches("U01")).map(({ outcome, reason }) => `${outcome}:${reason}`)).toEqual(["SKIPPED:Template U01 is NOT_SUBMITTED, not APPROVED."]);

    await approve("U01");
    await dispatchUtilityEvents();
    await work();
    // Approval later does not send a stale message for an event already decided.
    expect(templatesTo(SEEKER)).toHaveLength(0);

    const lead = await createMarketplaceLead(listing.id, undefined, { name: "Ama Mensah", phone: "+233241110001", whatsappUpdatesConsent: true });
    await createMarketplaceLead(listing.id, undefined, { name: "Yaw Boateng", phone: "+233241110009" });
    await dispatchUtilityEvents();
    await dispatchUtilityEvents();
    await work();
    const [message] = templatesTo(SEEKER);
    expect(templatesTo(SEEKER)).toHaveLength(1);
    const reference = `EQ-${lead.id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    expect(message.whatsappTemplate).toEqual({ name: "nes_property_enquiry_received", language: "en", bodyParameters: ["Ama", "3-bedroom house in Spintex", reference] });
    expect(message.body).toBe(`Hello Ama, your enquiry about property 3-bedroom house in Spintex has been received by NesAfric. Reference: ${reference}. We will update you when the agent responds.`);
    expect(sent.filter(({ recipientAddress }) => recipientAddress === "233241110009")).toHaveLength(0);
    expect((await dispatches("U01")).map(({ outcome, reason }) => `${outcome}:${reason}`)).toEqual([
      "SKIPPED:Template U01 is NOT_SUBMITTED, not APPROVED.", "QUEUED:null", "SKIPPED:The enquirer did not ask for WhatsApp updates.",
    ]);
    expect(unapproved.id).not.toBe(lead.id);

    // Meta's delivery and read receipts update the same delivery record.
    const delivery = await db.messageDelivery.findFirstOrThrow({ where: { recipientAddress: SEEKER, status: "SENT" } });
    const receipt = (status: string) => ({ object: "whatsapp_business_account", entry: [{ id: WABA, changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, statuses: [{ id: delivery.providerReference, recipient_id: SEEKER, status, timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] });
    await webhook(receipt("delivered"));
    await webhook(receipt("read"));
    await webhook(receipt("read"));
    await work();
    expect(await db.messageDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ status: "READ", deliveredAt: expect.any(Date), readAt: expect.any(Date) });

    // The agent responding is the update U01 promised (U05); internal sales stages are not.
    await approve("U05");
    await updateMarketplaceLead(owner.id, organisation.id, lead.id, { status: "CONTACTED" });
    await updateMarketplaceLead(owner.id, organisation.id, lead.id, { status: "QUALIFIED" });
    await dispatchUtilityEvents();
    await work();
    expect(templatesTo(SEEKER).slice(1).map(({ whatsappTemplate }) => [whatsappTemplate?.name, whatsappTemplate?.bodyParameters])).toEqual([
      ["nes_property_enquiry_response", ["Ama", "3-bedroom house in Spintex", "the agent has responded", reference]],
    ]);
  });

  it("keeps viewing seekers updated: confirmed, rescheduled and cancelled", async () => {
    await official();
    const { owner, organisation, listing } = await publishedListing();
    await approve("U02", "U04", "U06");
    await settle();
    const lead = await createMarketplaceLead(listing.id, undefined, { name: "Kwame Asante", phone: "+233241110001", whatsappUpdatesConsent: true });
    const viewing = await createViewingRequest(listing.id, undefined, { leadId: lead.id, preferredTimes: [{ startsAt: "2037-10-24T10:00:00.000Z", endsAt: "2037-10-24T11:00:00.000Z", timezone: "Africa/Accra" }] });
    await updateViewingRequest(owner.id, organisation.id, viewing.id, { status: "CONFIRMED", confirmedStartsAt: "2037-10-24T10:00:00.000Z", confirmedEndsAt: "2037-10-24T11:00:00.000Z" });
    await dispatchUtilityEvents();
    await work();
    // A viewing request has no catalogue template; the confirmation names the agent.
    expect(templatesTo(SEEKER).map(({ whatsappTemplate }) => whatsappTemplate?.name)).toEqual(["nes_property_viewing_confirmed"]);
    expect(templatesTo(SEEKER)[0].whatsappTemplate?.bodyParameters).toEqual(["Kwame", "3-bedroom house in Spintex", "Sat, 24 Oct 2037", "10:00 GMT", "Abena Agyei"]);

    await updateViewingRequest(owner.id, organisation.id, viewing.id, { status: "RESCHEDULED", confirmedStartsAt: "2037-10-26T15:30:00.000Z", confirmedEndsAt: "2037-10-26T16:30:00.000Z" });
    await dispatchUtilityEvents();
    await updateViewingRequest(owner.id, organisation.id, viewing.id, { status: "CANCELLED", note: "The house has been let" });
    await dispatchUtilityEvents();
    await work();
    expect(templatesTo(SEEKER).slice(1).map(({ whatsappTemplate }) => [whatsappTemplate?.name, whatsappTemplate?.bodyParameters])).toEqual([
      ["nes_property_viewing_rescheduled", ["Kwame", "3-bedroom house in Spintex", "Mon, 26 Oct 2037", "15:30 GMT"]],
      ["nes_property_viewing_cancelled", ["Kwame", "3-bedroom house in Spintex", "Mon, 26 Oct 2037, 15:30 GMT", `VW-${viewing.id.replace(/-/g, "").slice(0, 6).toUpperCase()}`]],
    ]);
  });

  it("invites a tenant on WhatsApp only with recorded consent, without the access code, and confirms the connection", async () => {
    const officialOrg = await official();
    await approve("U17", "U18", "U19");
    const landlord = await registerUser({ displayName: "Akosua Mensah", email: "akosua@utility.test", password: "secure-password-123" });
    const organisation = await createOrganisation(landlord.id, { name: "Mensah Properties", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const property = await createProperty(landlord.id, organisation.id, { name: "Adenta Court", referenceNumber: "AC-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "4B" }] });
    const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
    const { relationship } = await createTenant(landlord.id, organisation.id, { legalName: "Kojo Owusu", phone: "0241110003", countryCode: "GH" });
    const lease = await createLease(landlord.id, organisation.id, { referenceNumber: "AC-L1", propertyId: property.id, unitId: unit.id, tenantOrganisationIds: [relationship.id], startDate: "2026-01-01", endDate: "2026-12-31", rentAmountMinor: "150000", depositAmountMinor: "150000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE" });
    await settle();

    // A number the landlord typed in is not consent.
    await createTenantAccessInvitation(landlord.id, organisation.id, relationship.id, lease.id);
    await dispatchUtilityEvents();
    await work();
    expect(templatesTo(TENANT)).toHaveLength(0);
    expect((await dispatches("U17"))[0].reason).toBe("The landlord has not recorded the tenant's consent to WhatsApp messages.");

    await db.tenantOrganisation.update({ where: { id: relationship.id }, data: { communicationWhatsappAllowed: true } });
    const revoked = await createTenantAccessInvitation(landlord.id, organisation.id, relationship.id, lease.id);
    await revokeTenantAccessInvitation(landlord.id, organisation.id, relationship.id, revoked.invitation.id);
    const { code, invitation } = await createTenantAccessInvitation(landlord.id, organisation.id, relationship.id, lease.id);
    const reference = `TI-${invitation.id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    await dispatchUtilityEvents();
    await work();
    expect(templatesTo(TENANT)).toHaveLength(1);
    expect(templatesTo(TENANT)[0].whatsappTemplate?.bodyParameters).toEqual(["Kojo", "Mensah Properties", "Adenta Court", reference]);
    expect(JSON.stringify(templatesTo(TENANT)[0])).not.toContain(code.replace(/^NT-/, "").slice(0, 5));
    expect((await dispatches("U17")).map(({ outcome }) => outcome)).toEqual(["SKIPPED", "SKIPPED", "QUEUED"]);

    // Replying explains how to verify, once; it links nothing and never repeats the code.
    const reply = await inbound(TENANT, "Hello, I got your message");
    expect(reply).toMatch(/tenant invitation from Mensah Properties/);
    expect(reply).toMatch(/Reply link/);
    expect(reply).not.toContain(code);
    expect(await db.tenantOrganisation.findUniqueOrThrow({ where: { id: relationship.id } })).toMatchObject({ userId: null });
    expect(await inbound(TENANT, "Hello again")).not.toMatch(/tenant invitation/);
    // Another number never hears about this invitation.
    expect(await inbound("233241110007", "Hello")).not.toMatch(/tenant invitation/);

    // Connecting still needs an account that proved the number, and the code.
    const tenantUser = await registerUser({ displayName: "Kojo Owusu", email: "kojo@utility.test", password: "secure-password-123" });
    await linkWhatsAppIdentity(TENANT, tenantUser.id, "SMS_OTP", officialOrg.id);
    await linkWhatsAppIdentity(LANDLORD, landlord.id, "SMS_OTP", officialOrg.id);
    // The tenant's last chat was days ago, so the confirmation is not left to the chat.
    await db.channelIdentity.updateMany({ where: { userId: tenantUser.id }, data: { lastInboundAt: new Date(Date.now() - 3 * 24 * 60 * 60_000) } });
    await redeemTenantAccessCode(tenantUser.id, code);
    await dispatchUtilityEvents();
    await work();
    expect(templatesTo(TENANT).map(({ whatsappTemplate }) => whatsappTemplate?.name)).toEqual(["nes_tenant_invitation", "nes_tenant_link_confirmed"]);
    expect(templatesTo(TENANT)[1].whatsappTemplate?.bodyParameters).toEqual(["Kojo", "Adenta Court", "Mensah Properties"]);
    expect(templatesTo(LANDLORD).map(({ whatsappTemplate }) => [whatsappTemplate?.name, whatsappTemplate?.bodyParameters])).toEqual([["nes_tenant_invitation_accepted", ["Akosua", "Kojo Owusu", "Adenta Court", reference]]]);
  });

  it("tells a linked tenant about web repair requests, but not WhatsApp ones, not after STOP, and never across workspaces", async () => {
    const officialOrg = await official();
    await approve("U23", "U25");
    const landlord = await registerUser({ displayName: "Ama Owusu", email: "ama@utility.test", password: "secure-password-123" });
    const organisation = await createOrganisation(landlord.id, { name: "Owusu Homes", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    const property = await createProperty(landlord.id, organisation.id, { name: "Palm Court", referenceNumber: "PC-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }] });
    const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
    const { relationship } = await createTenant(landlord.id, organisation.id, { legalName: "Kojo Owusu", countryCode: "GH" });
    await createLease(landlord.id, organisation.id, { referenceNumber: "PC-L1", propertyId: property.id, unitId: unit.id, tenantOrganisationIds: [relationship.id], startDate: "2026-01-01", endDate: "2026-12-31", rentAmountMinor: "150000", depositAmountMinor: "150000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE" });
    const tenantUser = await registerUser({ displayName: "Kojo Owusu", email: "kojo2@utility.test", password: "secure-password-123" });
    await db.tenantOrganisation.update({ where: { id: relationship.id }, data: { userId: tenantUser.id } });
    await linkWhatsAppIdentity(TENANT, tenantUser.id, "SMS_OTP", officialOrg.id);
    const other = await registerUser({ displayName: "Other Landlord", email: "other@utility.test", password: "secure-password-123" });
    const otherOrganisation = await createOrganisation(other.id, { name: "Other Homes", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    await settle();

    const request = await createMaintenanceRequest(landlord.id, organisation.id, { propertyId: property.id, unitId: unit.id, tenantOrganisationId: relationship.id, title: "Leaking kitchen tap", description: "The kitchen tap is leaking", category: "plumbing", priority: "NORMAL" }) as { id: string; referenceNumber: string };
    await createMaintenanceRequest(landlord.id, organisation.id, { propertyId: property.id, unitId: unit.id, tenantOrganisationId: relationship.id, title: "Broken window", description: "Reported on WhatsApp", category: "carpentry", priority: "NORMAL", intakeChannel: "WHATSAPP" });
    // An event naming another workspace cannot reach this workspace's request or tenant.
    await db.domainEvent.create({ data: { organisationId: otherOrganisation.id, name: "maintenance.requested", aggregateType: "maintenance_request", aggregateId: request.id, payload: {} } });
    await dispatchUtilityEvents();
    await work();
    expect(templatesTo(TENANT)).toHaveLength(1);
    expect(templatesTo(TENANT)[0].whatsappTemplate?.bodyParameters).toEqual(["Kojo", "Palm Court, A1", request.referenceNumber, "received"]);
    expect((await dispatches("U23")).map(({ outcome, reason }) => `${outcome}:${reason}`).sort()).toEqual([
      "QUEUED:null", "SKIPPED:Reported on WhatsApp; answered in the chat.", "SKIPPED:The request does not belong to the event's workspace.",
    ]);

    await setWhatsAppOptOut(db, TENANT, true);
    await createMaintenanceRequest(landlord.id, organisation.id, { propertyId: property.id, unitId: unit.id, tenantOrganisationId: relationship.id, title: "No water", description: "No water since morning", category: "plumbing", priority: "URGENT" });
    await dispatchUtilityEvents();
    await work();
    expect(templatesTo(TENANT)).toHaveLength(1);
    expect((await dispatches("U23")).at(-1)?.reason).toBe("The recipient opted out of WhatsApp messages (STOP).");
  });

  it("tells agents about their business verification and listing reviews", async () => {
    const officialOrg = await official();
    await approve("U07", "U08", "U10", "U11");
    const agent = await registerUser({ displayName: "Kofi Ansah", email: "kofi@utility.test", password: "secure-password-123" });
    await linkWhatsAppIdentity(AGENT, agent.id, "SMS_OTP", officialOrg.id);
    const professional = await createMarketplaceProfessional(agent.id, { type: "INDIVIDUAL_AGENT", displayName: "Golden Key Realty", countryCode: "GH" });
    await dispatchUtilityEvents();
    const principal = await createPlatformAdmin();
    const reviewer = await db.user.findUniqueOrThrow({ where: { id: principal.userId } });
    await reviewMarketplaceVerification(reviewer, professional.id, { status: "VERIFIED" });
    await dispatchUtilityEvents();
    await work();
    expect(templatesTo(AGENT).map(({ whatsappTemplate }) => whatsappTemplate?.name)).toEqual(["nes_agent_registration_received", "nes_agent_verification_approved"]);
    expect(templatesTo(AGENT)[0].whatsappTemplate?.bodyParameters).toEqual(["Kofi", "agent", "Golden Key Realty", `RG-${professional.id.replace(/-/g, "").slice(0, 6).toUpperCase()}`]);
    expect(templatesTo(AGENT)[1].whatsappTemplate?.bodyParameters).toEqual(["Kofi", "Golden Key Realty"]);
    // The profile's hidden backing organisation is not announced as a workspace.
    expect(await db.whatsAppUtilityDispatch.count({ where: { templateKey: "U13" } })).toBe(0);
  });

  it("sends a verification decision once: the generic notification steps aside only while the Utility template is live", async () => {
    vi.stubEnv("WHATSAPP_TEMPLATE_NOTIFICATION", "nesafric_notification:en");
    const officialOrg = await official();
    const principal = await createPlatformAdmin();
    const reviewer = await db.user.findUniqueOrThrow({ where: { id: principal.userId } });
    const agent = await registerUser({ displayName: "Kofi Ansah", email: "kofi@utility.test", password: "secure-password-123" });
    await linkWhatsAppIdentity(AGENT, agent.id, "SMS_OTP", officialOrg.id);

    // U08 not approved yet: only the generic NOTIFICATION message reports the decision.
    const first = await createMarketplaceProfessional(agent.id, { type: "INDIVIDUAL_AGENT", displayName: "Golden Key Realty", countryCode: "GH" });
    await settle();
    await reviewMarketplaceVerification(reviewer, first.id, { status: "VERIFIED" });
    await dispatchUtilityEvents();
    await work();
    expect(templatesTo(AGENT).map(({ whatsappTemplate }) => whatsappTemplate?.name)).toEqual(["nesafric_notification"]);

    // U08 approved: the Utility template is the only message.
    await approve("U08");
    const second = await createMarketplaceProfessional(agent.id, { type: "INDIVIDUAL_AGENT", displayName: "Ansah Homes", countryCode: "GH" });
    await settle();
    await reviewMarketplaceVerification(reviewer, second.id, { status: "VERIFIED" });
    await dispatchUtilityEvents();
    await work();
    expect(templatesTo(AGENT).map(({ whatsappTemplate }) => whatsappTemplate?.name)).toEqual(["nes_agent_verification_approved"]);
  });

  it("confirms properties once per batch, tells connected tenants about lease changes, and reports suspensions", async () => {
    const officialOrg = await official();
    await approve("U15", "U20", "U30", "U09");
    const landlord = await registerUser({ displayName: "Akosua Mensah", email: "akosua2@utility.test", password: "secure-password-123" });
    await linkWhatsAppIdentity(LANDLORD, landlord.id, "SMS_OTP", officialOrg.id);
    const organisation = await createOrganisation(landlord.id, { name: "Mensah Properties", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await settle();

    // Two properties added together: one confirmation, naming the first.
    const property = await createProperty(landlord.id, organisation.id, { name: "Adenta Court", referenceNumber: "AC-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "4B" }] });
    await createProperty(landlord.id, organisation.id, { name: "Palm Court", referenceNumber: "PC-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    await dispatchUtilityEvents();
    await work();
    expect(templatesTo(LANDLORD).map(({ whatsappTemplate }) => [whatsappTemplate?.name, whatsappTemplate?.bodyParameters])).toEqual([["nes_property_added", ["Akosua", "Adenta Court", "Mensah Properties", "AC-1"]]]);
    expect((await dispatches("U15")).map(({ reason }) => reason)).toEqual([null, "Another property added moments ago was already confirmed."]);

    // Lease amendments reach the tenant only once their own account is connected, and never for drafts.
    const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
    const { relationship } = await createTenant(landlord.id, organisation.id, { legalName: "Kojo Owusu", countryCode: "GH" });
    const draft = await createLease(landlord.id, organisation.id, { referenceNumber: "AC-D1", propertyId: property.id, unitId: unit.id, tenantOrganisationIds: [relationship.id], startDate: "2026-01-01", endDate: "2026-12-31", rentAmountMinor: "150000", depositAmountMinor: "150000", currencyCode: "GHS", rentFrequency: "MONTHLY" });
    const lease = await createLease(landlord.id, organisation.id, { referenceNumber: "AC-L1", propertyId: property.id, unitId: unit.id, tenantOrganisationIds: [relationship.id], startDate: "2026-01-01", endDate: "2026-12-31", rentAmountMinor: "150000", depositAmountMinor: "150000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE" });
    await amendLease(landlord.id, organisation.id, lease.id, "Rent review", { rentAmountMinor: "160000" });
    await dispatchUtilityEvents();
    expect((await dispatches("U20")).map(({ reason }) => reason)).toEqual(["No tenant on the lease has connected an account."]);

    const tenantUser = await registerUser({ displayName: "Kojo Owusu", email: "kojo3@utility.test", password: "secure-password-123" });
    await db.tenantOrganisation.update({ where: { id: relationship.id }, data: { userId: tenantUser.id } });
    await linkWhatsAppIdentity(TENANT, tenantUser.id, "SMS_OTP", officialOrg.id);
    await amendLease(landlord.id, organisation.id, draft.id, "Draft wording", { notes: "x" });
    await amendLease(landlord.id, organisation.id, lease.id, "Parking added", { parking: "Bay 4" });
    await dispatchUtilityEvents();
    await work();
    const event = await db.domainEvent.findFirstOrThrow({ where: { name: "lease.amended", aggregateId: lease.id }, orderBy: { occurredAt: "desc" } });
    expect(templatesTo(TENANT).map(({ whatsappTemplate }) => [whatsappTemplate?.name, whatsappTemplate?.bodyParameters])).toEqual([
      ["nes_tenancy_details_updated", ["Kojo", "Adenta Court, 4B", "Mensah Properties", `TU-${event.id.replace(/-/g, "").slice(0, 6).toUpperCase()}`]],
    ]);
    expect((await dispatches("U20")).map(({ reason }) => reason)).toContain("The lease is still a draft.");

    // The lease ending ends the tenant's association (U22).
    await approve("U22");
    await transitionLease(landlord.id, organisation.id, lease.id, "TERMINATED");
    await dispatchUtilityEvents();
    await work();
    expect(templatesTo(TENANT).at(-1)?.whatsappTemplate).toMatchObject({ name: "nes_tenant_link_removed", bodyParameters: ["Kojo", "Adenta Court, 4B", expect.stringMatching(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/), "Mensah Properties"] });

    // A reviewer's decisions on a business profile: more information needed (U09), then suspension (U30).
    const agent = await registerUser({ displayName: "Kofi Ansah", email: "kofi2@utility.test", password: "secure-password-123" });
    await linkWhatsAppIdentity(AGENT, agent.id, "SMS_OTP", officialOrg.id);
    const professional = await createMarketplaceProfessional(agent.id, { type: "BROKER", displayName: "Golden Key Realty", countryCode: "GH" });
    await settle();
    const reviewer = await db.user.findUniqueOrThrow({ where: { id: (await createPlatformAdmin()).userId } });
    await reviewMarketplaceVerification(reviewer, professional.id, { status: "REJECTED", reason: "a readable business registration certificate" });
    await dispatchUtilityEvents();
    await work();
    const decisions = templatesTo(AGENT).map(({ whatsappTemplate }) => [whatsappTemplate?.name, whatsappTemplate?.bodyParameters?.slice(0, 3)]);
    const second = await createMarketplaceProfessional(agent.id, { type: "BROKER", displayName: "Ansah Brokers", countryCode: "GH" });
    await reviewMarketplaceVerification(reviewer, second.id, { status: "VERIFIED" });
    await settle();
    await reviewMarketplaceVerification(reviewer, second.id, { status: "SUSPENDED", reason: "Complaint under review" });
    await dispatchUtilityEvents();
    await work();
    decisions.push(...templatesTo(AGENT).map(({ whatsappTemplate }) => [whatsappTemplate?.name, whatsappTemplate?.bodyParameters?.slice(0, 3)]));
    expect(decisions).toEqual([
      ["nes_agent_verification_action_required", ["Kofi", "Golden Key Realty", "a readable business registration certificate"]],
      ["nes_account_status_updated", ["Kofi", "Ansah Brokers", "suspended"]],
    ]);
  });

  it("is off until enabled, and never sends for events before the start time or older than 48 hours", async () => {
    await official();
    const { listing } = await publishedListing();
    await approve("U01");
    vi.stubEnv("WHATSAPP_UTILITY_EVENTS_SINCE", "");
    await createMarketplaceLead(listing.id, undefined, { name: "Ama Mensah", phone: "+233241110001", whatsappUpdatesConsent: true });
    expect(await dispatchUtilityEvents()).toEqual({ enabled: false, decided: 0, failed: 0 });

    vi.stubEnv("WHATSAPP_UTILITY_EVENTS_SINCE", new Date().toISOString());
    await createMarketplaceLead(listing.id, undefined, { name: "Esi Mensah", phone: "+233241110005", whatsappUpdatesConsent: true });
    const old = await createMarketplaceLead(listing.id, undefined, { name: "Yaa Mensah", phone: "+233241110006", whatsappUpdatesConsent: true });
    vi.stubEnv("WHATSAPP_UTILITY_EVENTS_SINCE", new Date(Date.now() - 5 * 24 * 60 * 60_000).toISOString());
    await db.domainEvent.updateMany({ where: { aggregateId: old.id }, data: { occurredAt: new Date(Date.now() - 49 * 60 * 60_000) } });
    await dispatchUtilityEvents();
    await work();
    expect(templatesTo(SEEKER)).toHaveLength(1);
    expect(sent.map(({ recipientAddress }) => recipientAddress)).toContain("233241110005");
    expect(sent.map(({ recipientAddress }) => recipientAddress)).not.toContain("233241110006");
  });

  it("retries a transient Meta failure and never resends an unconfirmed one", async () => {
    await official();
    const { listing } = await publishedListing();
    await approve("U01");
    await settle();
    await createMarketplaceLead(listing.id, undefined, { name: "Ama Mensah", phone: "+233241110001", whatsappUpdatesConsent: true });
    await dispatchUtilityEvents();
    nextResult = { status: "FAILED", retryable: true, failureReason: "WhatsApp provider responded with status 503." };
    await runDueJobs(createJobHandlers(undefined, adapters));
    expect(await db.backgroundJob.findFirstOrThrow({ where: { type: "conversation-message-delivery" } })).toMatchObject({ status: "FAILED", attempts: 1 });
    await db.backgroundJob.updateMany({ where: { type: "conversation-message-delivery" }, data: { runAt: new Date() } });
    await runDueJobs(createJobHandlers(undefined, adapters));
    expect(templatesTo(SEEKER)).toHaveLength(1);

    await createMarketplaceLead(listing.id, undefined, { name: "Esi Mensah", phone: "+233241110005", whatsappUpdatesConsent: true });
    await dispatchUtilityEvents();
    nextResult = { status: "FAILED", unconfirmed: true, retryable: false, failureReason: "WhatsApp provider request failed or timed out; delivery is unconfirmed." };
    await work();
    await db.backgroundJob.updateMany({ where: { type: "conversation-message-delivery" }, data: { runAt: new Date() } });
    await work();
    expect(sent.filter(({ recipientAddress }) => recipientAddress === "233241110005")).toHaveLength(0);
  });
});
