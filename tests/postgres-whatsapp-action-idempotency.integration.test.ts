import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/modules/messaging/otp-provider", async () => (await import("./helpers/fake-sms-otp")).fakeSmsOtpModule);
import type { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { createMarketplaceLead } from "@/modules/listings/service";
import { runOnce, setActionFaultInjector, type ActionFaultStage } from "@/modules/whatsapp-assistant/actions";
import { ingestWebhook } from "@/modules/whatsapp-assistant/ingest";
import { processContact } from "@/modules/whatsapp-assistant/processor";
import { referenceFor } from "@/modules/whatsapp-assistant/references";
import { fakeSms } from "./helpers/fake-sms-otp";
import { allText, answerSmsCode, configureAssistantEnv, converse, FakeGraphApi, PNG, sign, webhookBody, type Incoming } from "./helpers/whatsapp-assistant";
import { cleanWhatsAppDatabase, publishedListing } from "./helpers/whatsapp-fixtures";

/**
 * Exactly-once business actions under injected failures. Every creation step started from WhatsApp
 * is bound to its record by a unique action key written in the record's own transaction, so:
 * - a failure before commit leaves nothing behind (no record, no binding, no follow-up) and the
 *   retry creates exactly one record with all its follow-ups;
 * - a failure after commit (lost acknowledgement, dead worker) is resolved from the binding and the
 *   retry returns the original record;
 * - competing and stale attempts cannot create a second record or replace the bound result;
 * - none of this relies on names, titles or timestamps, so identical-looking records stay distinct.
 */

const AGENT = "233247700001";
const CUSTOMER = "233247700002";
const PROVIDER = "233247700003";

class InjectedFault extends Error {
  constructor(stage: string) {
    super(`Injected fault at ${stage}`);
    this.name = "InjectedFault";
  }
}

/** Throws once, at `stage`, for the first action of this kind (`<kind>:<inbound message id>`). */
function failOnce(stage: ActionFaultStage, kind: string) {
  let fired = false;
  const key = new RegExp(`^${kind}:[^:]+$`);
  setActionFaultInjector((current, actionKey) => {
    if (fired || current !== stage || !key.test(actionKey)) return;
    fired = true;
    throw new InjectedFault(stage);
  });
  return () => fired;
}

async function ingest(from: string, incoming: Incoming) {
  const body = webhookBody(from, incoming);
  const result = await ingestWebhook(body, sign(body));
  if (!result.ok) throw new Error(result.reason);
  const contactId = result.contactIds[0];
  const inbound = await db.whatsAppInboundMessage.findFirstOrThrow({ where: { contactId }, orderBy: { sentAt: "desc" } });
  return { contactId, inboundId: inbound.id };
}

/**
 * Processes one message completely, then puts the world back as if the worker had died after the
 * business transaction committed but before the step's own commit (session state, replies and the
 * PROCESSED mark) — i.e. the business commit's acknowledgement never reached the conversation.
 */
async function processThenLoseAck(api: FakeGraphApi, from: string, incoming: Incoming) {
  const { contactId, inboundId } = await ingest(from, incoming);
  const before = await db.whatsAppAssistantSession.findUniqueOrThrow({ where: { contactId } });
  await processContact(contactId);
  const firstReplies = api.take();
  await db.$transaction([
    db.whatsAppOutboundMessage.deleteMany({ where: { idempotencyKey: { startsWith: `reply:${inboundId}:` } } }),
    db.whatsAppInboundMessage.update({ where: { id: inboundId }, data: { status: "RECEIVED", processedAt: null } }),
    db.whatsAppAssistantSession.update({
      where: { contactId },
      data: { workflow: before.workflow, step: before.step, data: before.data as Prisma.InputJsonValue, version: before.version },
    }),
  ]);
  return { contactId, inboundId, firstReplies };
}

async function retry(api: FakeGraphApi, contactId: string) {
  await processContact(contactId);
  return api.take();
}

/** Walks the independent-agent registration up to (not including) the final submit. */
async function walkAgentRegistration(api: FakeGraphApi, from: string, name: string, agency = "skip") {
  await converse(api, from, { text: "I am an agent and want to register" });
  await converse(api, from, { text: name });
  await converse(api, from, { choice: "br:phone:yes" });
  await converse(api, from, { text: "skip" });
  await converse(api, from, { text: "East Legon, Adenta" });
  await converse(api, from, { text: "residential rentals" });
  await converse(api, from, { text: "skip" });
  await converse(api, from, { text: agency });
  const prompt = await converse(api, from, { choice: "br:submit" });
  if (!allText(prompt).includes("6-digit code")) throw new Error(`expected an SMS code prompt, got: ${allText(prompt)}`);
}

/** Walks the listing conversation up to the "use this text?" step; the next "ls:copy:ok" creates the draft. */
async function walkListing(api: FakeGraphApi, from: string) {
  await converse(api, from, { text: "I want to list a property" });
  await converse(api, from, { choice: "ls:type:SALE" });
  await converse(api, from, { choice: "ls:cat:HOUSE" });
  await converse(api, from, { text: "Adenta, Accra" });
  await converse(api, from, { text: "3" });
  await converse(api, from, { text: "3" });
  await converse(api, from, { text: "skip" });
  await converse(api, from, { text: "GHS 1.5 million" });
  await converse(api, from, { choice: "ls:furn:UNFURNISHED" });
  await converse(api, from, { text: "parking, borehole" });
  await converse(api, from, { text: "now" });
  await converse(api, from, { choice: "ls:auth:MANAGING_AGENT" });
  await converse(api, from, { text: "Signed mandate from the owner" });
  await converse(api, from, { text: "Family home on a quiet street, walled and gated." });
}

async function registeredAgent(api: FakeGraphApi) {
  await walkAgentRegistration(api, AGENT, "Kwame Mensah");
  await answerSmsCode(api, AGENT);
}

/** Walks provider registration up to the SMS code prompt. */
async function walkProviderRegistration(api: FakeGraphApi, type: "INDIVIDUAL" | "COMPANY") {
  await converse(api, PROVIDER, { text: "I want to register my plumbing services" });
  await converse(api, PROVIDER, { choice: `pr:type:${type}` });
  await converse(api, PROVIDER, { text: "Kojo Plumbing Works" });
  if (type === "COMPANY") await converse(api, PROVIDER, { text: "Kojo Asante" });
  await converse(api, PROVIDER, { text: "plumbing" });
  await converse(api, PROVIDER, { text: "Tema, Spintex" });
  await converse(api, PROVIDER, { text: "Fast, tidy plumbing repairs and installations for homes and offices." });
  await converse(api, PROVIDER, { text: "8 years experience" });
  await converse(api, PROVIDER, { choice: "pr:phone:yes" });
  await converse(api, PROVIDER, { text: "skip" });
  const prompt = await converse(api, PROVIDER, { choice: "pr:submit" });
  if (!allText(prompt).includes("6-digit code")) throw new Error(`expected an SMS code prompt, got: ${allText(prompt)}`);
}

const smsCode = (from: string) => fakeSms.codes.get(`+${from}`)!;

describe("WhatsApp assistant — exactly-once business actions under failure", () => {
  const api = new FakeGraphApi();
  beforeAll(() => { configureAssistantEnv(); api.install(); });
  beforeEach(async () => { await cleanWhatsAppDatabase(); api.take(); api.failNext = []; fakeSms.codes.clear(); });
  afterEach(() => setActionFaultInjector(null));
  afterAll(async () => { api.uninstall(); await cleanWhatsAppDatabase(); await db.$disconnect(); });

  it("rolls back a listing draft that failed after creation but before its follow-up writes, then creates exactly one on retry", async () => {
    await registeredAgent(api);
    await walkListing(api, AGENT);
    const fired = failOnce("after_record", "listing_draft");
    const { contactId } = await ingest(AGENT, { choice: "ls:copy:ok" });
    await expect(processContact(contactId)).rejects.toThrow(InjectedFault);
    expect(fired()).toBe(true);
    // The record and its binding share a transaction: nothing of the failed attempt survives.
    expect(await db.listing.count()).toBe(0);
    expect(await db.whatsAppAction.count({ where: { kind: "listing_draft" } })).toBe(0);
    api.take();

    const replies = await retry(api, contactId);
    const listing = await db.listing.findFirstOrThrow();
    expect(await db.listing.count()).toBe(1);
    // Follow-ups committed with the record: source channel, event and binding.
    expect(listing.sourceChannel).toBe("WHATSAPP");
    expect(await db.whatsAppAssistantEvent.count({ where: { name: "listing_draft_created" } })).toBe(1);
    expect(await db.whatsAppAction.findFirstOrThrow({ where: { kind: "listing_draft" } })).toMatchObject({ resultId: listing.id });
    expect(allText(replies)).toContain(referenceFor("PR", listing.id));
  });

  it("rolls back a provider registration that failed after its follow-ups but before the action was bound, then completes it once", async () => {
    await walkProviderRegistration(api, "INDIVIDUAL");
    const fired = failOnce("after_follow_ups", "provider_registration");
    const { contactId } = await ingest(PROVIDER, { text: smsCode(PROVIDER) });
    await expect(processContact(contactId)).rejects.toThrow(InjectedFault);
    expect(fired()).toBe(true);
    expect(await db.serviceProvider.count()).toBe(0);
    expect(await db.providerMarketplaceProfile.count()).toBe(0);
    expect(await db.whatsAppAssistantEvent.count({ where: { name: "provider_registered" } })).toBe(0);
    api.take();

    // The retry re-processes the same message: the account is already linked, so the spent code
    // isn't asked for again, and the registration runs under the same action key.
    const replies = await retry(api, contactId);
    const provider = await db.serviceProvider.findFirstOrThrow({ include: { marketplaceProfile: true } });
    expect(await db.serviceProvider.count()).toBe(1);
    expect(provider.sourceChannel).toBe("WHATSAPP");
    expect(provider.marketplaceProfile).toMatchObject({ listed: false });
    expect(await db.whatsAppAssistantEvent.count({ where: { name: "provider_registered" } })).toBe(1);
    expect(await db.backgroundJob.count({ where: { idempotencyKey: { contains: "ONBOARDING_COMPLETE_SERVICES" } } })).toBe(1);
    expect(allText(replies)).toContain(referenceFor("SV", provider.id));
  });

  it("returns the original registration when the commit succeeded but its acknowledgement was lost", async () => {
    await walkAgentRegistration(api, AGENT, "Kwame Mensah");
    // The business transaction commits, then the attempt sees an error (e.g. the connection dropped
    // while acknowledging). The outcome is not assumed: the binding proves it committed.
    const fired = failOnce("after_commit", "business_registration");
    const replies = await answerSmsCode(api, AGENT);
    expect(fired()).toBe(true);
    const professional = await db.marketplaceProfessional.findFirstOrThrow();
    expect(await db.marketplaceProfessional.count()).toBe(1);
    expect(professional).toMatchObject({ verificationStatus: "PENDING", sourceChannel: "WHATSAPP" });
    expect(allText(replies)).toContain(referenceFor("AG", professional.id));
    expect(await db.whatsAppInboundMessage.count({ where: { status: "PROCESSED" } })).toBe(await db.whatsAppInboundMessage.count());
  });

  it("returns the original registration, with all its follow-ups, when the worker died after the commit", async () => {
    const agency = await publishedListing();
    await walkAgentRegistration(api, AGENT, "Kwame Mensah", agency.professional.displayName);
    const { contactId, firstReplies } = await processThenLoseAck(api, AGENT, { text: smsCode(AGENT) });
    const original = await db.marketplaceProfessional.findFirstOrThrow({ where: { sourceChannel: "WHATSAPP" } });
    expect(allText(firstReplies)).toContain(referenceFor("AG", original.id));

    const replies = await retry(api, contactId);
    expect(allText(replies)).toContain(referenceFor("AG", original.id));
    expect(allText(replies)).not.toContain("code");
    expect(await db.marketplaceProfessional.count({ where: { sourceChannel: "WHATSAPP" } })).toBe(1);
    expect(await db.organisation.count({ where: { id: original.backingOrganisationId } })).toBe(1);
    // Intended follow-ups exist exactly once.
    expect(await db.marketplaceProfessionalVerificationEvent.count({ where: { marketplaceProfessionalId: original.id } })).toBe(1);
    expect(await db.whatsAppSupportRequest.count({ where: { topic: "agent_affiliation" } })).toBe(1);
    expect(await db.backgroundJob.count({ where: { idempotencyKey: `wa-notify:affiliation_claim:${original.id}` } })).toBe(1);
    expect(await db.whatsAppAssistantEvent.count({ where: { name: "business_registered" } })).toBe(1);
  });

  it("reuses a company provider's organisation when the provider step failed after the organisation committed", async () => {
    await walkProviderRegistration(api, "COMPANY");
    failOnce("after_record", "provider_registration");
    const { contactId } = await ingest(PROVIDER, { text: smsCode(PROVIDER) });
    await expect(processContact(contactId)).rejects.toThrow(InjectedFault);
    const organisations = await db.organisation.findMany({ where: { name: "Kojo Plumbing Works" } });
    expect(organisations).toHaveLength(1);
    expect(await db.serviceProvider.count()).toBe(0);
    api.take();

    await retry(api, contactId);
    const provider = await db.serviceProvider.findFirstOrThrow();
    expect(await db.organisation.count({ where: { name: "Kojo Plumbing Works" } })).toBe(1);
    expect(provider.companyOrganisationId).toBe(organisations[0].id);
  });

  it("stores one photo per message even when the message is processed again after the upload committed", async () => {
    await registeredAgent(api);
    await walkListing(api, AGENT);
    await converse(api, AGENT, { choice: "ls:copy:ok" });
    api.media.set("photo-1", { bytes: PNG, mimeType: "image/png" });
    const { contactId } = await processThenLoseAck(api, AGENT, { image: { id: "photo-1" } });
    expect(allText(await retry(api, contactId))).toContain("Main photo saved");
    const listing = await db.listing.findFirstOrThrow({ include: { media: true } });
    expect(listing.media).toHaveLength(1);
    expect(await db.storageObject.count({ where: { targetType: "LISTING_MEDIA" } })).toBe(1);
    expect(await db.whatsAppAssistantEvent.count({ where: { name: "listing_photo_saved" } })).toBe(1);
  });

  it("returns the original property inquiry, with one owner email, when the worker died after the lead committed", async () => {
    const { listing } = await publishedListing();
    await converse(api, CUSTOMER, { text: "apartment for rent in East Legon" });
    await converse(api, CUSTOMER, { text: "skip" });
    await converse(api, CUSTOMER, { choice: `ps:ask:${listing.id}` });
    await converse(api, CUSTOMER, { text: "Is it available?" });
    await converse(api, CUSTOMER, { choice: "pi:send" });
    const { contactId } = await processThenLoseAck(api, CUSTOMER, { text: "Kofi Boateng" });
    const lead = await db.marketplaceLead.findFirstOrThrow();

    const replies = await retry(api, contactId);
    expect(allText(replies)).toContain(referenceFor("IQ", lead.id));
    expect(await db.marketplaceLead.count()).toBe(1);
    expect(await db.backgroundJob.count({ where: { idempotencyKey: { contains: "MARKETPLACE_LEAD_CREATED" } } })).toBe(1);
    expect(await db.whatsAppAssistantEvent.count({ where: { name: "property_inquiry_created" } })).toBe(1);
  });

  it("opens one support request per message even when the worker died after creating it", async () => {
    await converse(api, CUSTOMER, { text: "support" });
    const { contactId } = await processThenLoseAck(api, CUSTOMER, { text: "I can't log in to my account" });
    const request = await db.whatsAppSupportRequest.findFirstOrThrow();
    expect(allText(await retry(api, contactId))).toContain(request.reference);
    expect(await db.whatsAppSupportRequest.count()).toBe(1);
    expect(await db.whatsAppAssistantEvent.count({ where: { name: "support_requested" } })).toBe(1);
  });

  it("lets only one of two competing attempts create the record; the other returns it", async () => {
    const { listing } = await publishedListing();
    const { contactId } = await ingest(CUSTOMER, { text: "Hi" });
    const attempt = () => runOnce("lead:competing", contactId, "lead", (bind) => createMarketplaceLead(listing.id, undefined, {
      name: "Kofi", phone: "+233247700002", source: "whatsapp", message: "Is it available?",
    }, { inTransaction: bind() }));
    const [first, second] = await Promise.all([attempt(), attempt()]);
    expect(first.resultId).toBe(second.resultId);
    expect([first.repeated, second.repeated].sort()).toEqual([false, true]);
    expect(await db.marketplaceLead.count()).toBe(1);
    expect(await db.whatsAppAction.findUniqueOrThrow({ where: { actionKey: "lead:competing" } })).toMatchObject({ resultId: first.resultId });
    // The loser's whole transaction rolled back, so the owner is emailed once.
    expect(await db.backgroundJob.count({ where: { idempotencyKey: { contains: "MARKETPLACE_LEAD_CREATED" } } })).toBe(1);
  });

  it("rolls back a stale worker that resumes after a newer attempt committed, without touching the bound result", async () => {
    const { listing } = await publishedListing();
    const { contactId } = await ingest(CUSTOMER, { text: "Hi" });
    let release!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    let reachedPause!: () => void;
    const atPause = new Promise<void>((resolve) => { reachedPause = resolve; });
    let calls = 0;
    // The first attempt stalls inside its transaction, after creating its lead.
    setActionFaultInjector(async (stage) => {
      if (stage !== "after_record") return;
      calls += 1;
      if (calls === 1) {
        reachedPause();
        await paused;
      }
    });
    const create = () => runOnce("lead:stale", contactId, "lead", (bind) => createMarketplaceLead(listing.id, undefined, {
      name: "Kofi", phone: "+233247700002", source: "whatsapp",
    }, { inTransaction: bind() }));
    const stale = create();
    await atPause;
    const fresh = await create(); // the replacement attempt runs to completion meanwhile
    expect(fresh.repeated).toBe(false);
    release();
    const resumed = await stale;
    expect(resumed).toEqual({ resultId: fresh.resultId, repeated: true });
    expect(await db.marketplaceLead.count()).toBe(1);
    expect((await db.marketplaceLead.findFirstOrThrow()).id).toBe(fresh.resultId);
    expect(await db.whatsAppAction.findUniqueOrThrow({ where: { actionKey: "lead:stale" } })).toMatchObject({ resultId: fresh.resultId });
  });

  it("keeps two legitimate listings with identical titles distinct, and a retry returns its own", async () => {
    await registeredAgent(api);
    await walkListing(api, AGENT);
    await converse(api, AGENT, { choice: "ls:copy:ok" });
    await converse(api, AGENT, { text: "menu" });
    await walkListing(api, AGENT);
    const { contactId } = await processThenLoseAck(api, AGENT, { choice: "ls:copy:ok" });
    const listings = await db.listing.findMany({ orderBy: { createdAt: "asc" } });
    expect(listings).toHaveLength(2);
    expect(listings[0].title).toBe(listings[1].title);

    const replies = await retry(api, contactId);
    expect(await db.listing.count()).toBe(2);
    expect(allText(replies)).toContain(referenceFor("PR", listings[1].id));
    expect(allText(replies)).not.toContain(referenceFor("PR", listings[0].id));
  });

  it("keeps two identical service requests to the same provider distinct, and a retry returns its own", async () => {
    const owner = await db.user.create({ data: { displayName: "Plumber Owner", email: `plumber-${Date.now()}@example.com` } });
    const plumbing = await db.serviceCategory.findUniqueOrThrow({ where: { key: "plumbing" } });
    const provider = await db.serviceProvider.create({
      data: {
        type: "INDIVIDUAL", individualUserId: owner.id, administratorUserId: owner.id, displayName: "Reliable Pipes", slug: `reliable-pipes-${Date.now()}`,
        contactPhone: "+233200000001", contactReady: true, verificationStatus: "VERIFIED", availabilityStatus: "AVAILABLE", acceptingWork: true, identityVerifiedAt: new Date(),
        categories: { create: [{ categoryId: plumbing.id }] },
        marketplaceProfile: { create: { listed: true, publicDescription: "Leak repairs.", categories: { create: [{ categoryId: plumbing.id }] }, serviceAreas: { create: [{ countryCode: "GH", region: "Greater Accra", city: "Accra" }] } } },
      },
    });
    const request = async () => {
      await converse(api, CUSTOMER, { text: "I need a plumber" });
      await converse(api, CUSTOMER, { text: "Spintex, Accra" });
      await converse(api, CUSTOMER, { text: "My bathroom pipe is leaking" });
      await converse(api, CUSTOMER, { choice: `ss:quote:${provider.id}` });
    };
    await request();
    await converse(api, CUSTOMER, { choice: "sq:send" });
    await converse(api, CUSTOMER, { text: "Efua Asante" });
    await answerSmsCode(api, CUSTOMER);
    await request();
    const { contactId } = await processThenLoseAck(api, CUSTOMER, { choice: "sq:send" });
    const enquiries = await db.marketplaceEnquiry.findMany({ orderBy: { createdAt: "asc" } });
    expect(enquiries).toHaveLength(2);
    expect(enquiries[0].message).toBe(enquiries[1].message);

    const replies = await retry(api, contactId);
    expect(await db.marketplaceEnquiry.count()).toBe(2);
    expect(allText(replies)).toContain(referenceFor("QT", enquiries[1].id));
    // One provider notification job per request, never a second for the retried one.
    expect(await db.backgroundJob.count({ where: { idempotencyKey: { startsWith: "wa-notify:provider_enquiry:" } } })).toBe(2);
    expect(await db.whatsAppAssistantEvent.count({ where: { name: "service_quote_requested" } })).toBe(2);
  });
});
