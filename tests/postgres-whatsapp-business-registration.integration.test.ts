import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeImage } from "./helpers/images";

const downloads = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/modules/whatsapp-assistant/maintenance/media", async () => ({
  downloadWhatsAppMedia: async (id: string) => {
    downloads.calls.push(id);
    return id.startsWith("9") ? null : { body: await makeImage({ colour: `#${id.slice(-6).padStart(6, "4")}`, width: 300, height: 300, format: "png" }), contentType: "image/png" };
  },
}));

import { POST as officialPost } from "@/app/api/webhooks/whatsapp/route";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { reviewMarketplaceVerification } from "@/modules/marketplace-professionals/service";
import { linkWhatsAppIdentity } from "@/modules/whatsapp-assistant/identity";
import { notifyOnWhatsApp } from "@/modules/whatsapp-assistant/notify";
import { defaultChannelAdapters, type ChannelAdapters } from "@/modules/conversations/channels/registry";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";
import { db } from "@/platform/database/client";
import { connectWhatsAppChannel, createPlatformAdmin } from "./helpers/whatsapp-channel";
import { mediaId, whatsappConversation } from "./helpers/whatsapp-business";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

const PHONE = "233241234567";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge", "WhatsAppFlowDraft" CASCADE');
  await db.$executeRawUnsafe('TRUNCATE TABLE "ServiceProvider" CASCADE');
}

async function linkedUser(email = "abena@example.com") {
  const user = await registerUser({ displayName: "Abena Boateng", email, password: "secure-password-123" });
  const organisation = await createOrganisation(user.id, { name: "Abena personal", type: "OTHER", countryCode: "GH" });
  await linkWhatsAppIdentity(PHONE, user.id, "SMS_OTP", organisation.id);
  return { user, chat: whatsappConversation(PHONE, organisation.id) };
}

const ownedProfessionals = (userId: string) => db.marketplaceProfessional.findMany({ where: { members: { some: { userId } } } });

const CERTIFICATE = mediaId(50);

/** Answers an agency registration (with its certificate) up to (not including) the logo. */
async function agencyAnswers(chat: ReturnType<typeof whatsappConversation>) {
  await chat.say("register agency", "1", "Accra Prime Realty", "skip", "info@accraprime.example", "1", "Osu");
  await chat.say("We sell and let homes across central Accra, mostly apartments and townhouses.", "Osu, Labone, Cantonments");
  const certificate = await chat.send("Registrar-General BN-552211");
  expect(certificate.reply).toContain("registration certificate");
  return chat.send({ image: CERTIFICATE });
}

