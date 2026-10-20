import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeImage } from "./helpers/images";

vi.mock("@/modules/whatsapp-assistant/maintenance/media", async () => ({
  downloadWhatsAppMedia: async (id: string) => (id.startsWith("9") ? null : { body: await makeImage({ colour: `#${id.slice(-6).padStart(6, "5")}`, width: 500, height: 400 }), contentType: "image/jpeg" }),
}));

import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createServiceProvider } from "@/modules/providers/service";
import { linkWhatsAppIdentity } from "@/modules/whatsapp-assistant/identity";
import { db } from "@/platform/database/client";
import { mediaId, whatsappConversation } from "./helpers/whatsapp-business";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

const PHONE = "233201234567";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge", "WhatsAppFlowDraft", "ServiceProvider" CASCADE');
}

async function provider(status: "UNVERIFIED" | "VERIFIED" = "UNVERIFIED") {
  const user = await registerUser({ displayName: "Kwame Asante", email: "kwame@example.com", password: "secure-password-123" });
  const organisation = await createOrganisation(user.id, { name: "Kwame personal", type: "OTHER", countryCode: "GH" });
  const categories = await db.serviceCategory.findMany({ where: { active: true }, orderBy: { name: "asc" }, take: 2 });
  const created = await createServiceProvider(user.id, { type: "INDIVIDUAL", displayName: "Kwame Plumbing", contactPhone: `+${PHONE}`, categoryIds: categories.map((category) => category.id) }) as { id: string };
  if (status === "VERIFIED") await db.serviceProvider.update({ where: { id: created.id }, data: { verificationStatus: "VERIFIED" } });
  await linkWhatsAppIdentity(PHONE, user.id, "SMS_OTP", organisation.id);
  return { user, providerId: created.id, categories, chat: whatsappConversation(PHONE, organisation.id) };
}

const profile = (providerId: string) => db.providerMarketplaceProfile.findUniqueOrThrow({ where: { providerId }, include: { categories: true, serviceAreas: true } });

describe("PostgreSQL WhatsApp service listing", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => { await cleanDatabase(); await db.$disconnect(); });

  it("saves a pending provider's listing with a starting price and up to 10 portfolio images, but does not publish it", async () => {
    const { providerId, chat } = await provider();
    expect((await chat.send("list my services")).reply).toContain("Which of your services should this listing show?");
    await chat.say("1, 2", "1", "Tema, Ashaiman", "Leak repairs, new installations and bathroom fittings, same-day callouts.", "2", "150");
    expect((await chat.send("1")).reply).toContain("Send photos of your work (up to 10");
    for (let n = 1; n <= 10; n += 1) expect((await chat.send({ image: mediaId(n) })).reply).toContain(`Image ${n} of 10 added.`);
    expect((await chat.send({ image: mediaId(11) })).reply).toContain("already have 10 portfolio images");
    expect((await chat.send({ image: mediaId(3) })).reply).toContain("already added");
    expect((await chat.send("remove 1")).reply).toContain("Image 1 removed.");
    const review = await chat.send("done");
    expect(review.reply).toContain("Pricing: from GHS 150");
    expect(review.reply).toContain("goes live once NesAfric approves you");
    expect((await chat.send("confirm")).reply).toContain("goes live once NesAfric approves Kwame Plumbing");
    const saved = await profile(providerId);
    expect([saved.listed, saved.pricingModel, saved.startingRateMinor?.toString(), saved.currencyCode, saved.categories.length, saved.serviceAreas.map((area) => area.city)]).toEqual([false, "STARTING_FROM", "15000", "GHS", 2, ["Tema", "Ashaiman"]]);
    expect(await db.providerPortfolioImage.count({ where: { providerId } })).toBe(9);
    expect((await db.serviceProvider.findUniqueOrThrow({ where: { id: providerId } })).availabilityStatus).toBe("AVAILABLE");
  });

  it("publishes an approved provider's quote-priced listing, and keeps a suspended one unlisted", async () => {
    const { providerId, chat } = await provider("VERIFIED");
    await chat.say("list my services", "1", "1", "Accra", "Emergency plumbing across Accra, priced after a free inspection.", "3", "2", "done");
    expect((await chat.send("confirm")).reply).toContain("Your service listing is published.");
    const saved = await profile(providerId);
    expect([saved.listed, saved.pricingModel, saved.startingRateMinor, saved.currencyCode]).toEqual([true, "QUOTE", null, null]);

    await db.serviceProvider.update({ where: { id: providerId }, data: { suspendedAt: new Date() } });
    chat.reset();
    await chat.say("list my services", "1", "1", "Accra", "Emergency plumbing across Accra, priced after a free inspection.", "3", "2", "done");
    expect((await chat.send("confirm")).reply).toContain("goes live once NesAfric approves");
    expect((await profile(providerId)).listed).toBe(false);
  });
});
