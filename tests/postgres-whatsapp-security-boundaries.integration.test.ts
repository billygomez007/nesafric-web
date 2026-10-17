import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/modules/messaging/otp-provider", async () => (await import("./helpers/fake-sms-otp")).fakeSmsOtpModule);
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createMarketplaceProfessional } from "@/modules/marketplace-professionals/service";
import { createMarketplaceNativeListing, transitionMarketplaceProfessionalListing, getPublicListing } from "@/modules/listings/service";
import { aiClassifyIntent, setAssistantAIProvider } from "@/modules/whatsapp-assistant/ai";
import { downloadCloudApiMedia, mediaHostAllowed, MediaDownloadError, setWhatsAppTransport } from "@/modules/whatsapp-assistant/cloud-api";
import { whatsAppAssistantConfig } from "@/modules/whatsapp-assistant/config";
import { updateWhatsAppSupportRequest } from "@/modules/whatsapp-assistant/admin";
import { queueNotification } from "@/modules/whatsapp-assistant/store";
import { errorLabel } from "@/modules/whatsapp-assistant/log";
import { AppError } from "@/platform/errors";
import { GET as getLocalObject } from "@/app/api/storage/local/[...key]/route";
import type { AIProvider } from "@/modules/ai/providers";
import { allText, answerSmsCode, configureAssistantEnv, converse, FakeGraphApi, optionIds, PNG } from "./helpers/whatsapp-assistant";
import { fakeSms } from "./helpers/fake-sms-otp";
import { cleanWhatsAppDatabase, listingInReview, nativeListingInput, platformAdmin } from "./helpers/whatsapp-fixtures";

const PERSON = "233247777777";
const OTHER = "233248888888";

/** A website user who is a member of a marketplace business, with their WhatsApp already verified. */
async function linkedAgent(from: string, role: "OWNER" | "AGENT" = "OWNER") {
  const user = await registerUser({ displayName: "Linked Agent", email: `agent-${from}@example.com`, password: "secure-password-123" });
  const professional = await createMarketplaceProfessional(user.id, { type: "BROKERAGE", displayName: `Agency ${from.slice(-4)}`, countryCode: "GH" });
  if (role === "AGENT") await db.marketplaceProfessionalMember.updateMany({ where: { marketplaceProfessionalId: professional.id, userId: user.id }, data: { role: "AGENT" } });
  await db.whatsAppContact.upsert({ where: { waId: from }, update: { userId: user.id }, create: { waId: from, phoneE164: `+${from}`, userId: user.id, lastInboundAt: new Date() } });
  return { user, professional };
}

/** Answers the listing questions up to (not including) the copy confirmation. */
async function listingAnswers(api: FakeGraphApi, from: string) {
  for (const step of [
    { choice: "ls:type:RENT" }, { choice: "ls:cat:APARTMENT" }, { text: "Osu, Accra" }, { text: "2" }, { text: "2" }, { text: "skip" },
    { text: "5000" }, { choice: "MONTHLY" }, { choice: "ls:furn:FURNISHED" }, { text: "skip" }, { text: "now" },
    { choice: "ls:auth:MANAGING_AGENT" }, { text: "Signed mandate dated 1 Oct 2026" },
  ] as const) await converse(api, from, step as never);
  return converse(api, from, { text: "Bright two-bedroom flat with a balcony and secure parking." });
}

