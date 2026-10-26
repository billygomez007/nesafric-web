import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as officialPost } from "@/app/api/webhooks/whatsapp/route";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createListing, transitionListing, updateListingVerification } from "@/modules/listings/service";
import { defaultChannelAdapters, type ChannelAdapters } from "@/modules/conversations/channels/registry";
import type { OutboundMessageRequest } from "@/modules/conversations/channels/types";
import { linkWhatsAppIdentity } from "@/modules/whatsapp-assistant/identity";
import { scheduleViewingReminders, viewingReference, WHATSAPP_NEGOTIATION_NOTE } from "@/modules/whatsapp-assistant/viewings";
import { templateContentHash } from "@/modules/whatsapp-templates/format";
import { metaTemplateName, utilityTemplate } from "@/modules/whatsapp-templates/registry";
import { dispatchUtilityEvents } from "@/modules/whatsapp-templates/dispatch";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";
import { db } from "@/platform/database/client";
import { connectWhatsAppChannel } from "./helpers/whatsapp-channel";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });

const SECRET = "test-app-secret";
const PHONE_NUMBER_ID = "100200300";
const WABA = "555";
const SEEKER = "233241110001";
const AGENT = "233241110002";
const STRANGER = "233241110009";

let counter = 0;
const sent: OutboundMessageRequest[] = [];
const adapters: ChannelAdapters = {
  ...defaultChannelAdapters,
  WHATSAPP: { ...defaultChannelAdapters.WHATSAPP, channel: "WHATSAPP", normalizeInbound: () => [], verifyWebhookSignature: () => ({ verified: false }), send: async (request) => { sent.push(request); return { status: "SENT", providerReference: `wamid.out.${++counter}` }; } },
};
const work = async () => { for (let pass = 0; pass < 3; pass += 1) await runDueJobs(createJobHandlers(undefined, adapters)); };
const to = (phone: string) => sent.filter((request) => request.recipientAddress === phone);

async function clean() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge", "WhatsAppTemplateState", "WhatsAppUtilityDispatch" CASCADE');
}

async function say(from: string, body: string, name = "Kwame Mensah") {
  const before = sent.length;
  const payload = { object: "whatsapp_business_account", entry: [{ id: WABA, changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, contacts: [{ wa_id: from, profile: { name } }], messages: [{ from, id: `wamid.in.${++counter}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }] } }] }] };
  const raw = JSON.stringify(payload);
  const response = await officialPost(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}` }, body: raw }));
  expect(response.status).toBe(200);
  await work();
  return sent.slice(before).filter((request) => request.recipientAddress === from);
}

async function approve(...keys: string[]) {
  for (const key of keys) {
    const template = utilityTemplate(key);
    const data = { status: "APPROVED", metaCategory: "UTILITY", contentHash: templateContentHash(template), metaTemplateId: `meta-${key}` };
    await db.whatsAppTemplateState.create({ data: { templateKey: key, wabaId: WABA, metaName: metaTemplateName(template), language: "en", version: 1, ...data } });
  }
}

async function setup() {
  const staff = await registerUser({ displayName: "NesAfric Support", email: "support@viewing.test", password: "secure-password-123" });
  const official = await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
  vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.id);
  await connectWhatsAppChannel(staff.id, official.id, { enabled: true, config: { phoneNumberId: PHONE_NUMBER_ID, businessAccountId: WABA, marketplaceAssistantEnabled: true } });
  const owner = await registerUser({ displayName: "Abena Agyei", email: "abena@viewing.test", password: "secure-password-123" });
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
  // The lister's number is linked to their account (the OTP link already exists on WhatsApp).
  await linkWhatsAppIdentity(AGENT, owner.id, "SMS_OTP", official.id);
  await approve("U02", "U03", "U04", "U05", "U06", "U31");
  return { owner, organisation, listing };
}

/** The seeker books a viewing of the listing in the chat, for tomorrow at 14:00 Ghana time. */
async function requestViewing(listingId: string) {
  await say(SEEKER, `view ${listingId}`);
  await say(SEEKER, "Kwame Mensah");
  await say(SEEKER, "tomorrow 2pm");
  const confirmed = await say(SEEKER, "confirm");
  const viewing = await db.viewingRequest.findFirstOrThrow({ where: { listingId }, include: { proposals: true } });
  return { viewing, reference: viewingReference(viewing.id), confirmed };
}

