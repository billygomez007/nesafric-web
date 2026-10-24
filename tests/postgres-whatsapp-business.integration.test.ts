import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No real SMS ever leaves a test: a fake Arkesel OTP authority generates and checks codes.
const sms = vi.hoisted(() => ({ codes: new Map<string, string>() }));
vi.mock("@/modules/messaging/otp-provider", () => ({
  getSmsOtpProvider: () => ({
    configured: true,
    expiryMinutes: 5,
    generate: async (numberE164: string) => { sms.codes.set(numberE164, String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0")); },
    verify: async (numberE164: string, code: string) => (sms.codes.get(numberE164) === code ? { ok: true, provider: "arkesel" } : { ok: false, provider: "arkesel", reason: "invalid", providerCode: "1104" }),
  }),
}));

import { POST as officialPost } from "@/app/api/webhooks/whatsapp/route";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { defaultChannelAdapters, type ChannelAdapters } from "@/modules/conversations/channels/registry";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";
import { db } from "@/platform/database/client";
import { connectWhatsAppChannel } from "./helpers/whatsapp-channel";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

const SECRET = "test-app-secret";
const PHONE_NUMBER_ID = "100200300";
const WA_ID = "233247770001";
// A minimal JPEG (SOI + JFIF header) so the upload pipeline's content sniffing accepts it.
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge", "StorageObject", "MarketplaceProfessional", "MarketplaceAsset", "ServiceProvider" CASCADE');
}

let counter = 0;
const sent: string[] = [];
const adapters: ChannelAdapters = { ...defaultChannelAdapters, WHATSAPP: { ...defaultChannelAdapters.WHATSAPP, channel: "WHATSAPP", send: async (request) => { sent.push(request.body); return { status: "SENT", providerReference: `wamid.out.${++counter}` }; }, normalizeInbound: () => [], verifyWebhookSignature: () => ({ verified: false }) } };

async function deliver(message: Record<string, unknown>) {
  const before = sent.length;
  const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "555", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, contacts: [{ wa_id: WA_ID, profile: { name: "Kwame" } }], messages: [{ from: WA_ID, timestamp: String(Math.floor(Date.now() / 1000)), ...message }] } }] }] });
  const response = await officialPost(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(payload).digest("hex")}` }, body: payload }));
  expect(response.status).toBe(200);
  await runDueJobs(createJobHandlers(undefined, adapters));
  await runDueJobs(createJobHandlers(undefined, adapters));
  // The assistant allows 20 inbound messages a minute per conversation; a test types faster than a person.
  await db.message.updateMany({ where: { direction: "INBOUND", processedAt: { not: null } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  return sent.slice(before).join("\n---\n");
}
const say = (body: string, id = `wamid.${++counter}`) => deliver({ id, type: "text", text: { body } });
const photo = (mediaId: string) => deliver({ id: `wamid.${++counter}`, type: "image", image: { id: mediaId, mime_type: "image/jpeg" } });

async function official() {
  const staff = await registerUser({ displayName: "NesAfric Support", email: "support@example.com", password: "secure-password-123" });
  const organisation = await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
  vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", organisation.id);
  await connectWhatsAppChannel(staff.id, organisation.id, { enabled: true, config: { phoneNumberId: PHONE_NUMBER_ID, businessAccountId: "555", marketplaceAssistantEnabled: true } });
  return organisation;
}

/** A new number becomes an account by its SMS code, inside whichever business flow it started. */
async function createAccount(name: string) {
  expect(await say(name)).toContain("6-digit code");
  const code = sms.codes.get(`+${WA_ID}`)!;
  return say(code);
}

describe("PostgreSQL WhatsApp business sign-up and listing", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    vi.stubEnv("WHATSAPP_PROVIDER_ACCESS_TOKEN", "test-token");
    vi.stubEnv("WHATSAPP_GRAPH_API_VERSION", "v21.0");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).startsWith("https://graph.facebook.com/")
      ? new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/media/1", mime_type: "image/jpeg", file_size: JPEG.length }))
      : new Response(JPEG, { headers: { "content-type": "image/jpeg" } })));
    sent.length = 0;
    sms.codes.clear();
    await cleanDatabase();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("registers an agent with a logo, then lists a property with photos for NesAfric review", async () => {
    await official();
    expect(await say("hi")).toContain("4. Register as an agent");
    expect(await say("4")).toContain("What is your full name?");
    expect(await createAccount("Kwame Asante")).toContain("Signed in as Kwame Asante");
    const user = await db.user.findFirstOrThrow({ where: { phoneE164: `+${WA_ID}` } });

    expect(await say("Asante Realty")).toContain("Which areas do you work in?");
    expect(await say("East Legon, Tema")).toContain("Describe your work");
    expect(await say("Ten years renting and selling homes in Accra.")).toContain("Which email address");
    const review = await say("Kwame@Example.com");
    expect(review).toContain("Name: Asante Realty");
    expect(review).toContain("Type: Individual agent");
    expect(review).toContain("Areas: East Legon, Tema");
    expect(await db.marketplaceProfessional.count()).toBe(0);
    expect(await say("confirm")).toContain("send your logo as a photo");
    const logo = await photo("700001");
    expect(logo).toContain("Logo saved");
    expect(logo).toContain("Reply 5 to list a property");

    const professional = await db.marketplaceProfessional.findFirstOrThrow({ include: { members: true } });
    expect(professional).toMatchObject({ type: "INDIVIDUAL_AGENT", displayName: "Asante Realty", contactEmail: "kwame@example.com", contactPhone: `+${WA_ID}`, countryCode: "GH", serviceAreas: ["East Legon", "Tema"] });
    expect(professional.members).toEqual([expect.objectContaining({ userId: user.id, role: "OWNER" })]);
    expect(professional.logoUrl).toBeTruthy();
    expect(await db.storageObject.count({ where: { targetType: "MARKETPLACE_PROFESSIONAL_LOGO", targetId: professional.id, classification: "PUBLIC", archivedAt: null } })).toBe(1);

    // The listing, under the only profile this account has.
    expect(await say("5")).toContain("for rent or for sale");
    expect(await say("rent")).toContain("What type of property");
    expect(await say("1")).toContain("short title");
    expect(await say("2 bedroom apartment with pool, East Legon")).toContain("Where is it?");
    expect(await say("East Legon, Accra")).toContain("What is the rent, in GHS?");
    expect(await say("4,500")).toContain("per month");
    expect(await say("monthly")).toContain("How many bedrooms?");
    expect(await say("2")).toContain("How many bathrooms?");
    expect(await say("2")).toContain("Describe the property");
    expect(await say("Bright, newly painted apartment near the A&C Mall with a pool and backup water.")).toContain("right to list");
    const listingReview = await say("2");
    expect(listingReview).toContain("Price: GHS 4500 per month");
    expect(listingReview).toContain("Location: East Legon, Accra");
    expect(await db.listing.count()).toBe(0);
    expect(await say("confirm")).toContain("Send photos of the property");
    const draft = await db.listing.findFirstOrThrow({ include: { media: true } });
    expect(draft).toMatchObject({ status: "DRAFT", listingType: "RENT", category: "APARTMENT", marketplaceProfessionalId: professional.id, city: "Accra", locality: "East Legon", frequency: "MONTHLY", bedrooms: 2, listingAuthority: "MANAGING_AGENT" });
    expect(draft.rentAmountMinor?.toString()).toBe("450000");

    expect(await photo("800001")).toContain("Photo 1 saved");
    expect(await photo("800002")).toContain("Photo 2 saved");
    expect(await say("done")).toContain("Send the reference of the owner's mandate");
    const submitted = await say("Owner's mandate from Mr Ofori, signed 1 October 2026");
    expect(submitted).toContain("Submitted for NesAfric review");

    const listing = await db.listing.findFirstOrThrow({ include: { media: true, verificationEvidence: true } });
    expect(listing.status).toBe("PENDING_REVIEW");
    expect(listing.verificationStatus).toBe("PENDING");
    expect(listing.media).toHaveLength(2);
    expect(listing.verificationEvidence).toEqual([expect.objectContaining({ type: "owner_mandate", privateReference: "Owner's mandate from Mr Ofori, signed 1 October 2026" })]);
    // Nothing reaches the public marketplace before NesAfric approves it.
    expect(listing.publishedAt).toBeNull();
  });

  it("registers a service business and lists it on the service marketplace", async () => {
    await official();
    expect(await say("6")).toContain("What is your full name?");
    expect(await createAccount("Kofi Boateng")).toContain("As an individual");
    expect(await say("1")).toContain("What name should customers see?");
    expect(await say("Boateng Plumbing & Electrical")).toContain("Which services do you offer?");
    const suggestions = await say("plumber, electrician");
    expect(suggestions).toContain("Added: Plumbing Repairs");
    expect(suggestions).toContain("Electrical Repairs");
    const pick = suggestions.split("\n").find((line) => line.endsWith("Electrical Repairs"))!.split(".")[0];
    expect(await say(pick)).toContain("Which towns or areas do you serve?");
    expect(await say("Accra, Tema")).toContain("Describe your services");
    const review = await say("skip");
    expect(review).toContain("Services: Plumbing Repairs, Electrical Repairs");
    expect(review).toContain("Registered as an individual");
    expect(await db.serviceProvider.count()).toBe(0);
    expect(await say("confirm")).toContain("Boateng Plumbing & Electrical is registered");
    expect(await say("skip")).toContain("is listed on the NesAfric service marketplace");

    const provider = await db.serviceProvider.findFirstOrThrow({ include: { categories: { include: { category: true } }, serviceAreas: true, marketplaceProfile: { include: { categories: true, serviceAreas: true } } } });
    expect(provider).toMatchObject({ type: "INDIVIDUAL", displayName: "Boateng Plumbing & Electrical", contactPhone: `+${WA_ID}` });
    expect(provider.categories.map(({ category }) => category.name).sort()).toEqual(["Electrical Repairs", "Plumbing Repairs"]);
    expect(provider.serviceAreas.map(({ name }) => name)).toEqual(["Accra", "Tema"]);
    expect(provider.marketplaceProfile).toMatchObject({ listed: true });
    expect(provider.marketplaceProfile?.categories).toHaveLength(2);
    expect(provider.marketplaceProfile?.serviceAreas).toHaveLength(2);

    // The logo can be added or changed later with one word.
    expect(await say("logo")).toContain("Send the new logo for Boateng Plumbing & Electrical");
    expect(await photo("900001")).toContain("Logo saved");
    expect(await db.storageObject.count({ where: { targetType: "SERVICE_PROVIDER_LOGO", targetId: provider.id, archivedAt: null } })).toBe(1);
  });

  it("asks for a profile before a listing, and saves nothing when cancelled", async () => {
    await official();
    const user = await registerUser({ displayName: "Esi Mensah", email: "esi@example.com", password: "secure-password-123" });
    const { linkWhatsAppIdentity } = await import("@/modules/whatsapp-assistant/identity");
    const org = await db.organisation.findFirstOrThrow({ where: { name: "NesAfric" } });
    await linkWhatsAppIdentity(WA_ID, user.id, "SMS_OTP", org.id);

    expect(await say("list my property")).toContain("you need an agent or agency profile first");
    expect(await say("3")).toContain("What kind of business");
    expect(await say("1")).toContain("What is the business called?");
    expect(await say("cancel")).toContain("Nothing was saved");
    expect(await db.marketplaceProfessional.count()).toBe(0);
  });
});
