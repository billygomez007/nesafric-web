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

/** Answers an agency registration up to (not including) the logo. */
async function agencyAnswers(chat: ReturnType<typeof whatsappConversation>) {
  await chat.say("register agency", "1", "Accra Prime Realty", "skip", "info@accraprime.example", "1", "Osu");
  await chat.say("We sell and let homes across central Accra, mostly apartments and townhouses.", "Osu, Labone, Cantonments");
  return chat.send("Registrar-General BN-552211");
}

describe("PostgreSQL WhatsApp business registration", () => {
  beforeEach(async () => { downloads.calls.length = 0; await cleanDatabase(); });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => { await cleanDatabase(); await db.$disconnect(); });

  it("requires a linked account: a phone number alone registers nothing", async () => {
    const owner = await registerUser({ displayName: "Owner", email: "owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
    const chat = whatsappConversation(PHONE, organisation.id);
    const reply = await chat.send("register agency");
    expect(reply.reply).toContain("first connect this WhatsApp number to your NesAfric account: reply link");
    expect(await db.whatsAppFlowDraft.count()).toBe(0);
    expect(await db.marketplaceProfessional.count()).toBe(0);
  });

  it("registers an agency one question at a time, with a replaceable logo, and submits it for Super Admin review", async () => {
    const { user, chat } = await linkedUser();
    expect((await chat.send("3")).reply).toContain("What kind of business is it?");
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
    expect(submitted.reply).toContain("Accra Prime Realty is submitted for review. Status: submitted for review.");
    expect(submitted.reply).toContain("Your logo is saved.");
    expect(downloads.calls).toEqual([mediaId(2)]);

    const [professional] = await ownedProfessionals(user.id);
    expect([professional.displayName, professional.type, professional.verificationStatus, professional.contactEmail, professional.contactPhone]).toEqual(["Accra Prime Realty", "REAL_ESTATE_COMPANY", "PENDING", "info@accraprime.example", `+${PHONE}`]);
    expect(professional.verificationEvidenceReferences.join(" ")).toContain("BN-552211");
    expect(professional.logoUrl).toBeTruthy();
    const draft = await db.whatsAppFlowDraft.findFirstOrThrow();
    expect([draft.status, draft.marketplaceProfessionalId]).toEqual(["SUBMITTED", professional.id]);
    expect((await chat.send("my applications")).reply).toContain("Accra Prime Realty: submitted for review");
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