describe("PostgreSQL WhatsApp viewing negotiation", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    vi.stubEnv("WHATSAPP_TEMPLATE_WABA_ID", WABA);
    vi.stubEnv("WHATSAPP_UTILITY_EVENTS_SINCE", new Date(Date.now() - 60 * 60_000).toISOString());
    sent.length = 0;
    await clean();
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => { await clean(); await db.$disconnect(); });

  it("asks the listing team, lets them propose another time, and confirms only when the customer accepts", async () => {
    const { listing } = await setup();
    const { viewing, reference, confirmed } = await requestViewing(listing.id);
    expect(confirmed.at(-1)?.body).toContain("✅ *Viewing request received*");
    expect(confirmed.at(-1)?.body).toContain(`🔖 Reference: ${reference}`);
    expect(confirmed.at(-1)?.body).toContain("We will notify you here on WhatsApp as soon as they reply.");
    expect(viewing.status).toBe("REQUESTED");
    expect(viewing.proposals).toEqual([expect.objectContaining({ proposedBy: "CUSTOMER", status: "OPEN" })]);
    // The lister has no open conversation: the approved alert template goes out.
    expect(to(AGENT)).toEqual([expect.objectContaining({ whatsappTemplate: expect.objectContaining({ name: "nesafric_inquiry_agent_alert" }) })]);
    expect(to(AGENT)[0].whatsappTemplate?.bodyParameters).toEqual(["Abena", "3-bedroom house in Spintex", reference]);

    // The lister answers (opening the window) with another time; the customer gets buttons.
    const proposed = await say(AGENT, `propose ${reference} tomorrow 4pm`, "Abena Agyei");
    expect(proposed.at(-1)?.body).toContain(`You proposed`);
    const offer = to(SEEKER).at(-1)!;
    expect(offer.body).toContain(`another time for your viewing ${reference}`);
    expect(offer.whatsappInteractive).toMatchObject({ type: "button", buttons: [{ id: `accept ${reference.toLowerCase()}` }, { id: `propose ${reference.toLowerCase()}` }, { id: `cancel ${reference.toLowerCase()}` }] });
    expect((await db.viewingRequest.findUniqueOrThrow({ where: { id: viewing.id } })).status).toBe("REQUESTED");

    // Only the customer can accept the lister's proposal; a stranger finds nothing.
    expect((await say(STRANGER, `accept ${reference.toLowerCase()}`)).at(-1)?.body).toContain(`could not find viewing ${reference}`);
    expect((await say(AGENT, `accept ${reference.toLowerCase()}`, "Abena Agyei")).at(-1)?.body).toContain("waiting for the customer");

    const accepted = await say(SEEKER, `accept ${reference.toLowerCase()}`);
    expect(accepted.at(-1)?.body).toContain(`Confirmed: viewing ${reference}`);
    const booked = await db.viewingRequest.findUniqueOrThrow({ where: { id: viewing.id }, include: { proposals: { orderBy: { createdAt: "asc" } }, history: { orderBy: { createdAt: "asc" } } } });
    expect(booked.status).toBe("CONFIRMED");
    expect(booked.proposals.map(({ proposedBy, status }) => `${proposedBy}:${status}`)).toEqual(["CUSTOMER:SUPERSEDED", "LISTING_TEAM:ACCEPTED"]);
    expect(booked.confirmedStartsAt?.toISOString()).toBe(booked.proposals[1].startsAt.toISOString());
    expect(booked.history.at(-1)).toMatchObject({ fromStatus: "REQUESTED", toStatus: "CONFIRMED", note: WHATSAPP_NEGOTIATION_NOTE });
    expect(to(AGENT).at(-1)?.body).toContain(`is confirmed for`);

    // The template dispatcher does not repeat what the chat already said.
    sent.length = 0;
    await dispatchUtilityEvents();
    await work();
    expect(sent.filter((request) => request.whatsappTemplate?.name === "nesafric_viewing_confirmed")).toEqual([]);
    expect((await db.whatsAppUtilityDispatch.findFirst({ where: { templateKey: "U02" } }))?.reason).toMatch(/WhatsApp viewing negotiation/);

    // Accepting again changes nothing.
    expect((await say(SEEKER, `accept ${reference.toLowerCase()}`)).at(-1)?.body).toContain("no proposed time waiting");
  });

  it("reminds both sides 2 hours and 1 hour before, once each, and never for a moved time", async () => {
    const { listing } = await setup();
    const { viewing, reference } = await requestViewing(listing.id);
    await say(AGENT, `accept ${reference.toLowerCase()}`, "Abena Agyei");
    const booked = await db.viewingRequest.findUniqueOrThrow({ where: { id: viewing.id } });
    expect(booked.status).toBe("CONFIRMED");
    const startsAt = booked.confirmedStartsAt!;
    sent.length = 0;

    expect(await scheduleViewingReminders(new Date(startsAt.getTime() - 3 * 60 * 60_000))).toEqual({ queued: 0 });
    expect(await scheduleViewingReminders(new Date(startsAt.getTime() - 119 * 60_000))).toEqual({ queued: 1 });
    expect(await scheduleViewingReminders(new Date(startsAt.getTime() - 110 * 60_000))).toEqual({ queued: 0 });
    await work();
    expect(to(SEEKER).map(({ body }) => body)).toEqual([expect.stringContaining(`Reminder: your viewing ${reference}`)]);
    expect(to(AGENT).map(({ body }) => body)).toEqual([expect.stringContaining(`Reminder: viewing ${reference}`)]);
    expect(to(SEEKER)[0].body).toContain("in 2 hours");

    // The time moves before the 1-hour reminder runs: the queued reminder is dropped.
    expect(await scheduleViewingReminders(new Date(startsAt.getTime() - 59 * 60_000))).toEqual({ queued: 1 });
    await db.viewingRequest.update({ where: { id: viewing.id }, data: { confirmedStartsAt: new Date(startsAt.getTime() + 24 * 60 * 60_000), confirmedEndsAt: new Date(startsAt.getTime() + 25 * 60 * 60_000) } });
    sent.length = 0;
    await work();
    expect(sent).toEqual([]);
  });

  it("asks the customer afterwards whether the viewing took place, records the answer once, and leaves completion to the team", async () => {
    const { listing } = await setup();
    const { viewing, reference } = await requestViewing(listing.id);
    await say(AGENT, `accept ${reference.toLowerCase()}`, "Abena Agyei");
    const startsAt = (await db.viewingRequest.findUniqueOrThrow({ where: { id: viewing.id } })).confirmedStartsAt!;
    // Make the agreed time two hours ago (the end moves with it).
    const past = new Date(Date.now() - 2 * 60 * 60_000 - 60_000);
    await db.viewingRequest.update({ where: { id: viewing.id }, data: { confirmedStartsAt: past, confirmedEndsAt: new Date(past.getTime() + 60 * 60_000) } });
    expect(startsAt.getTime()).toBeGreaterThan(past.getTime());
    sent.length = 0;
    expect(await scheduleViewingReminders()).toEqual({ queued: 1 });
    await work();
    const question = to(SEEKER).at(-1)!;
    expect(question.body).toContain(`Did your viewing ${reference}`);
    expect(question.whatsappInteractive).toMatchObject({ buttons: [{ id: `viewed ${reference.toLowerCase()} yes` }, { id: `viewed ${reference.toLowerCase()} no` }] });

    expect((await say(SEEKER, `viewed ${reference.toLowerCase()} yes`)).at(-1)?.body).toContain("I've let the listing team know");
    await say(SEEKER, `viewed ${reference.toLowerCase()} yes`);
    expect(await db.marketplaceLeadActivity.count({ where: { leadId: viewing.leadId, type: "lead.viewing_feedback" } })).toBe(1);
    expect(to(AGENT).at(-1)?.body).toContain("took place. Please record the outcome");
    expect((await db.viewingRequest.findUniqueOrThrow({ where: { id: viewing.id } })).status).toBe("CONFIRMED");
  });

  it("lets the customer cancel and tells the listing team; a lister's decline cancels too", async () => {
    const { listing } = await setup();
    const { viewing, reference } = await requestViewing(listing.id);
    await say(AGENT, `propose ${reference} tomorrow 5pm`, "Abena Agyei");
    const cancelled = await say(SEEKER, `cancel ${reference.toLowerCase()}`);
    expect(cancelled.at(-1)?.body).toContain(`Viewing ${reference} is cancelled`);
    expect(to(AGENT).at(-1)?.body).toContain(`cancelled viewing ${reference}`);
    const ended = await db.viewingRequest.findUniqueOrThrow({ where: { id: viewing.id }, include: { proposals: true } });
    expect(ended.status).toBe("CANCELLED");
    expect(ended.proposals.every(({ status }) => status !== "OPEN")).toBe(true);
    expect((await say(AGENT, `accept ${reference.toLowerCase()}`, "Abena Agyei")).at(-1)?.body).toContain("is cancelled; nothing was changed");
  });

  it("does not let a job command steal a viewing reference", async () => {
    const { listing } = await setup();
    const { reference } = await requestViewing(listing.id);
    const reply = await say(AGENT, `decline ${reference.toLowerCase()} fully booked`, "Abena Agyei");
    expect(reply.at(-1)?.body).toContain(`Viewing ${reference} is cancelled`);
    expect(to(SEEKER).at(-1)?.body).toContain("Reason given: fully booked");
  });
});
