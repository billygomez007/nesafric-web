import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { upsertChannelConfig } from "@/modules/conversations/service";
import { resolveWhatsAppSendConfig } from "@/modules/conversations/channels/whatsapp-sender";
import { lockWhatsAppChannelShared } from "@/modules/conversations/channels/whatsapp-numbers";
import { receiveWhatsAppWebhook } from "@/modules/whatsapp-assistant/webhook";
import { assignWhatsAppNumberForPlatform, dismissWhatsAppClaimForPlatform, listWhatsAppNumbersForPlatform, releaseWhatsAppNumberForPlatform } from "@/modules/platform-admin/service";
import { db } from "@/platform/database/client";
import { createPlatformAdmin } from "./helpers/whatsapp-channel";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const OFFICIAL_NUMBER = "100200300";
const REPLACEMENT_OFFICIAL = "100200399";
const LANDLORD_NUMBER = "400500600";
const OTHER_NUMBER = "700800900";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation" CASCADE');
}

let counter = 0;
async function organisationWithOwner(name: string) {
  const owner = await registerUser({ displayName: `${name} Owner`, email: `owner-${++counter}@example.com`, password: "secure-password-123" });
  const organisation = await createOrganisation(owner.id, { name, type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
  return { owner, organisation };
}

const channelOf = (organisationId: string) => db.communicationChannelConfig.findUnique({ where: { organisationId_channel: { organisationId, channel: "WHATSAPP" } } });
const settingsOf = async (organisationId: string) => ((await channelOf(organisationId))?.config ?? {}) as Record<string, unknown>;
const activeOf = (organisationId: string) => db.whatsAppNumberAssignment.findUnique({ where: { activeOrganisationId: organisationId } });
const holderOf = async (phoneNumberId: string) => (await db.whatsAppNumberAssignment.findUnique({ where: { activePhoneNumberId: phoneNumberId } }))?.organisationId ?? null;
const successAudits = () => db.platformAuditEvent.count({ where: { action: { in: ["platform_admin.whatsapp_number_assigned", "platform_admin.whatsapp_number_moved", "platform_admin.whatsapp_number_released", "platform_admin.whatsapp_claim_dismissed"] } } });
const assign = (principal: Awaited<ReturnType<typeof createPlatformAdmin>>, organisationId: string, phoneNumberId: string, extra: Record<string, unknown> = {}) =>
  assignWhatsAppNumberForPlatform(principal, { organisationId, phoneNumberId, reason: "Test assignment", ...extra });

/** A webhook POST for one organisation, signed with the shared app secret. */
async function webhook(organisationId: string) {
  const { createHmac } = await import("node:crypto");
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  return receiveWhatsAppWebhook(new Request(`http://localhost/api/webhooks/whatsapp/${organisationId}`, { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", "test-app-secret").update(body).digest("hex")}` }, body }), organisationId);
}

/** An enabled channel with a number the organisation stored itself, as before platform-only assignment. */
const legacyChannel = (organisationId: string, phoneNumberId: string) =>
  db.communicationChannelConfig.create({ data: { organisationId, channel: "WHATSAPP", enabled: true, config: { phoneNumberId, businessAccountId: "555", marketplaceAssistantEnabled: true } } });

describe("PostgreSQL WhatsApp number assignment", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "test-app-secret");
    await cleanDatabase();
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  describe("organisation settings", () => {
    it("never lets an organisation owner set a number ID", async () => {
      const { owner, organisation } = await organisationWithOwner("Owusu Homes");
      await expect(upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config: { phoneNumberId: LANDLORD_NUMBER } })).rejects.toMatchObject({ code: "WHATSAPP_NUMBER_PLATFORM_ASSIGNED", status: 403 });
      await expect(upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config: { businessAccountId: "555" } })).rejects.toMatchObject({ code: "WHATSAPP_NUMBER_PLATFORM_ASSIGNED" });
      expect(await channelOf(organisation.id)).toBeNull();
      await upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config: { marketplaceAssistantEnabled: false } });
      expect(await settingsOf(organisation.id)).toEqual({ marketplaceAssistantEnabled: false });
      expect(await activeOf(organisation.id)).toBeNull();
      expect(await resolveWhatsAppSendConfig(organisation.id, {})).toBeNull();
    });

    it("never lets an organisation owner change or clear an assigned number, and keeps it across settings saves", async () => {
      const { owner, organisation } = await organisationWithOwner("Owusu Homes");
      const principal = await createPlatformAdmin();
      await assign(principal, organisation.id, LANDLORD_NUMBER, { businessAccountId: "555" });
      for (const config of [{ phoneNumberId: OTHER_NUMBER }, { phoneNumberId: null }, { phoneNumberId: LANDLORD_NUMBER, businessAccountId: "999" }]) {
        await expect(upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config })).rejects.toMatchObject({ code: "WHATSAPP_NUMBER_PLATFORM_ASSIGNED" });
      }
      // Resending the assigned values, or leaving them out as the settings screen does, is fine.
      await upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config: { phoneNumberId: LANDLORD_NUMBER, businessAccountId: "555", marketplaceAssistantEnabled: true } });
      await upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config: { defaultCountry: "GH" } });
      expect(await settingsOf(organisation.id)).toEqual({ defaultCountry: "GH" });
      expect(await activeOf(organisation.id)).toMatchObject({ phoneNumberId: LANDLORD_NUMBER, businessAccountId: "555" });
      expect(await resolveWhatsAppSendConfig(organisation.id, {})).toMatchObject({ senderOrganisationId: organisation.id, config: { phoneNumberId: LANDLORD_NUMBER, businessAccountId: "555", defaultCountry: "GH" } });
    });
  });

  describe("legacy numbers", () => {
    it("does not send or receive as a number an organisation stored itself, and falls back only to the official number", async () => {
      const official = await organisationWithOwner("NesAfric");
      const { owner, organisation } = await organisationWithOwner("Owusu Homes");
      await legacyChannel(organisation.id, LANDLORD_NUMBER);
      expect(await resolveWhatsAppSendConfig(organisation.id, {})).toBeNull();
      expect((await webhook(organisation.id)).status).toBe(503);

      // Business-initiated messages fall back to the official number, and only to an official assignment.
      vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.organisation.id);
      const principal = await createPlatformAdmin();
      await assign(principal, official.organisation.id, OFFICIAL_NUMBER);
      expect(await resolveWhatsAppSendConfig(organisation.id)).toMatchObject({ senderOrganisationId: official.organisation.id, official: true, config: { phoneNumberId: OFFICIAL_NUMBER } });
      await db.whatsAppNumberAssignment.updateMany({ where: { phoneNumberId: OFFICIAL_NUMBER }, data: { official: false } });
      expect(await resolveWhatsAppSendConfig(organisation.id)).toBeNull();
      await db.whatsAppNumberAssignment.updateMany({ where: { phoneNumberId: OFFICIAL_NUMBER }, data: { official: true } });

      // The claim stays in the settings for review; the owner can neither change it nor lose it by saving.
      await expect(upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config: { phoneNumberId: OTHER_NUMBER } })).rejects.toMatchObject({ code: "WHATSAPP_NUMBER_PLATFORM_ASSIGNED" });
      await upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config: { marketplaceAssistantEnabled: true } });
      expect(await settingsOf(organisation.id)).toEqual({ phoneNumberId: LANDLORD_NUMBER, businessAccountId: "555", marketplaceAssistantEnabled: true });

      const inventory = await listWhatsAppNumbersForPlatform(principal);
      expect(inventory.unreviewedClaims).toEqual([expect.objectContaining({ phoneNumberId: LANDLORD_NUMBER, organisation: { id: organisation.id, name: "Owusu Homes" }, heldByOrganisationId: null, officialProtected: false, claimedByOrganisations: 1 })]);
      expect(inventory.assignments).toEqual([expect.objectContaining({ phoneNumberId: OFFICIAL_NUMBER, official: true })]);

      // Approving the claim is an assignment; from then on the organisation sends as its own number.
      const approved = await assign(principal, organisation.id, LANDLORD_NUMBER, { businessAccountId: "555", reason: "Reviewed legacy number" });
      expect(approved.changed).toBe(true);
      expect(await db.platformAuditEvent.findFirstOrThrow({ where: { action: "platform_admin.whatsapp_number_assigned", organisationId: organisation.id } })).toMatchObject({ metadata: expect.objectContaining({ approvedLegacyClaim: true, reason: "Reviewed legacy number" }) });
      expect(await settingsOf(organisation.id)).toEqual({ marketplaceAssistantEnabled: true });
      expect(await resolveWhatsAppSendConfig(organisation.id)).toMatchObject({ senderOrganisationId: organisation.id, official: false, config: { phoneNumberId: LANDLORD_NUMBER } });
      expect((await listWhatsAppNumbersForPlatform(principal)).unreviewedClaims).toEqual([]);
    });

    it("dismisses a claim with an audit record, and refuses one that does not exist", async () => {
      const { organisation } = await organisationWithOwner("Owusu Homes");
      const principal = await createPlatformAdmin();
      await legacyChannel(organisation.id, LANDLORD_NUMBER);
      await expect(dismissWhatsAppClaimForPlatform(principal, { organisationId: organisation.id, phoneNumberId: OTHER_NUMBER, reason: "Not theirs" })).rejects.toMatchObject({ code: "WHATSAPP_CLAIM_NOT_FOUND" });
      expect(await successAudits()).toBe(0);
      await dismissWhatsAppClaimForPlatform(principal, { organisationId: organisation.id, phoneNumberId: LANDLORD_NUMBER, reason: "Number belongs to another business" });
      expect(await settingsOf(organisation.id)).toEqual({ marketplaceAssistantEnabled: true });
      expect(await db.platformAuditEvent.count({ where: { action: "platform_admin.whatsapp_claim_dismissed", organisationId: organisation.id } })).toBe(1);
      expect(await db.auditEvent.count({ where: { organisationId: organisation.id, action: "communication_channel.whatsapp_claim_dismissed" } })).toBe(1);
    });
  });

  describe("assignment and moves", () => {
    it("assigns, refuses an implicit move, moves explicitly and records every step", async () => {
      const first = await organisationWithOwner("Owusu Homes");
      const second = await organisationWithOwner("Mensah Estates");
      const principal = await createPlatformAdmin();
      await upsertChannelConfig(first.owner.id, first.organisation.id, "WHATSAPP", { enabled: true, config: { marketplaceAssistantEnabled: true } });

      const { assignment } = await assign(principal, first.organisation.id, LANDLORD_NUMBER, { businessAccountId: "555", reason: "Embedded signup completed" });
      expect(assignment).toMatchObject({ organisationId: first.organisation.id, official: false, assignedByPrincipalId: principal.id });
      expect(await db.platformAuditEvent.findFirstOrThrow({ where: { action: "platform_admin.whatsapp_number_assigned" } })).toMatchObject({ platformPrincipalId: principal.id, organisationId: first.organisation.id, entityId: assignment.id, metadata: expect.objectContaining({ phoneNumberId: LANDLORD_NUMBER, previousPhoneNumberId: null, reason: "Embedded signup completed" }) });
      expect(await db.auditEvent.count({ where: { organisationId: first.organisation.id, action: "communication_channel.whatsapp_number_assigned" } })).toBe(1);

      // Assigning what is already in force changes nothing and records nothing.
      expect(await assign(principal, first.organisation.id, LANDLORD_NUMBER, { businessAccountId: "555" })).toMatchObject({ changed: false, assignment: { id: assignment.id } });
      expect(await successAudits()).toBe(1);

      await expect(assign(principal, second.organisation.id, LANDLORD_NUMBER)).rejects.toMatchObject({ code: "WHATSAPP_NUMBER_IN_USE" });
      expect(await holderOf(LANDLORD_NUMBER)).toBe(first.organisation.id);
      expect(await successAudits()).toBe(1);

      await assign(principal, second.organisation.id, LANDLORD_NUMBER, { move: true, reason: "Customer moved accounts" });
      expect(await holderOf(LANDLORD_NUMBER)).toBe(second.organisation.id);
      expect(await activeOf(first.organisation.id)).toBeNull();
      expect(await db.whatsAppNumberAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).toMatchObject({ endedReason: "moved", activePhoneNumberId: null });
      expect(await channelOf(first.organisation.id)).toMatchObject({ config: { marketplaceAssistantEnabled: true } });
      expect(await resolveWhatsAppSendConfig(first.organisation.id, {})).toBeNull();
      expect(await resolveWhatsAppSendConfig(second.organisation.id, {})).toMatchObject({ senderOrganisationId: second.organisation.id });
      expect(await db.platformAuditEvent.findFirstOrThrow({ where: { action: "platform_admin.whatsapp_number_moved" } })).toMatchObject({ organisationId: second.organisation.id, metadata: expect.objectContaining({ movedFromOrganisationId: first.organisation.id, reason: "Customer moved accounts" }) });
      expect(await db.auditEvent.count({ where: { organisationId: first.organisation.id, action: "communication_channel.whatsapp_number_removed" } })).toBe(1);

      // Replacing an organisation's number records the one it had.
      await assign(principal, second.organisation.id, OTHER_NUMBER, { reason: "Number replaced" });
      expect(await db.platformAuditEvent.findFirstOrThrow({ where: { action: "platform_admin.whatsapp_number_assigned", organisationId: second.organisation.id } })).toMatchObject({ metadata: expect.objectContaining({ previousPhoneNumberId: LANDLORD_NUMBER }) });
      expect(await holderOf(LANDLORD_NUMBER)).toBeNull();
      expect(await db.whatsAppNumberAssignment.count()).toBe(3);
    });

    it("releases an ordinary number deliberately", async () => {
      const { organisation } = await organisationWithOwner("Owusu Homes");
      const principal = await createPlatformAdmin();
      await assign(principal, organisation.id, LANDLORD_NUMBER);
      await expect(releaseWhatsAppNumberForPlatform(principal, { phoneNumberId: LANDLORD_NUMBER, confirmPhoneNumberId: OTHER_NUMBER, reason: "Customer left" })).rejects.toMatchObject({ name: "ZodError" });
      await expect(releaseWhatsAppNumberForPlatform(principal, { phoneNumberId: OTHER_NUMBER, confirmPhoneNumberId: OTHER_NUMBER, reason: "Customer left" })).rejects.toMatchObject({ code: "WHATSAPP_NUMBER_NOT_HELD" });
      expect(await holderOf(LANDLORD_NUMBER)).toBe(organisation.id);
      expect(await releaseWhatsAppNumberForPlatform(principal, { phoneNumberId: LANDLORD_NUMBER, confirmPhoneNumberId: LANDLORD_NUMBER, reason: "Customer left" })).toEqual({ phoneNumberId: LANDLORD_NUMBER, assignmentEnded: true, officialProtectionReleased: false });
      expect(await activeOf(organisation.id)).toBeNull();
      expect(await db.platformAuditEvent.count({ where: { action: "platform_admin.whatsapp_number_released" } })).toBe(1);
    });

    it("requires whatsapp_numbers.manage for every change", async () => {
      const { organisation } = await organisationWithOwner("Owusu Homes");
      const admin = await createPlatformAdmin();
      await legacyChannel(organisation.id, LANDLORD_NUMBER);
      for (const role of ["SUPPORT_AGENT", "BILLING_ADMIN", "READ_ONLY"] as const) {
        const principal = await db.platformPrincipal.update({ where: { id: admin.id }, data: { role } });
        await expect(assign(principal, organisation.id, LANDLORD_NUMBER)).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(releaseWhatsAppNumberForPlatform(principal, { phoneNumberId: LANDLORD_NUMBER, confirmPhoneNumberId: LANDLORD_NUMBER, reason: "Not allowed" })).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(dismissWhatsAppClaimForPlatform(principal, { organisationId: organisation.id, phoneNumberId: LANDLORD_NUMBER, reason: "Not allowed" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      expect(await db.whatsAppNumberAssignment.count()).toBe(0);
      expect(await settingsOf(organisation.id)).toMatchObject({ phoneNumberId: LANDLORD_NUMBER });
      expect(await successAudits()).toBe(0);
    });
  });

  describe("official number", () => {
    it("protects the official number by its identity, through replacement, until a deliberate release", async () => {
      const official = await organisationWithOwner("NesAfric");
      const other = await organisationWithOwner("Owusu Homes");
      const principal = await createPlatformAdmin();
      vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.organisation.id);
      await assign(principal, official.organisation.id, OFFICIAL_NUMBER, { businessAccountId: "555" });
      expect(await activeOf(official.organisation.id)).toMatchObject({ official: true });

      await expect(assign(principal, other.organisation.id, OFFICIAL_NUMBER, { move: true })).rejects.toMatchObject({ code: "OFFICIAL_WHATSAPP_NUMBER" });
      await expect(upsertChannelConfig(other.owner.id, other.organisation.id, "WHATSAPP", { enabled: true, config: { phoneNumberId: OFFICIAL_NUMBER } })).rejects.toMatchObject({ code: "WHATSAPP_NUMBER_PLATFORM_ASSIGNED" });
      await expect(upsertChannelConfig(official.owner.id, official.organisation.id, "WHATSAPP", { enabled: true, config: { phoneNumberId: LANDLORD_NUMBER } })).rejects.toMatchObject({ code: "WHATSAPP_NUMBER_PLATFORM_ASSIGNED" });
      await expect(releaseWhatsAppNumberForPlatform(principal, { phoneNumberId: OFFICIAL_NUMBER, confirmPhoneNumberId: OFFICIAL_NUMBER, reason: "Trying" })).rejects.toMatchObject({ code: "OFFICIAL_WHATSAPP_NUMBER_ACTIVE" });

      // Replace the official number. The old one is no longer in force but stays protected.
      await assign(principal, official.organisation.id, REPLACEMENT_OFFICIAL, { reason: "New official number" });
      expect(await holderOf(OFFICIAL_NUMBER)).toBeNull();
      expect(await resolveWhatsAppSendConfig(other.organisation.id)).toMatchObject({ senderOrganisationId: official.organisation.id, config: { phoneNumberId: REPLACEMENT_OFFICIAL } });
      const before = await successAudits();
      await expect(assign(principal, other.organisation.id, OFFICIAL_NUMBER)).rejects.toMatchObject({ code: "OFFICIAL_WHATSAPP_NUMBER" });
      await expect(assign(principal, other.organisation.id, OFFICIAL_NUMBER, { move: true })).rejects.toMatchObject({ code: "OFFICIAL_WHATSAPP_NUMBER" });
      expect(await successAudits()).toBe(before);
      expect(await holderOf(OFFICIAL_NUMBER)).toBeNull();
      expect(await listWhatsAppNumbersForPlatform(principal)).toMatchObject({ protectedNumbers: [expect.objectContaining({ phoneNumberId: OFFICIAL_NUMBER })] });

      // Release the protection deliberately; only then can it go elsewhere.
      expect(await releaseWhatsAppNumberForPlatform(principal, { phoneNumberId: OFFICIAL_NUMBER, confirmPhoneNumberId: OFFICIAL_NUMBER, reason: "Number returned to Meta and reissued" })).toEqual({ phoneNumberId: OFFICIAL_NUMBER, assignmentEnded: false, officialProtectionReleased: true });
      expect(await db.platformAuditEvent.findFirstOrThrow({ where: { action: "platform_admin.whatsapp_number_released", metadata: { path: ["officialProtectionReleased"], equals: true } } })).toMatchObject({ metadata: expect.objectContaining({ reason: "Number returned to Meta and reissued" }) });
      await assign(principal, other.organisation.id, OFFICIAL_NUMBER, { reason: "Reissued" });
      expect(await holderOf(OFFICIAL_NUMBER)).toBe(other.organisation.id);
      expect(await activeOf(other.organisation.id)).toMatchObject({ official: false });
    });
  });

  it("promotes an assignment when its organisation becomes the official one", async () => {
    const official = await organisationWithOwner("NesAfric");
    const other = await organisationWithOwner("Owusu Homes");
    const principal = await createPlatformAdmin();
    await assign(principal, official.organisation.id, OFFICIAL_NUMBER, { businessAccountId: "555" });
    await upsertChannelConfig(official.owner.id, official.organisation.id, "WHATSAPP", { enabled: true, config: {} });
    expect(await activeOf(official.organisation.id)).toMatchObject({ official: false });
    vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.organisation.id);
    expect(await resolveWhatsAppSendConfig(other.organisation.id)).toBeNull();

    const promoted = await assign(principal, official.organisation.id, OFFICIAL_NUMBER, { businessAccountId: "555", reason: "Now the official organisation" });
    expect(promoted).toMatchObject({ changed: true, assignment: { official: true } });
    expect(await resolveWhatsAppSendConfig(other.organisation.id)).toMatchObject({ senderOrganisationId: official.organisation.id, official: true });
    expect(await assign(principal, official.organisation.id, OFFICIAL_NUMBER, { businessAccountId: "555" })).toMatchObject({ changed: false });
    await expect(releaseWhatsAppNumberForPlatform(principal, { phoneNumberId: OFFICIAL_NUMBER, confirmPhoneNumberId: OFFICIAL_NUMBER, reason: "Trying" })).rejects.toMatchObject({ code: "OFFICIAL_WHATSAPP_NUMBER_ACTIVE" });
    await expect(assign(principal, other.organisation.id, OFFICIAL_NUMBER, { move: true })).rejects.toMatchObject({ code: "OFFICIAL_WHATSAPP_NUMBER" });
  });

  describe("database constraints", () => {
    it("allows one holder per number and one number per organisation", async () => {
      const first = await organisationWithOwner("Owusu Homes");
      const second = await organisationWithOwner("Mensah Estates");
      const principal = await createPlatformAdmin();
      await assign(principal, first.organisation.id, LANDLORD_NUMBER);
      const row = (organisationId: string, phoneNumberId: string, extra: Record<string, unknown> = {}) => db.whatsAppNumberAssignment.create({ data: { organisationId, phoneNumberId, activeOrganisationId: organisationId, activePhoneNumberId: phoneNumberId, assignedByPrincipalId: principal.id, reason: "direct", ...extra } });
      await expect(row(second.organisation.id, LANDLORD_NUMBER)).rejects.toMatchObject({ code: "P2002" });
      await expect(row(first.organisation.id, OTHER_NUMBER)).rejects.toMatchObject({ code: "P2002" });
      await expect(row(second.organisation.id, OTHER_NUMBER, { activePhoneNumberId: LANDLORD_NUMBER + "1" })).rejects.toThrow(/active_check/);
      await expect(row(second.organisation.id, OTHER_NUMBER, { endedAt: new Date() })).rejects.toThrow(/active_check/);
      await expect(row(second.organisation.id, OTHER_NUMBER, { protectionReleasedAt: new Date() })).rejects.toThrow(/protection_check/);
    });
  });

  describe("concurrency", () => {
    it("serialises competing moves of one number without losing history", async () => {
      const organisations = await Promise.all(["A", "B", "C"].map((name) => organisationWithOwner(`Org ${name}`)));
      const principal = await createPlatformAdmin();
      await assign(principal, organisations[0].organisation.id, LANDLORD_NUMBER);
      const results = await Promise.allSettled(organisations.slice(1).map(({ organisation }) => assign(principal, organisation.id, LANDLORD_NUMBER, { move: true })));
      expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
      const rows = await db.whatsAppNumberAssignment.findMany({ where: { phoneNumberId: LANDLORD_NUMBER }, orderBy: { assignedAt: "asc" } });
      expect(rows).toHaveLength(3);
      expect(rows.filter((row) => row.endedAt === null)).toHaveLength(1);
      expect(rows.slice(0, 2).map((row) => row.endedReason)).toEqual(["moved", "moved"]);
      expect(await holderOf(LANDLORD_NUMBER)).toBe(rows[2].organisationId);
      expect(await db.platformAuditEvent.count({ where: { action: "platform_admin.whatsapp_number_moved" } })).toBe(2);
    });

    it("resolves a replacement racing a move of the replaced number to the same end state", async () => {
      const a = await organisationWithOwner("Org A");
      const b = await organisationWithOwner("Org B");
      const principal = await createPlatformAdmin();
      await assign(principal, a.organisation.id, LANDLORD_NUMBER);
      await Promise.all([assign(principal, a.organisation.id, OTHER_NUMBER), assign(principal, b.organisation.id, LANDLORD_NUMBER, { move: true })]);
      expect(await holderOf(OTHER_NUMBER)).toBe(a.organisation.id);
      expect(await holderOf(LANDLORD_NUMBER)).toBe(b.organisation.id);
      expect(await db.whatsAppNumberAssignment.count({ where: { endedAt: null } })).toBe(2);
    });

    it("never loses organisation settings or the assignment when both change at once", async () => {
      const { owner, organisation } = await organisationWithOwner("Owusu Homes");
      const principal = await createPlatformAdmin();
      await legacyChannel(organisation.id, LANDLORD_NUMBER);
      await Promise.all([
        assign(principal, organisation.id, LANDLORD_NUMBER, { businessAccountId: "555" }),
        upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config: { marketplaceAssistantEnabled: true, defaultCountry: "NG" } }),
        upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config: { marketplaceAssistantEnabled: true, defaultCountry: "NG" } }),
      ]);
      expect(await activeOf(organisation.id)).toMatchObject({ phoneNumberId: LANDLORD_NUMBER });
      expect(await settingsOf(organisation.id)).toEqual({ marketplaceAssistantEnabled: true, defaultCountry: "NG" });
      expect(await resolveWhatsAppSendConfig(organisation.id, {})).toMatchObject({ config: { phoneNumberId: LANDLORD_NUMBER, defaultCountry: "NG" } });
    });

    it("waits for work holding the channel before moving a number", async () => {
      const a = await organisationWithOwner("Org A");
      const b = await organisationWithOwner("Org B");
      const principal = await createPlatformAdmin();
      await assign(principal, a.organisation.id, LANDLORD_NUMBER);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let locked!: () => void;
      const holding = new Promise<void>((resolve) => { locked = resolve; });
      const inFlight = db.$transaction(async (tx) => {
        await lockWhatsAppChannelShared(tx, a.organisation.id);
        locked();
        await gate;
        return (await tx.whatsAppNumberAssignment.findUnique({ where: { activeOrganisationId: a.organisation.id } }))?.phoneNumberId;
      }, { timeout: 30_000 });
      await holding;
      let moved = false;
      const move = assign(principal, b.organisation.id, LANDLORD_NUMBER, { move: true }).then(() => { moved = true; });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(moved).toBe(false);
      expect(await holderOf(LANDLORD_NUMBER)).toBe(a.organisation.id);
      release();
      expect(await inFlight).toBe(LANDLORD_NUMBER);
      await move;
      expect(await holderOf(LANDLORD_NUMBER)).toBe(b.organisation.id);
    });
  });
});
