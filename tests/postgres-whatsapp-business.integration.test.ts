import { vi } from "vitest";
vi.mock("@/modules/messaging/otp-provider", async () => (await import("./helpers/fake-sms-otp")).fakeSmsOtpModule);
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createMarketplaceProfessional, reviewMarketplaceVerification } from "@/modules/marketplace-professionals/service";
import { requestListingChangesForPlatform, verifyAndPublishListingForPlatform } from "@/modules/platform-admin/service";
import { getPublicListing } from "@/modules/listings/service";
import { allText, answerSmsCode, configureAssistantEnv, converse, FakeGraphApi, optionIds, PNG, textOf } from "./helpers/whatsapp-assistant";

/**
 * Business journeys on the NesAfric WhatsApp assistant: registration, conversational listing
 * creation with photos, review, corrections, resubmission and publication — through the existing
 * marketplace-professional, listing, media and platform-review services.
 */

const AGENT = "233242222222";
const OTHER_AGENT = "233243333333";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "WhatsAppContact", "WhatsAppAction", "WhatsAppAssistantEvent", "BackgroundJob" CASCADE');
}

async function platformAdmin() {
  const user = await registerUser({ displayName: "Platform Admin", email: `admin-${Date.now()}@example.com`, password: "secure-password-123" });
  const principal = await db.platformPrincipal.create({ data: { userId: user.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
  return { user, principal };
}

/** Walks the independent-agent registration conversation to submission. */
async function registerAgent(api: FakeGraphApi, from: string, name = "Kwame Mensah") {
  await converse(api, from, { text: "I am an agent and want to register" });
  await converse(api, from, { text: name });
  await converse(api, from, { choice: "br:phone:yes" });
  await converse(api, from, { text: "skip" });
  await converse(api, from, { text: "East Legon, Adenta" });
  await converse(api, from, { text: "residential rentals, land" });
  await converse(api, from, { text: "skip" });
  const review = await converse(api, from, { text: "skip" });
  const prompt = await converse(api, from, { choice: "br:submit" });
  if (!allText(prompt).includes("6-digit code")) throw new Error(`expected an SMS code prompt, got: ${allText(prompt)}`);
  return { review, submitted: await answerSmsCode(api, from) };
}

/** Walks the listing conversation up to the photo step. */
async function draftListing(api: FakeGraphApi, from: string) {
  await converse(api, from, { text: "I want to list a property" });
  await converse(api, from, { choice: "ls:type:SALE" });
  await converse(api, from, { choice: "ls:cat:HOUSE" });
  await converse(api, from, { text: "Adenta, Accra" });
  await converse(api, from, { text: "3" });
  await converse(api, from, { text: "3" });
  await converse(api, from, { text: "skip" });
  await converse(api, from, { text: "GHS 1.5 million" });
  await converse(api, from, { choice: "ls:furn:UNFURNISHED" });
  await converse(api, from, { text: "parking, borehole, CCTV" });
  await converse(api, from, { text: "now" });
  await converse(api, from, { choice: "ls:auth:MANAGING_AGENT" });
  await converse(api, from, { text: "Signed mandate from the owner dated 3 Oct 2026" });
  const copy = await converse(api, from, { text: "Newly built family home on a quiet street, walled and gated, with a large compound." });
  const draft = await converse(api, from, { choice: "ls:copy:ok" });
  return { copy, draft };
}

describe("WhatsApp assistant — business journeys", () => {
  const api = new FakeGraphApi();
  beforeAll(() => { configureAssistantEnv(); api.install(); });
  beforeEach(async () => { await cleanDatabase(); api.take(); });
  afterAll(async () => { api.uninstall(); await cleanDatabase(); await db.$disconnect(); });

  it("registers an independent agent without inventing an agency, and queues verification", async () => {
    const { review, submitted } = await registerAgent(api, AGENT);
    expect(allText(review)).toContain("Name: Kwame Mensah");
    expect(allText(review)).toContain("Areas: East Legon, Adenta");
    expect(allText(submitted)).toMatch(/Reference: NES-AG-[0-9A-F]{8}/);
    expect(allText(submitted)).toContain("Status: Under review");

    const professional = await db.marketplaceProfessional.findFirstOrThrow({ include: { members: true } });
    expect(professional).toMatchObject({ type: "INDIVIDUAL_AGENT", displayName: "Kwame Mensah", verificationStatus: "PENDING", sourceChannel: "WHATSAPP", contactPhone: "+233242222222" });
    expect(professional.serviceAreas).toEqual(["East Legon", "Adenta"]);
    // The account is linked to the WhatsApp-verified number, with no platform privileges.
    const user = await db.user.findUniqueOrThrow({ where: { phoneE164: "+233242222222" }, include: { platformPrincipal: true } });
    expect(user.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(user.platformPrincipal).toBeNull();
    expect(professional.members).toEqual([expect.objectContaining({ userId: user.id, role: "OWNER" })]);
  });

  it("registers an agency and never treats it as verified", async () => {
    await converse(api, AGENT, { text: "I want to register my real estate agency" });
    await converse(api, AGENT, { text: "Golden Key Realty Limited" });
    await converse(api, AGENT, { text: "Golden Key" });
    await converse(api, AGENT, { text: "CS123456789" });
    await converse(api, AGENT, { text: "Abena Owusu" });
    await converse(api, AGENT, { choice: "br:phone:yes" });
    await converse(api, AGENT, { text: "hello@goldenkey.example" });
    await converse(api, AGENT, { text: "Accra, Tema" });
    await converse(api, AGENT, { text: "residential sales, commercial leasing" });
    await converse(api, AGENT, { text: "We help families and businesses find property across Greater Accra." });
    const review = await converse(api, AGENT, { text: "goldenkey.example" });
    expect(allText(review)).toContain("Registered name: Golden Key Realty Limited");
    expect(allText(await converse(api, AGENT, { choice: "br:submit" }))).toContain("6-digit code");
    expect(await db.marketplaceProfessional.count()).toBe(0); // nothing is created before the code
    const submitted = await answerSmsCode(api, AGENT);
    expect(allText(submitted)).toMatch(/NES-AG-/);
    const agency = await db.marketplaceProfessional.findFirstOrThrow();
    expect(agency).toMatchObject({ type: "BROKERAGE", displayName: "Golden Key", legalName: "Golden Key Realty Limited", verificationStatus: "PENDING", contactEmail: "hello@goldenkey.example" });
    expect(agency.verificationEvidenceReferences.join(" ")).toContain("CS123456789");

    // Approval comes only from a platform reviewer, and the business hears about it on WhatsApp.
    const { user } = await platformAdmin();
    await reviewMarketplaceVerification(user, agency.id, { status: "VERIFIED" });
    const notified = api.take();
    expect(allText(notified)).toContain("has been verified by NesAfric");
  });

  it("creates a listing with photos, submits it for review, and keeps it private until approval", async () => {
    await registerAgent(api, AGENT);
    const { copy, draft } = await draftListing(api, AGENT);
    const copyText = allText(copy);
    expect(copyText).toContain("3-Bedroom House for Sale in Adenta");
    expect(copyText).toContain("Newly built family home");
    // The generated text adds nothing that wasn't supplied.
    expect(copyText).not.toMatch(/swimming|pool|verified title|school/i);
    expect(allText(draft)).toMatch(/Draft saved\. Reference: NES-PR-/);
    expect(allText(draft)).toMatch(/main photo first/);

    api.media.set("media-1", { bytes: PNG, mimeType: "image/png" });
    api.media.set("media-2", { bytes: PNG, mimeType: "image/png" });
    expect(allText(await converse(api, AGENT, { image: { id: "media-1", caption: "Front view" } }))).toContain("Main photo saved");
    expect(allText(await converse(api, AGENT, { image: { id: "media-2" } }))).toContain("Photo 2 saved");
    const review = await converse(api, AGENT, { text: "done" });
    expect(allText(review)).toContain("Photos: 2");
    expect(optionIds(review.at(-1)!)).toContain("ls:submit");

    const listing = await db.listing.findFirstOrThrow({ include: { media: true } });
    expect(listing).toMatchObject({ status: "DRAFT", listingType: "SALE", category: "HOUSE", bedrooms: 3, sourceChannel: "WHATSAPP", askingAmountMinor: expect.anything() });
    expect(listing.askingAmountMinor?.toString()).toBe("150000000");
    expect(listing.media).toHaveLength(2);
    expect(listing.media.filter(({ isCover }) => isCover)).toHaveLength(1);
    // Photos were moved into NesAfric storage, never referenced at WhatsApp's temporary URL.
    expect(listing.media.every(({ publicUrl, storageKey }) => !publicUrl.includes("lookaside") && Boolean(storageKey))).toBe(true);

    const submitted = await converse(api, AGENT, { choice: "ls:submit" });
    expect(allText(submitted)).toContain("submitted for review");
    expect(allText(submitted)).toMatch(/will \*not\* appear on NesAfric until our team approves it/);
    const pending = await db.listing.findUniqueOrThrow({ where: { id: listing.id }, include: { verificationEvidence: true } });
    expect(pending).toMatchObject({ status: "PENDING_REVIEW", verificationStatus: "PENDING" });
    expect(pending.verificationEvidence[0]).toMatchObject({ type: "owner_mandate", privateReference: "Signed mandate from the owner dated 3 Oct 2026" });
    await expect(getPublicListing(listing.id)).rejects.toMatchObject({ status: 404 });
  });

  it("returns a listing for corrections, lets the agent fix and resubmit it, then publishes with the real URL", async () => {
    await registerAgent(api, AGENT);
    await draftListing(api, AGENT);
    api.media.set("media-1", { bytes: PNG, mimeType: "image/png" });
    await converse(api, AGENT, { image: { id: "media-1" } });
    await converse(api, AGENT, { text: "done" });
    await converse(api, AGENT, { choice: "ls:submit" });
    const listing = await db.listing.findFirstOrThrow();
    const { principal } = await platformAdmin();

    await requestListingChangesForPlatform(principal, listing.id, { expectedUpdatedAt: (await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).updatedAt, note: "Please correct the price to GHS 1.4 million." });
    const notice = allText(api.take());
    expect(notice).toContain("needs a few changes");
    expect(notice).toContain("Please correct the price to GHS 1.4 million.");

    const opened = await converse(api, AGENT, { text: "edit listing" });
    expect(allText(opened)).toContain("NesAfric's reviewer said");
    await converse(api, AGENT, { choice: "ls:edit" });
    await converse(api, AGENT, { choice: "ls:field:priceMinor" });
    const updated = await converse(api, AGENT, { text: "1.4m" });
    expect(allText(updated)).toContain("GH₵1,400,000");
    const resubmitted = await converse(api, AGENT, { choice: "ls:submit" });
    expect(allText(resubmitted)).toContain("submitted for review");
    const afterResubmit = await db.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(afterResubmit).toMatchObject({ status: "PENDING_REVIEW" });
    expect(afterResubmit.askingAmountMinor?.toString()).toBe("140000000");
    expect(await db.listing.count()).toBe(1);

    await verifyAndPublishListingForPlatform(principal, listing.id, { expectedUpdatedAt: afterResubmit.updatedAt });
    const published = allText(api.take());
    expect(published).toContain("approved and is now live");
    expect(published).toContain(`/marketplace/properties/${listing.id}`);
    expect((await getPublicListing(listing.id)).listing.id).toBe(listing.id);
  });

  it("never lets an agent manage another agent's listing", async () => {
    await registerAgent(api, AGENT);
    await draftListing(api, AGENT);
    const listing = await db.listing.findFirstOrThrow();
    await registerAgent(api, OTHER_AGENT, "Yaw Darko");
    // Even naming the other agent's listing directly gets nowhere.
    const attempt = await converse(api, OTHER_AGENT, { choice: `st:listing:${listing.id}` });
    expect(allText(attempt)).not.toContain(listing.title);
    const sneaky = await converse(api, OTHER_AGENT, { text: "edit listing" });
    expect(allText(sneaky)).not.toContain(listing.title);
    expect((await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe("DRAFT");
  });

  it("asks a contact with no business profile to register before listing", async () => {
    const replies = await converse(api, AGENT, { text: "I want to list a property" });
    expect(allText(replies)).toMatch(/first need a NesAfric business profile/);
    expect(optionIds(replies.at(-1)!)).toEqual(expect.arrayContaining(["menu:register_agent", "menu:register_landlord"]));
    expect(await db.listing.count()).toBe(0);
  });

  it("pauses an unfinished listing on 'menu' and resumes it after an interruption", async () => {
    await registerAgent(api, AGENT);
    await converse(api, AGENT, { text: "I want to list a property" });
    await converse(api, AGENT, { choice: "ls:type:RENT" });
    const paused = await converse(api, AGENT, { text: "menu" });
    expect(allText(paused)).toMatch(/property listing is saved/);
    await converse(api, AGENT, { text: "Find a plumber in Spintex" });
    const resumed = await converse(api, AGENT, { text: "resume" });
    expect(allText(resumed)).toContain("continuing your property listing");
    expect(textOf(resumed.at(-1)!)).toMatch(/What type of property/);
  });

  it("records an agent's claimed agency for the agency to confirm, without granting any access", async () => {
    const agencyOwner = await registerUser({ displayName: "Agency Owner", email: `agency-${Date.now()}@example.com`, password: "secure-password-123" });
    const agency = await createMarketplaceProfessional(agencyOwner.id, { type: "BROKERAGE", displayName: "Prime Homes", countryCode: "GH" });
    await converse(api, AGENT, { text: "register as an agent" });
    await converse(api, AGENT, { text: "Kwame Mensah" });
    await converse(api, AGENT, { choice: "br:phone:yes" });
    await converse(api, AGENT, { text: "skip" });
    await converse(api, AGENT, { text: "Osu" });
    await converse(api, AGENT, { text: "rentals" });
    await converse(api, AGENT, { text: "skip" });
    const review = await converse(api, AGENT, { text: "prime homes" });
    expect(allText(review)).toContain("Agency: prime homes (on NesAfric — they must confirm you)");
    await converse(api, AGENT, { choice: "br:submit" });
    const submitted = await answerSmsCode(api, AGENT);
    expect(allText(submitted)).toContain("only after their administrators add you to their team");
    const agent = await db.user.findUniqueOrThrow({ where: { phoneE164: "+233242222222" } });
    expect(await db.marketplaceProfessionalMember.count({ where: { marketplaceProfessionalId: agency.id, userId: agent.id } })).toBe(0);
    expect(await db.whatsAppSupportRequest.count({ where: { topic: "agent_affiliation" } })).toBe(1);
  });

  it("replays a typed choice (\"1\" = Submit) after the SMS code, exactly once", async () => {
    await converse(api, AGENT, { text: "register as an agent" });
    for (const step of [{ text: "Esi Agent" }, { text: "yes" }, { text: "skip" }, { text: "Osu" }, { text: "rentals" }, { text: "skip" }, { text: "skip" }] as const) await converse(api, AGENT, step as never);
    expect(allText(await converse(api, AGENT, { text: "1" }))).toContain("6-digit code");
    const done = await answerSmsCode(api, AGENT);
    expect(allText(done)).toMatch(/NES-AG-/);
    expect(await db.marketplaceProfessional.count()).toBe(1);
    expect((await db.marketplaceProfessional.findFirstOrThrow()).displayName).toBe("Esi Agent");
  });
});
