import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The marketplace search is covered by its own tests; here it returns two published listings so the
// test can follow the cards through the webhook, the reply job and the ordered delivery.
const listings = vi.hoisted(() => [
  { id: "2c7e1b3a-4d5f-4a6b-8c9d-0e1f2a3b4c5d", title: "Garden Flat" },
  { id: "3d8f2c4b-5e6a-4b7c-9d0e-1f2a3b4c5d6e", title: "Hill View" },
].map(({ id, title }) => ({
  id, isTopAd: false, listingType: "RENT", scope: "UNIT", source: "PROPERTY_OS", category: "APARTMENT", title, description: `${title} near the junction.`,
  pricing: { askingAmountMinor: null, rentAmountMinor: "450000", currencyCode: "GHS", frequency: "MONTHLY" },
  availability: { availableFrom: new Date("2026-11-01"), actual: true }, attributes: { bedrooms: 2, bathrooms: "2", sizeSqm: null }, bookable: false, stay: null,
  location: { countryCode: "GH", region: "Greater Accra", city: "Accra", district: null, locality: "Dzorwulu", label: "Dzorwulu, Accra", map: {} },
  amenities: [], media: [{ id: `${id}-m`, type: "PHOTO", url: `https://storage.googleapis.com/nesafric-public/${id}.jpg`, isCover: true, sortOrder: 0 }],
  contact: { name: "Owusu Realty", email: null, phone: null, enquiryEnabled: true }, verification: { status: "VERIFIED" },
})));
vi.mock("@/modules/listings/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/listings/service")>()),
  searchPublicListings: async () => ({ items: listings, pagination: { page: 1, pageSize: 3, total: 2, totalPages: 1 } }),
}));

import { POST as officialPost } from "@/app/api/webhooks/whatsapp/route";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { defaultChannelAdapters, type ChannelAdapters } from "@/modules/conversations/channels/registry";
import type { OutboundMessageRequest } from "@/modules/conversations/channels/types";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";
import { db } from "@/platform/database/client";
import { connectWhatsAppChannel } from "./helpers/whatsapp-channel";

vi.setConfig({ testTimeout: 30_000 });

const SECRET = "test-app-secret";
const PHONE_NUMBER_ID = "100200300";
const WA_ID = "233241234567";
let counter = 0;

const inbound = (body: string, name = "Ama Owusu") => ({
  object: "whatsapp_business_account",
  entry: [{ id: "555", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, contacts: [{ wa_id: WA_ID, profile: { name } }], messages: [{ id: `wamid.cards.${++counter}`, from: WA_ID, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }] } }] }],
});
const signed = (payload: unknown) => {
  const body = JSON.stringify(payload);
  return new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}` }, body });
};

function recordingAdapters(fail?: (request: OutboundMessageRequest) => boolean) {
  const sent: OutboundMessageRequest[] = [];
  const adapters: ChannelAdapters = { ...defaultChannelAdapters, WHATSAPP: { ...defaultChannelAdapters.WHATSAPP, channel: "WHATSAPP", send: async (request) => {
    if (fail?.(request)) return { status: "FAILED", retryable: true, failureReason: "WhatsApp provider responded with status 503." };
    sent.push(request); return { status: "SENT", providerReference: `wamid.out.${++counter}` };
  }, normalizeInbound: () => [], verifyWebhookSignature: () => ({ verified: false }) } };
  return { sent, adapters };
}

async function say(body: string, adapters: ChannelAdapters) {
  expect((await officialPost(signed(inbound(body)))).status).toBe(200);
  await runDueJobs(createJobHandlers(undefined, adapters));
  await runDueJobs(createJobHandlers(undefined, adapters));
}

describe("PostgreSQL WhatsApp property cards", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "BackgroundJob", "ChannelIdentity" CASCADE');
    const staff = await registerUser({ displayName: "NesAfric Support", email: "support@example.com", password: "secure-password-123" });
    const official = await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
    vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.id);
    await connectWhatsAppChannel(staff.id, official.id, { enabled: true, webhookVerifyToken: "verify-me", config: { phoneNumberId: PHONE_NUMBER_ID, businessAccountId: "555", marketplaceAssistantEnabled: true } });
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "BackgroundJob", "ChannelIdentity" CASCADE'); await db.$disconnect(); });

  it("greets by the WhatsApp profile name, then sends each result as a photo card, in order, once", async () => {
    const { sent, adapters } = recordingAdapters();
    await say("hi", adapters);
    expect(sent[0].body).toMatch(/^Good (morning|afternoon|evening), Ama! 🏡/);
    expect(sent[0].whatsappInteractive).toMatchObject({ type: "list", button: "Choose an option" });

    sent.length = 0;
    await say("rent in Dzorwulu", adapters);
    expect(sent.map((request) => request.whatsappInteractive?.type ?? "text")).toEqual(["text", "button", "button", "button"]);
    expect(sent[0].body).toContain("Here are matching properties");
    expect(sent[1].whatsappInteractive).toMatchObject({ header: { type: "image", link: `https://storage.googleapis.com/nesafric-public/${listings[0].id}.jpg` }, footer: "Property 1 of 2" });
    expect(sent[1].whatsappInteractive?.body).toContain("💰 GHS 4,500 per month");
    expect(sent[2].whatsappInteractive).toMatchObject({ footer: "Property 2 of 2" });
    expect(sent[3].whatsappInteractive).toMatchObject({ buttons: [{ id: "change filters" }, { id: "new search" }] });
    expect(await db.backgroundJob.count({ where: { type: "conversation-message-sequence" } })).toBe(1);

    // Running the worker again sends nothing twice.
    await runDueJobs(createJobHandlers(undefined, adapters));
    expect(sent).toHaveLength(4);
  });

  it("retries a sequence after a transient failure without resending what already went out", async () => {
    let failSecond = true;
    const { sent, adapters } = recordingAdapters((request) => request.whatsappInteractive?.footer === "Property 2 of 2" && failSecond);
    sent.length = 0;
    await say("rent in Dzorwulu", adapters);
    expect(sent.map((request) => request.whatsappInteractive?.footer ?? request.body.slice(0, 7))).toEqual(["Filters", "Property 1 of 2"]);
    const job = await db.backgroundJob.findFirstOrThrow({ where: { type: "conversation-message-sequence" } });
    expect(job.status).toBe("FAILED");

    failSecond = false;
    await db.backgroundJob.update({ where: { id: job.id }, data: { runAt: new Date() } });
    await runDueJobs(createJobHandlers(undefined, adapters));
    expect(sent.map((request) => request.whatsappInteractive?.footer ?? request.body.slice(0, 7))).toEqual(["Filters", "Property 1 of 2", "Property 2 of 2", "Showing"]);
  });
});