describe("WhatsApp assistant — security boundaries", () => {
  const api = new FakeGraphApi();
  beforeAll(() => { configureAssistantEnv(); api.install(); });
  beforeEach(async () => { await cleanWhatsAppDatabase(); api.take(); fakeSms.configured = true; fakeSms.codes.clear(); fakeSms.sent.length = 0; });
  afterEach(() => { setAssistantAIProvider(null); configureAssistantEnv(); api.install(); });
  afterAll(async () => { api.uninstall(); await cleanWhatsAppDatabase(); await db.$disconnect(); });

  describe("account linking requires proof of the number, not a phone match", () => {
    it("never links an existing account on a matching number until the SMS code is confirmed", async () => {
      const existing = await registerUser({ displayName: "Web User", email: "web-user@example.com", password: "secure-password-123" });
      await db.user.update({ where: { id: existing.id }, data: { phoneE164: `+${PERSON}`, phoneVerifiedAt: new Date() } });
      const status = await converse(api, PERSON, { text: "status" });
      expect(allText(status)).toContain("isn't linked to WhatsApp");
      expect((await db.whatsAppContact.findFirstOrThrow()).userId).toBeNull();

      expect(allText(await converse(api, PERSON, { text: "link account" }))).toContain("6-digit code");
      expect(allText(await converse(api, PERSON, { text: "000000" }))).toMatch(/incorrect|expired/i);
      expect((await db.whatsAppContact.findFirstOrThrow()).userId).toBeNull();

      const linked = await answerSmsCode(api, PERSON);
      expect(allText(linked)).toContain("linked to your NesAfric account (Web User)");
      expect((await db.whatsAppContact.findFirstOrThrow()).userId).toBe(existing.id);
      expect(await db.user.count()).toBe(1); // linked, not duplicated
    });

    it("refuses to link a NesAfric staff (platform principal) account", async () => {
      const { user } = await platformAdmin();
      await db.user.update({ where: { id: user.id }, data: { phoneE164: `+${PERSON}`, phoneVerifiedAt: new Date() } });
      await converse(api, PERSON, { text: "link account" });
      expect(allText(await answerSmsCode(api, PERSON))).toContain("staff account");
      expect((await db.whatsAppContact.findFirstOrThrow()).userId).toBeNull();
    });

    it("creates nothing when the SMS code can't be sent", async () => {
      fakeSms.configured = false;
      await converse(api, PERSON, { text: "register as an agent" });
      for (const step of [{ text: "Ama Agent" }, { choice: "br:phone:yes" }, { text: "skip" }, { text: "Osu" }, { text: "rentals" }, { text: "skip" }, { text: "skip" }] as const) await converse(api, PERSON, step as never);
      const refused = await converse(api, PERSON, { choice: "br:submit" });
      expect(allText(refused)).toMatch(/couldn't send a verification code/);
      expect(await db.user.count()).toBe(0);
      expect(await db.marketplaceProfessional.count()).toBe(0);
    });

    it("ties the account to the WhatsApp sender, never to a number typed in a message", async () => {
      await converse(api, PERSON, { text: "register as an agent" });
      await converse(api, PERSON, { text: "Ama Agent" });
      await converse(api, PERSON, { choice: "br:phone:other" });
      await converse(api, PERSON, { text: `0${OTHER.slice(3)}` }); // someone else's number as contact phone
      for (const step of [{ text: "skip" }, { text: "Osu" }, { text: "rentals" }, { text: "skip" }, { text: "skip" }] as const) await converse(api, PERSON, step as never);
      await converse(api, PERSON, { choice: "br:submit" });
      expect(fakeSms.sent).toEqual([`+${PERSON}`]); // the code goes to the sender only
      await answerSmsCode(api, PERSON);
      const user = await db.user.findFirstOrThrow();
      expect(user.phoneE164).toBe(`+${PERSON}`);
      expect(await db.user.count({ where: { phoneE164: `+${OTHER}` } })).toBe(0);
      expect((await db.marketplaceProfessional.findFirstOrThrow()).contactPhone).toBe(`+${OTHER}`); // just contact info
    });
  });

  describe("permissions are re-checked when actions run", () => {
    it("refuses a resumed listing after the person's membership was revoked, and creates nothing", async () => {
      const { user, professional } = await linkedAgent(PERSON);
      const second = await registerUser({ displayName: "Second Owner", email: "second@example.com", password: "secure-password-123" });
      await db.marketplaceProfessionalMember.create({ data: { marketplaceProfessionalId: professional.id, userId: second.id, role: "OWNER" } });
      await converse(api, PERSON, { text: "I want to list a property" });
      await converse(api, PERSON, { choice: "ls:type:RENT" });
      expect(allText(await converse(api, PERSON, { text: "menu" }))).toContain("saved");
      await db.marketplaceProfessionalMember.updateMany({ where: { marketplaceProfessionalId: professional.id, userId: user.id }, data: { status: "REMOVED" } });
      await converse(api, PERSON, { text: "resume" });
      for (const step of [
        { choice: "ls:cat:APARTMENT" }, { text: "Osu, Accra" }, { text: "2" }, { text: "2" }, { text: "skip" }, { text: "5000" }, { choice: "MONTHLY" },
        { choice: "ls:furn:FURNISHED" }, { text: "skip" }, { text: "now" }, { choice: "ls:auth:MANAGING_AGENT" }, { text: "Signed mandate dated 1 Oct 2026" },
        { text: "Bright two-bedroom flat with a balcony and secure parking." },
      ] as const) await converse(api, PERSON, step as never);
      const refused = await converse(api, PERSON, { choice: "ls:copy:ok" });
      expect(allText(refused)).toContain("not available to you any more");
      expect(await db.listing.count()).toBe(0);
      expect((await db.whatsAppAssistantSession.findFirstOrThrow()).workflow).toBeNull();
      expect(await db.whatsAppAssistantEvent.count({ where: { name: "step_refused" } })).toBe(1);
    });

    it("never exposes or manages another agency's listing, even by forged option ids", async () => {
      const other = await listingInReview("Other agency flat", "Cantonments");
      const { user, professional } = await linkedAgent(PERSON);
      await createMarketplaceNativeListing(user.id, professional.id, nativeListingInput({ title: "My own flat", locality: "Osu", city: "Accra" }));
      const status = await converse(api, PERSON, { text: "status" });
      expect(allText(status)).toContain("My own flat");
      expect(allText(status)).not.toContain("Other agency flat");
      const forgedEdit = await converse(api, PERSON, { choice: `st:listing:${other.listing.id}` });
      expect(allText(forgedEdit)).not.toContain("Other agency flat");
      expect(allText(forgedEdit)).toContain("couldn't find that listing");
      await converse(api, PERSON, { text: "I want to list a property" });
      const forgedProfile = await converse(api, PERSON, { choice: `ls:prof:${other.professional.id}` });
      expect(allText(forgedProfile)).not.toContain(other.professional.displayName);
      expect((await db.listing.findUniqueOrThrow({ where: { id: other.listing.id } })).status).toBe("PENDING_REVIEW");
      expect(professional.id).not.toBe(other.professional.id);
    });

    it("gives agents no way to publish: the service refuses and no WhatsApp step offers it", async () => {
      const { user, professional } = await linkedAgent(PERSON);
      await converse(api, PERSON, { text: "I want to list a property" });
      const copy = await listingAnswers(api, PERSON);
      const offered = optionIds(copy.at(-1)!);
      await converse(api, PERSON, { choice: "ls:copy:ok" });
      api.media.set("photo-1", { bytes: PNG, mimeType: "image/png" });
      await converse(api, PERSON, { image: { id: "photo-1" } });
      const review = await converse(api, PERSON, { text: "done" });
      await converse(api, PERSON, { choice: "ls:submit" });
      expect([...offered, ...review.flatMap(optionIds)].some((id) => /publish/i.test(id))).toBe(false);
      const listing = await db.listing.findFirstOrThrow();
      await expect(transitionMarketplaceProfessionalListing(user.id, professional.id, listing.id, { status: "PUBLISHED" })).rejects.toBeInstanceOf(AppError);
      expect((await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe("PENDING_REVIEW");
      await expect(getPublicListing(listing.id)).rejects.toMatchObject({ status: 404 });
    });
  });

  it("keeps identity documents private: no public link, and signed-link checks on the storage route", async () => {
    await converse(api, PERSON, { text: "I want to register my plumbing services" });
    for (const step of [
      { choice: "pr:type:INDIVIDUAL" }, { text: "Kojo Plumbing" }, { text: "plumbing" }, { text: "Tema" },
      { text: "Fast, tidy plumbing repairs for homes." }, { text: "skip" }, { choice: "pr:phone:yes" }, { text: "skip" }, { choice: "pr:submit" },
    ] as const) await converse(api, PERSON, step as never);
    await answerSmsCode(api, PERSON);
    api.media.set("card-1", { bytes: PNG, mimeType: "image/png" });
    await converse(api, PERSON, { image: { id: "card-1" } });
    const evidence = await db.providerEvidence.findFirstOrThrow();
    const stored = await db.storageObject.findFirstOrThrow({ where: { storageKey: evidence.reference } });
    expect(stored.classification).toBe("PRIVATE");
    expect(JSON.stringify(stored)).not.toMatch(/https?:\/\//);
    const keyPath = stored.storageKey.split("/").map(encodeURIComponent);
    const unsigned = await getLocalObject(new Request(`http://localhost/api/storage/local/${keyPath.join("/")}`), { params: Promise.resolve({ key: keyPath }) });
    expect(unsigned.status).toBe(403);
    const forged = await getLocalObject(new Request(`http://localhost/api/storage/local/${keyPath.join("/")}?token=abc&expires=${Date.now() + 60_000}`), { params: Promise.resolve({ key: keyPath }) });
    expect(forged.status).toBe(403);
  });

  it("lets AI output choose only a closed set of intents — never an identity, organisation or record", async () => {
    process.env.WHATSAPP_ASSISTANT_AI = "";
    const other = await listingInReview("Somebody else's flat", "Labone");
    const malicious: AIProvider = {
      key: "test-ai",
      complete: async () => ({
        text: "", toolKey: "nesafric.classify", inputTokens: 1, outputTokens: 1, modelKey: "test",
        toolCall: { key: "nesafric.classify", arguments: { intent: "edit_listing", userId: other.owner.id, professionalId: other.professional.id, listingId: other.listing.id, role: "SUPER_ADMIN" } },
      }),
    };
    setAssistantAIProvider(malicious);
    expect(await aiClassifyIntent("please")).toEqual(["edit_listing"]);
    const replies = await converse(api, PERSON, { text: "do the thing with the stuff" });
    expect(allText(replies)).not.toContain("Somebody else's flat");
    expect((await db.whatsAppContact.findFirstOrThrow()).userId).toBeNull();
    expect(await db.platformPrincipal.count()).toBe(0);
  });

  describe("media retrieval", () => {
    it("only sends the access token to https Meta media hosts", () => {
      const hosts = ["lookaside.fbsbx.com", ".fbsbx.com", ".whatsapp.net"];
      expect(mediaHostAllowed("https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1", hosts)).toBe(true);
      expect(mediaHostAllowed("https://mmg.whatsapp.net/x", hosts)).toBe(true);
      expect(mediaHostAllowed("http://lookaside.fbsbx.com/x", hosts)).toBe(false);
      expect(mediaHostAllowed("https://evil.example/x", hosts)).toBe(false);
      expect(mediaHostAllowed("https://fbsbx.com.evil.example/x", hosts)).toBe(false);
      expect(mediaHostAllowed("https://user:pw@lookaside.fbsbx.com/x", hosts)).toBe(false);
      expect(mediaHostAllowed("https://lookaside.fbsbx.com:8443/x", hosts)).toBe(false);
    });

    it("refuses disallowed hosts, redirects and oversized bodies, sending no token to the wrong place", async () => {
      const calls: Array<{ url: string; auth: boolean }> = [];
      let mode: "evil" | "redirect" | "huge" = "evil";
      setWhatsAppTransport(async (url, init) => {
        calls.push({ url, auth: Boolean((init?.headers as Record<string, string> | undefined)?.authorization) });
        if (url.endsWith("/m1")) return Response.json({ url: mode === "evil" ? "https://evil.example/steal" : "https://lookaside.example/file", mime_type: "image/png" });
        if (mode === "redirect") return new Response(null, { status: 302, headers: { location: "https://evil.example/" } });
        return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < 20; i += 1) controller.enqueue(new Uint8Array(1024 * 1024)); controller.close(); } }));
      });
      const config = { ...whatsAppAssistantConfig(), maxMediaBytes: 5 * 1024 * 1024 };
      await expect(downloadCloudApiMedia("m1", config)).rejects.toThrow(/allowed Meta host/);
      expect(calls.some(({ url }) => url.includes("evil.example"))).toBe(false);
      mode = "redirect";
      await expect(downloadCloudApiMedia("m1", config)).rejects.toThrow(/redirected/);
      mode = "huge";
      await expect(downloadCloudApiMedia("m1", config)).rejects.toBeInstanceOf(MediaDownloadError);
      await expect(downloadCloudApiMedia("../../etc", config)).rejects.toThrow(/Invalid media id/);
    });
  });

  it("respects opt-out for automated and staff messages, while still answering the person's own messages", async () => {
    await converse(api, PERSON, { text: "support" });
    await converse(api, PERSON, { text: "I need help with an agent" });
    const request = await db.whatsAppSupportRequest.findFirstOrThrow();
    await converse(api, PERSON, { text: "stop" });
    const contact = await db.whatsAppContact.findFirstOrThrow();
    expect(await queueNotification(contact.id, "auto:1", "Your listing is live")).toMatchObject({ skipped: true });
    const { principal } = await platformAdmin("SUPPORT_AGENT");
    const staff = await updateWhatsAppSupportRequest(principal, request.id, { reply: "We're on it" });
    expect(staff.delivery).toMatchObject({ skipped: true });
    expect(api.take().filter((message) => JSON.stringify(message).includes("on it"))).toHaveLength(0);
    expect(allText(await converse(api, PERSON, { text: "help" }))).toContain("How to use NesAfric");
  });

  it("never logs message content: errors are reduced to class and code", () => {
    expect(errorLabel(new Error("Kofi +233241234567 said: my secret"))).toBe("Error");
    expect(errorLabel(new AppError("FORBIDDEN", 403, "Kofi's listing"))).toBe("Error:FORBIDDEN:403");
    // Regression guard: no console call in the assistant passes raw error messages.
    const root = path.resolve(__dirname, "../src/modules/whatsapp-assistant");
    const files = readdirSync(root, { recursive: true }).map(String).filter((file) => file.endsWith(".ts"));
    const offenders = files.filter((file) => /console\.(error|warn|info|log)\([^;]*error\.message/.test(readFileSync(path.join(root, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});
