import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Production has no SMS provider: text-message codes cannot be sent.
vi.mock("@/modules/messaging/otp-provider", () => ({
  getSmsOtpProvider: () => ({ configured: false, expiryMinutes: 5, generate: async () => { throw new Error("not configured"); }, verify: async () => ({ ok: false, provider: "none", reason: "unavailable" }) }),
}));

import { POST as officialPost } from "@/app/api/webhooks/whatsapp/route";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { defaultChannelAdapters, type ChannelAdapters } from "@/modules/conversations/channels/registry";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";
import { db } from "@/platform/database/client";
import { connectWhatsAppChannel } from "./helpers/whatsapp-channel";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SECRET = "test-app-secret";
const PHONE_NUMBER_ID = "100200300";
const WA_ID = "233241239999";
let counter = 0;
const sent: string[] = [];
const adapters: ChannelAdapters = { ...defaultChannelAdapters, WHATSAPP: { ...defaultChannelAdapters.WHATSAPP, channel: "WHATSAPP", send: async (request) => { sent.push(request.body); return { status: "SENT", providerReference: `wamid.out.${++counter}` }; }, normalizeInbound: () => [], verifyWebhookSignature: () => ({ verified: false }) } };

async function say(body: string) {
  const before = sent.length;
  const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "555", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, contacts: [{ wa_id: WA_ID, profile: { name: "Kofi" } }], messages: [{ id: `wamid.signup.${++counter}`, from: WA_ID, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }] } }] }] });
  expect((await officialPost(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}` }, body: raw }))).status).toBe(200);
  await runDueJobs(createJobHandlers(undefined, adapters));
  await runDueJobs(createJobHandlers(undefined, adapters));
  return sent.slice(before).join("\n---\n");
}

describe("PostgreSQL WhatsApp account sign-up without SMS", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    vi.stubEnv("OTP_HASH_SECRET", "x".repeat(40));
    await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge" CASCADE');
    const staff = await registerUser({ displayName: "NesAfric Support", email: "support@signup.test", password: "secure-password-123" });
    const official = await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
    vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.id);
    await connectWhatsAppChannel(staff.id, official.id, { enabled: true, config: { phoneNumberId: PHONE_NUMBER_ID, businessAccountId: "555", marketplaceAssistantEnabled: true } });
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge" CASCADE'); await db.$disconnect(); });

  it("lets a new landlord sign up and continue in WhatsApp when text-message codes are unavailable", async () => {
    expect(await say("register")).toContain("landlord");
    expect(await say("1")).toContain("full name");
    const ready = await say("Kofi Mensah");
    expect(ready).toContain("✅ Your NesAfric account is ready, Kofi Mensah.");
    expect(ready).not.toMatch(/https?:\/\//);
    const user = await db.user.findFirstOrThrow({ where: { phoneE164: `+${WA_ID}` } });
    expect(await db.channelIdentity.findFirstOrThrow({ where: { address: `+${WA_ID}` } })).toMatchObject({ userId: user.id, verificationMethod: "WHATSAPP_REPLY" });
  });

  it("lets anyone register an agent profile from the menu, starting with the account, all in the chat", async () => {
    await say("hi");
    const asked = await say("4");
    expect(asked).toContain("What is your full name?");
    expect(asked).not.toMatch(/https?:\/\//);
    const next = await say("Kofi Mensah");
    expect(next).toContain("✅ Your NesAfric account is ready, Kofi.");
    expect(next).not.toContain("Create one at");
    expect(await db.whatsAppFlowDraft.count()).toBe(1);
  });
});
