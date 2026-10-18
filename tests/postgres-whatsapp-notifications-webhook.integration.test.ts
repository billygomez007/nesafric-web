import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/modules/messaging/otp-provider", async () => (await import("./helpers/fake-sms-otp")).fakeSmsOtpModule);
import { db } from "@/platform/database/client";
import { runDueJobs } from "@/platform/jobs/runner";
import { jobHandlers } from "@/platform/jobs/handlers";
import { searchPublicListings, createMarketplaceNativeListing } from "@/modules/listings/service";
import { requestListingChangesForPlatform, verifyAndPublishListingForPlatform } from "@/modules/platform-admin/service";
import { ingestWebhook } from "@/modules/whatsapp-assistant/ingest";
import { queueNotification, SKIP_OPTED_OUT, SKIP_OUTSIDE_WINDOW } from "@/modules/whatsapp-assistant/store";
import { allText, configureAssistantEnv, converse, FakeGraphApi, sign, TEST_PHONE_NUMBER_ID, textOf, webhookBody } from "./helpers/whatsapp-assistant";
import { cleanWhatsAppDatabase, listingInReview, nativeListingInput, platformAdmin } from "./helpers/whatsapp-fixtures";

const PERSON = "233249999999";

describe("WhatsApp assistant — notifications, webhook scoping and search eligibility", () => {
  const api = new FakeGraphApi();
  beforeAll(() => { configureAssistantEnv(); api.install(); });
  beforeEach(async () => { await cleanWhatsAppDatabase(); api.take(); configureAssistantEnv(); });
  afterAll(async () => { api.uninstall(); await cleanWhatsAppDatabase(); await db.$disconnect(); });

  /** A listing in review whose owner has verified this WhatsApp number. */
  async function reviewWithLinkedOwner() {
    const context = await listingInReview();
    await db.whatsAppContact.create({ data: { waId: PERSON, phoneE164: `+${PERSON}`, userId: context.owner.id, lastInboundAt: new Date() } });
    const { principal } = await platformAdmin();
    return { ...context, principal };
  }

  describe("review decisions and their notifications (transactional outbox)", () => {
    it("writes the notification job in the decision's transaction and delivers it once", async () => {
      const { listing, principal } = await reviewWithLinkedOwner();
      await verifyAndPublishListingForPlatform(principal, listing.id, { expectedUpdatedAt: (await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).updatedAt });
      const jobs = await db.backgroundJob.findMany({ where: { type: "whatsapp-assistant-notify" } });
      expect(jobs).toEqual([expect.objectContaining({ status: "SUCCEEDED" })]);
      expect(allText(api.take())).toContain(`/marketplace/properties/${listing.id}`);

      // A recovery re-run of the same job (e.g. after a crash before it was marked done) sends nothing twice.
      await db.backgroundJob.update({ where: { id: jobs[0].id }, data: { status: "PENDING" } });
      await runDueJobs(jobHandlers, new Date(Date.now() + 1_000));
      expect(api.take()).toHaveLength(0);
      expect(await db.whatsAppOutboundMessage.count()).toBe(1);
    });

    it("delivers a committed decision's notification through the job runner if the immediate attempt never happened", async () => {
      const { listing, principal } = await reviewWithLinkedOwner();
      await requestListingChangesForPlatform(principal, listing.id, { expectedUpdatedAt: (await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).updatedAt, note: "Add the plot size." });
      // Simulate the process dying right after commit: the immediate delivery is undone.
      await db.whatsAppOutboundMessage.deleteMany();
      await db.backgroundJob.updateMany({ where: { type: "whatsapp-assistant-notify" }, data: { status: "PENDING", completedAt: null } });
      api.take();
      expect((await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe("DRAFT"); // the decision stands
      await runDueJobs(jobHandlers, new Date(Date.now() + 1_000));
      expect(allText(api.take())).toContain("Add the plot size.");
    });

    it("leaves no notification behind when the decision itself rolls back", async () => {
      const { listing, principal } = await reviewWithLinkedOwner();
      await db.listingMedia.deleteMany({ where: { listingId: listing.id } });
      const current = await db.listing.findUniqueOrThrow({ where: { id: listing.id } });
      await expect(verifyAndPublishListingForPlatform(principal, listing.id, { expectedUpdatedAt: current.updatedAt })).rejects.toMatchObject({ code: "LISTING_INCOMPLETE" });
      expect(await db.backgroundJob.count({ where: { type: "whatsapp-assistant-notify" } })).toBe(0);
      expect(api.take()).toHaveLength(0);
    });
  });

  describe("24-hour window", () => {
    it("records a window-skipped notification and sends it when the person writes again; opt-out skips are never released", async () => {
      await converse(api, PERSON, { text: "Hi" });
      const contact = await db.whatsAppContact.findFirstOrThrow();
      await db.whatsAppContact.update({ where: { id: contact.id }, data: { lastInboundAt: new Date(Date.now() - 25 * 3_600_000) } });
      expect(await queueNotification(contact.id, "decision:1", "Your listing is live: https://example/1")).toMatchObject({ skipped: true, reason: SKIP_OUTSIDE_WINDOW });
      expect(api.take()).toHaveLength(0);

      const replies = await converse(api, PERSON, { text: "help" });
      expect(textOf(replies[0])).toContain("Your listing is live"); // the held notification goes first
      expect(allText(replies)).toContain("How to use NesAfric");
      expect(await db.whatsAppOutboundMessage.findUniqueOrThrow({ where: { idempotencyKey: "decision:1" } })).toMatchObject({ status: "SENT" });

      await converse(api, PERSON, { text: "stop" });
      expect(await queueNotification(contact.id, "decision:2", "Another update")).toMatchObject({ skipped: true, reason: SKIP_OPTED_OUT });
      await converse(api, PERSON, { text: "help" });
      expect(await db.whatsAppOutboundMessage.findUniqueOrThrow({ where: { idempotencyKey: "decision:2" } })).toMatchObject({ status: "SKIPPED" });
    });
  });

  describe("webhook scoping and authentication", () => {
    it("acts only on NesAfric's phone number and business account", async () => {
      process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = "WABA";
      const otherNumber = webhookBody(PERSON, { text: "Hi" }).replace(`"phone_number_id":"${TEST_PHONE_NUMBER_ID}"`, '"phone_number_id":"999"');
      expect(await ingestWebhook(otherNumber, sign(otherNumber))).toMatchObject({ ok: true, stored: 0, ignored: 1 });
      const otherAccount = webhookBody(PERSON, { text: "Hi" }).replace('"id":"WABA"', '"id":"SOMEONE_ELSE"');
      expect(await ingestWebhook(otherAccount, sign(otherAccount))).toMatchObject({ ok: true, stored: 0, ignored: 1 });
      const ours = webhookBody(PERSON, { text: "Hi" });
      expect(await ingestWebhook(ours, sign(ours))).toMatchObject({ ok: true, stored: 1 });
      expect(await db.whatsAppInboundMessage.count()).toBe(1);
    });

    it("fails closed without a configured phone number id", async () => {
      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      const body = webhookBody(PERSON, { text: "Hi" });
      expect(await ingestWebhook(body, sign(body))).toMatchObject({ ok: false, status: 503 });
    });

    it("verifies the signature over the exact bytes received, including non-ASCII text", async () => {
      const body = Buffer.from(webhookBody(PERSON, { text: "Akwaaba! Budget ₵4,000 — Kɔforidua" }), "utf8");
      const result = await ingestWebhook(body, sign(body.toString("utf8")));
      expect(result).toMatchObject({ ok: true, stored: 1 });
      expect((await db.whatsAppInboundMessage.findFirstOrThrow()).text).toContain("₵4,000 — Kɔforidua");
      const tampered = Buffer.from(body);
      tampered[tampered.length - 20] ^= 1;
      expect(await ingestWebhook(tampered, sign(body.toString("utf8")))).toMatchObject({ ok: false, status: 401 });
    });
  });

  it("keeps public-search eligibility: the new area/furnishing filters never surface unpublished listings", async () => {
    const review = await listingInReview("In review, East Legon", "East Legon");
    const published = await listingInReview("Published, East Legon", "East Legon");
    const { principal } = await platformAdmin();
    await verifyAndPublishListingForPlatform(principal, published.listing.id, { expectedUpdatedAt: (await db.listing.findUniqueOrThrow({ where: { id: published.listing.id } })).updatedAt });
    const draft = await createMarketplaceNativeListing(published.owner.id, published.professional.id, nativeListingInput({ title: "Draft, East Legon", locality: "East Legon", city: "Accra", furnishing: "FURNISHED" }));
    const ids = async (query: Record<string, unknown>) => (await searchPublicListings(query)).items.map(({ id }: { id: string }) => id);
    expect(await ids({ country: "GH", area: "east legon" })).toEqual([published.listing.id]);
    expect(await ids({ country: "GH", area: "Legon" })).toEqual([published.listing.id]);
    expect(await ids({ country: "GH", area: "East Legon", furnishing: "FURNISHED" })).toEqual([]);
    expect(await ids({ country: "GH", area: "100%" })).toEqual([]); // LIKE wildcards are escaped
    expect(await ids({ country: "GH" })).toEqual([published.listing.id]);
    expect([review.listing.id, draft.id]).not.toContain(published.listing.id);
  });
});