describe("PostgreSQL WhatsApp business registration", () => {
  beforeEach(async () => { downloads.calls.length = 0; await cleanDatabase(); });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => { await cleanDatabase(); await db.$disconnect(); });

  it("creates the account in the chat when none exists, then starts the chosen registration; nothing is registered before that", async () => {
    const owner = await registerUser({ displayName: "Owner", email: "owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
    const chat = whatsappConversation(PHONE, organisation.id);
    const asked = await chat.send("register agency");
    expect(asked.reply).toContain("I'll create your free NesAfric account right here");
    expect(asked.reply).not.toMatch(/https?:\/\//);
    expect(await db.whatsAppFlowDraft.count()).toBe(0);
    expect(await db.user.count({ where: { phoneE164: `+${PHONE}` } })).toBe(0);

    const started = await chat.send("Ama Owusu");
    expect(started.reply).toContain("✅ Your NesAfric account is ready, Ama.");
    expect(started.reply).toContain("What kind of business is it?");
    const user = await db.user.findFirstOrThrow({ where: { phoneE164: `+${PHONE}` } });
    expect(user).toMatchObject({ displayName: "Ama Owusu", phoneVerifiedAt: expect.any(Date), passwordHash: null });
    expect(await db.channelIdentity.findFirstOrThrow({ where: { address: `+${PHONE}` } })).toMatchObject({ userId: user.id, verificationMethod: "WHATSAPP_REPLY" });
    expect(await db.auditEvent.count({ where: { action: "account.created_on_whatsapp", entityId: user.id } })).toBe(1);
    expect(chat.state.workflow).toBe("business");
    expect(await db.marketplaceProfessional.count()).toBe(0);
  });

  it("asks a new person to register as an agent or a business before listing, with buttons, and lists nothing", async () => {
    const owner = await registerUser({ displayName: "Owner", email: "owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
    const chat = whatsappConversation(PHONE, organisation.id);
    await chat.send("list a property");
    const choice = await chat.send("Kwesi Boateng");
    expect(choice.reply).toContain("✅ Your NesAfric account is ready, Kwesi.");
    expect(choice.reply).toContain("Before you list a property, register with NesAfric as one of these");
    expect(choice.reply).toContain("upload the front and back of your Ghana Card");
    expect(choice.reply).toContain("upload your business registration certificate");
    expect(choice.interactive).toMatchObject({ type: "button", buttons: [{ id: "register agent", title: "Individual agent" }, { id: "register agency", title: "Real estate business" }] });
    expect(await db.whatsAppFlowDraft.count({ where: { kind: "PROPERTY_LISTING" } })).toBe(0);
    expect(await db.listing.count()).toBe(0);
    // Tapping a button starts that registration.
    expect((await chat.send("register agency")).reply).toContain("What kind of business is it?");
  });

  it("never takes over an existing account: a number already in use must link with a code", async () => {
    const owner = await registerUser({ displayName: "Owner", email: "owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
    await db.user.update({ where: { id: owner.id }, data: { phoneE164: `+${PHONE}`, phoneVerifiedAt: new Date() } });
    const chat = whatsappConversation(PHONE, organisation.id);
    await chat.send("list a property");
    const refused = await chat.send("Somebody Else");
    expect(refused.reply).toContain("already belongs to a NesAfric account. Reply link");
    expect(await db.channelIdentity.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db.user.count()).toBe(1);
  });

  it("registers an agency one question at a time, with a replaceable logo, and submits it for Super Admin review", async () => {
    const { user, chat } = await linkedUser();
    expect((await chat.send("register agency")).reply).toContain("What kind of business is it?");
    chat.reset();
    await db.whatsAppFlowDraft.deleteMany();
    const atLogo = await agencyAnswers(chat);
    expect(atLogo.reply).toContain("Send your logo as an image");
    const review = await chat.send({ image: mediaId(1) });
    expect(review.reply).toContain("Logo received.");
    expect(review.reply).toContain("Please check your registration:");
    expect(review.reply).toContain("Name: Accra Prime Realty");
    // Replace the logo before submitting: edit → logo → new image → back to review.
    expect((await chat.send("edit")).reply).toContain("Which answer do you want to change?");
    const logoNumber = (await chat.send("edit")).reply.split("\n").find((line) => line.endsWith("Logo"))!.split(".")[0];
    await chat.send(logoNumber);
    expect((await chat.send({ image: mediaId(2) })).reply).toContain("Please check your registration:");
    const submitted = await chat.send("confirm");
    expect(submitted.reply).toContain("✅ Accra Prime Realty is submitted for review.");
    expect(submitted.reply).not.toMatch(/https?:\/\//);
    expect(submitted.interactive).toMatchObject({ type: "button", buttons: [{ id: "list a property" }, { id: "my applications" }] });
    expect(submitted.reply).toContain("Your logo is saved.");
    expect(downloads.calls).toEqual([mediaId(2), CERTIFICATE]);

    const [professional] = await ownedProfessionals(user.id);
    expect([professional.displayName, professional.type, professional.verificationStatus, professional.contactEmail, professional.contactPhone]).toEqual(["Accra Prime Realty", "REAL_ESTATE_COMPANY", "PENDING", "info@accraprime.example", `+${PHONE}`]);
    expect(professional.verificationEvidenceReferences.join(" ")).toContain("BN-552211");
    expect(professional.logoUrl).toBeTruthy();
    const documents = await db.marketplaceProfessionalDocument.findMany({ where: { marketplaceProfessionalId: professional.id }, include: { storageObject: true } });
    expect(documents.map((document) => [document.type, document.sourceMediaId, document.storageObject.classification])).toEqual([["BUSINESS_REGISTRATION_CERTIFICATE", `whatsapp:${CERTIFICATE}`, "PRIVATE"]]);
    const draft = await db.whatsAppFlowDraft.findFirstOrThrow();
    expect([draft.status, draft.marketplaceProfessionalId]).toEqual(["SUBMITTED", professional.id]);
    expect((await chat.send("my applications")).reply).toContain("Accra Prime Realty: submitted for review");
  });

  it("starts registration from the menu even in the middle of a search (found in the live test)", async () => {
    const { chat } = await linkedUser();
    await chat.say("7", "Cleaning");
    expect((await chat.send("Dzorwulu")).reply).toContain("No verified providers");
    expect((await chat.send("register agency")).reply).toContain("What kind of business is it?");
    expect(chat.state.workflow).toBe("business");
  });

  it("offers WhatsApp registration, not only the website, when someone asks in their own words", async () => {
    const { chat } = await linkedUser();
    const reply = await chat.send("I want to register my business");
    expect(reply.reply).toContain("register agency");
    expect(reply.reply).not.toContain("Continue securely in your NesAfric account");
    expect(reply.interactive?.type === "button" && reply.interactive.buttons.map((button) => button.id)).toEqual(["register agency", "register services", "list a property"]);
  });

  it("supports back, help, pause and resume, and cancel only after confirmation", async () => {
    const { chat } = await linkedUser();
    await chat.say("register agent", "Kofi Mensah Realty");
    expect((await chat.send("back")).reply).toContain("What name should clients see");
    expect((await chat.send("help")).reply).toContain("reply back to change the previous answer");
    await chat.send("Kofi Mensah Realty");
    expect((await chat.send("pause")).reply).toContain("Reply resume to continue");
    expect(chat.state.workflow).toBe("idle");
    expect((await chat.send("resume")).reply).toContain("What email address");
    expect((await chat.send("cancel")).reply).toContain("Discard this registration?");
    expect((await chat.send("no")).reply).toContain("Okay, keeping your draft.");
    await chat.send("cancel");
    expect((await chat.send("yes")).reply).toContain("draft is discarded");
    expect(await db.whatsAppFlowDraft.findFirstOrThrow()).toMatchObject({ status: "CANCELLED" });
    expect(await db.marketplaceProfessional.count()).toBe(0);
  });

  it("refuses a stale or repeated confirmation, and never creates a second business", async () => {
    const { user, chat } = await linkedUser();
    await agencyAnswers(chat);
    const review = await chat.send("skip");
    const reviewedRevision = (await db.whatsAppFlowDraft.findFirstOrThrow()).revision;
    expect(review.interactive?.type === "button" && review.interactive.buttons[0].id).toBe(`confirm ${reviewedRevision}`);
    // Change an answer after the review, then press the old Confirm button.
    await chat.send("edit 2");
    await chat.send("Accra Prime Realty Ltd");
    const stale = await chat.send(`confirm ${reviewedRevision}`);
    expect(stale.reply).toContain("changed after you reviewed it");
    expect(await ownedProfessionals(user.id)).toHaveLength(0);
    // The current review, confirmed twice with the same message (a redelivery): one business.
    await chat.send("confirm", "wamid.confirm-1");
    await chat.send("confirm", "wamid.confirm-1");
    expect(await ownedProfessionals(user.id)).toHaveLength(1);
    // A second registration is refused.
    chat.reset();
    expect((await chat.send("register agent")).reply).toContain("already manages Accra Prime Realty Ltd");
    expect(await db.whatsAppFlowDraft.count({ where: { status: "OPEN" } })).toBe(0);
  });

  it("registers an individual agent with both sides of the Ghana Card, readable only by the owner and reviewers", async () => {
    const { user, chat } = await linkedUser();
    await chat.say("register agent", "Kofi Mensah Realty", "skip", "1", "East Legon");
    await chat.send("I help families rent and buy homes in East Legon and Airport Residential.");
    await chat.send("East Legon, Airport Residential");
    expect((await chat.send("skip")).reply).toContain("FRONT of your Ghana Card");
    expect((await chat.send("done")).reply).toContain("ghana card (front) as a photo");
    expect((await chat.send({ image: mediaId(61) })).reply).toContain("BACK of your Ghana Card");
    const atLogo = await chat.send({ image: mediaId(62) });
    expect(atLogo.reply).toContain("Send your logo as an image");
    const review = await chat.send("skip");
    expect(review.reply).toContain("Ghana Card (front): received");
    expect(review.reply).toContain("Ghana Card (back): received");
    const submitted = await chat.send("confirm");
    expect(submitted.reply).toContain("Kofi Mensah Realty is submitted for review");
    expect(submitted.reply).toContain("stored privately");

    const [professional] = await ownedProfessionals(user.id);
    expect([professional.type, professional.verificationStatus]).toEqual(["INDIVIDUAL_AGENT", "PENDING"]);
    const documents = await db.marketplaceProfessionalDocument.findMany({ where: { marketplaceProfessionalId: professional.id }, orderBy: { createdAt: "asc" } });
    expect(documents.map((document) => document.type)).toEqual(["GHANA_CARD_FRONT", "GHANA_CARD_BACK"]);

    const { getSignedStorageAccess } = await import("@/modules/documents/service");
    await expect(getSignedStorageAccess(user.id, null, documents[0].storageObjectId)).resolves.toMatchObject({ url: expect.any(String) });
    const stranger = await registerUser({ displayName: "Stranger", email: "stranger@example.com", password: "secure-password-123" });
    await expect(getSignedStorageAccess(stranger.id, null, documents[0].storageObjectId)).rejects.toMatchObject({ status: 403 });
    const admin = await createPlatformAdmin();
    await expect(getSignedStorageAccess(admin.userId, null, documents[1].storageObjectId)).resolves.toMatchObject({ url: expect.any(String) });
  });

  it("asks again for a document WhatsApp could not deliver, keeping the profile it created", async () => {
    const { user, chat } = await linkedUser();
    await chat.say("register agent", "Ama Agent", "skip", "1", "Osu");
    await chat.say("I rent apartments to young professionals in Osu and Labone.", "Osu, Labone", "skip");
    await chat.send({ image: "900001" });
    await chat.send({ image: mediaId(64) });
    await chat.send("skip");
    const failed = await chat.send("confirm");
    expect(failed.reply).toContain("could not save the front of your Ghana Card");
    expect(await ownedProfessionals(user.id)).toHaveLength(1);
    expect((await ownedProfessionals(user.id))[0].verificationStatus).toBe("UNVERIFIED");
    await chat.send({ image: mediaId(65) });
    expect((await chat.send("confirm")).reply).toContain("Ama Agent is submitted for review");
    const professionals = await ownedProfessionals(user.id);
    expect(professionals.map((item) => item.verificationStatus)).toEqual(["PENDING"]);
    expect(await db.marketplaceProfessionalDocument.count({ where: { marketplaceProfessionalId: professionals[0].id } })).toBe(2);
  });

  it("registers a service provider with categories, coverage and a verification reference", async () => {
    const { user, chat } = await linkedUser();
    await chat.say("register services", "1", "Kwame Plumbing Services", "skip", "1", "Tema", "Plumbing repairs, leak detection and bathroom fittings for homes.");
    const categories = await chat.send("1, 2");
    expect(categories.reply).toContain("Which towns or areas do you take jobs in?");
    await chat.say("Tema, Ashaiman", "1");
    await chat.send("BN-778899");
    const review = await chat.send("skip");
    expect(review.reply).toContain("Areas served: Tema, Ashaiman");
    expect((await chat.send("confirm")).reply).toContain("Kwame Plumbing Services is submitted for review");
    const provider = await db.serviceProvider.findFirstOrThrow({ where: { individualUserId: user.id }, include: { categories: true, serviceAreas: true, evidence: true } });
    expect([provider.verificationStatus, provider.contactReady, provider.categories.length, provider.serviceAreas.map((area) => area.name)]).toEqual(["PENDING", true, 2, ["Tema", "Ashaiman"]]);
    expect(provider.evidence.map((item) => [item.type, item.reference])).toEqual([["BUSINESS_REGISTRATION", "BN-778899"]]);
  });

  it("tells a linked applicant about the Super Admin decision on WhatsApp only through the approved template", async () => {
    const { user, chat } = await linkedUser();
    await agencyAnswers(chat);
    await chat.send("skip");
    await chat.send("confirm");
    const [professional] = await ownedProfessionals(user.id);
    // No official number: nothing is queued, and the reason says so.
    expect(await notifyOnWhatsApp([user.id], "test", "check-1")).toEqual([{ userId: user.id, queued: false, reason: expect.stringContaining("not configured") }]);
    const staff = await registerUser({ displayName: "NesAfric Support", email: "support@example.com", password: "secure-password-123" });
    const official = await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
    vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.id);
    await connectWhatsAppChannel(staff.id, official.id, { enabled: true, config: { phoneNumberId: "100200300", businessAccountId: "555", marketplaceAssistantEnabled: true } });
    // Official number but no approved template: still nothing queued (business-initiated needs one).
    expect(await notifyOnWhatsApp([user.id], "test", "check-2")).toEqual([{ userId: user.id, queued: false, reason: expect.stringMatching(/template/i) }]);
    vi.stubEnv("WHATSAPP_TEMPLATE_NOTIFICATION", "nesafric_notification:en");
    const admin = await createPlatformAdmin();
    await reviewMarketplaceVerification((await db.user.findUniqueOrThrow({ where: { id: admin.userId } })), professional.id, { status: "VERIFIED" });
    expect((await db.marketplaceProfessional.findUniqueOrThrow({ where: { id: professional.id } })).verificationStatus).toBe("VERIFIED");
    const queued = await db.message.findMany({ where: { externalMessageId: { startsWith: "decision:professional:" } }, include: { deliveries: true } });
    expect(queued).toHaveLength(1);
    expect(queued[0].body).toContain("Accra Prime Realty is approved");
    expect(queued[0].deliveries.map((delivery) => [delivery.recipientAddress, delivery.status])).toEqual([[PHONE, "QUEUED"]]);
  });

  it("keeps STOP working in the middle of a registration, without losing the draft", async () => {
    const SECRET = "test-app-secret";
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    const staff = await registerUser({ displayName: "NesAfric Support", email: "support@example.com", password: "secure-password-123" });
    const official = await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
    vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.id);
    await connectWhatsAppChannel(staff.id, official.id, { enabled: true, webhookVerifyToken: "verify-me", config: { phoneNumberId: "100200300", businessAccountId: "555", marketplaceAssistantEnabled: true } });
    const user = await registerUser({ displayName: "Abena Boateng", email: "abena@example.com", password: "secure-password-123" });
    await linkWhatsAppIdentity(PHONE, user.id, "SMS_OTP", official.id);
    const sent: string[] = [];
    const adapters: ChannelAdapters = { ...defaultChannelAdapters, WHATSAPP: { ...defaultChannelAdapters.WHATSAPP, channel: "WHATSAPP", send: async (request) => { sent.push(request.body); return { status: "SENT", providerReference: `wamid.out.${sent.length}` }; }, normalizeInbound: () => [], verifyWebhookSignature: () => ({ verified: false }) } };
    let n = 0;
    const deliver = async (body: string) => {
      const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "555", changes: [{ field: "messages", value: { metadata: { phone_number_id: "100200300" }, contacts: [{ wa_id: PHONE, profile: { name: "Abena" } }], messages: [{ id: `wamid.in.${++n}`, from: PHONE, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }] } }] }] });
      const response = await officialPost(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(payload).digest("hex")}` }, body: payload }));
      expect(response.status).toBe(200);
      await runDueJobs(createJobHandlers(undefined, adapters));
      await runDueJobs(createJobHandlers(undefined, adapters));
      return sent[sent.length - 1];
    };
    expect(await deliver("register agent")).toContain("What name should clients see");
    expect(await deliver("STOP")).toContain("unsubscribed");
    expect(await db.channelIdentity.findFirstOrThrow({ where: { address: `+${PHONE}` } })).toMatchObject({ optedOutAt: expect.any(Date) });
    expect(await db.whatsAppFlowDraft.findFirstOrThrow()).toMatchObject({ status: "OPEN", step: "name" });
    expect(await deliver("Kofi Mensah Realty")).toContain("What email address");
  });
});
