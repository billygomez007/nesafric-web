import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { upsertChannelConfig } from "@/modules/conversations/service";
import { resolveWhatsAppSendConfig } from "@/modules/conversations/channels/whatsapp-sender";
import { assignWhatsAppNumberForPlatform, listWhatsAppNumbersForPlatform } from "@/modules/platform-admin/service";
import { db } from "@/platform/database/client";
import { createPlatformAdmin } from "./helpers/whatsapp-channel";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const OFFICIAL_NUMBER = "100200300";
const LANDLORD_NUMBER = "400500600";

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

describe("PostgreSQL WhatsApp number assignment", () => {
  beforeEach(cleanDatabase);
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("does not let an organisation owner set a number ID on its own channel", async () => {
    const { owner, organisation } = await organisationWithOwner("Owusu Homes");
    await expect(upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config: { phoneNumberId: LANDLORD_NUMBER } })).rejects.toMatchObject({ code: "WHATSAPP_NUMBER_PLATFORM_ASSIGNED", status: 403 });
    await expect(upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config: { businessAccountId: "555" } })).rejects.toMatchObject({ code: "WHATSAPP_NUMBER_PLATFORM_ASSIGNED" });
    expect(await channelOf(organisation.id)).toBeNull();
    // Saving the rest of the settings works and never carries a number.
    await upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config: { marketplaceAssistantEnabled: false } });
    expect(await settingsOf(organisation.id)).toEqual({ marketplaceAssistantEnabled: false });
    expect(await resolveWhatsAppSendConfig(organisation.id, {})).toBeNull();
  });

  it("does not let an organisation owner change or clear a number the platform assigned", async () => {
    const { owner, organisation } = await organisationWithOwner("Owusu Homes");
    const principal = await createPlatformAdmin();
    await assignWhatsAppNumberForPlatform(principal, { organisationId: organisation.id, phoneNumberId: LANDLORD_NUMBER, businessAccountId: "555", reason: "Embedded signup completed" });
    for (const config of [{ phoneNumberId: OFFICIAL_NUMBER }, { phoneNumberId: null }, { phoneNumberId: LANDLORD_NUMBER, businessAccountId: "999" }]) {
      await expect(upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config })).rejects.toMatchObject({ code: "WHATSAPP_NUMBER_PLATFORM_ASSIGNED" });
    }
    // Resending the assigned values, or omitting them as the settings screen does, keeps them.
    await upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config: { phoneNumberId: LANDLORD_NUMBER, marketplaceAssistantEnabled: true } });
    await upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config: {} });
    expect(await settingsOf(organisation.id)).toEqual({ phoneNumberId: LANDLORD_NUMBER, businessAccountId: "555" });
    expect(await resolveWhatsAppSendConfig(organisation.id, {})).toMatchObject({ senderOrganisationId: organisation.id, config: { phoneNumberId: LANDLORD_NUMBER } });
  });

  it("lets a platform admin assign a number and move it between organisations, with an audit record", async () => {
    const first = await organisationWithOwner("Owusu Homes");
    const second = await organisationWithOwner("Mensah Estates");
    const principal = await createPlatformAdmin();
    await upsertChannelConfig(first.owner.id, first.organisation.id, "WHATSAPP", { enabled: true, config: { marketplaceAssistantEnabled: true } });

    const assigned = await assignWhatsAppNumberForPlatform(principal, { organisationId: first.organisation.id, phoneNumberId: LANDLORD_NUMBER, businessAccountId: "555", reason: "Embedded signup completed" });
    expect(assigned).toMatchObject({ enabled: true, config: { phoneNumberId: LANDLORD_NUMBER, businessAccountId: "555", marketplaceAssistantEnabled: true } });
    expect(await db.platformAuditEvent.findFirstOrThrow({ where: { action: "platform_admin.whatsapp_number_assigned" } })).toMatchObject({ platformPrincipalId: principal.id, organisationId: first.organisation.id, entityId: assigned.id, metadata: expect.objectContaining({ phoneNumberId: LANDLORD_NUMBER, previousPhoneNumberId: null, reason: "Embedded signup completed" }) });
    expect(await db.auditEvent.count({ where: { organisationId: first.organisation.id, action: "communication_channel.whatsapp_number_assigned" } })).toBe(1);

    // Taking a number another organisation has needs an explicit move.
    await expect(assignWhatsAppNumberForPlatform(principal, { organisationId: second.organisation.id, phoneNumberId: LANDLORD_NUMBER, reason: "Customer moved accounts" })).rejects.toMatchObject({ code: "WHATSAPP_NUMBER_IN_USE" });
    const moved = await assignWhatsAppNumberForPlatform(principal, { organisationId: second.organisation.id, phoneNumberId: LANDLORD_NUMBER, move: true, reason: "Customer moved accounts" });
    expect(moved.config).toEqual({ phoneNumberId: LANDLORD_NUMBER });
    expect(await channelOf(first.organisation.id)).toMatchObject({ enabled: false, config: { marketplaceAssistantEnabled: true } });
    expect(await resolveWhatsAppSendConfig(first.organisation.id, {})).toBeNull();
    expect(await resolveWhatsAppSendConfig(second.organisation.id, {})).toMatchObject({ senderOrganisationId: second.organisation.id });
    expect(await db.platformAuditEvent.findFirstOrThrow({ where: { action: "platform_admin.whatsapp_number_moved" } })).toMatchObject({ organisationId: second.organisation.id, metadata: expect.objectContaining({ movedFromOrganisationIds: [first.organisation.id] }) });
    expect(await db.auditEvent.count({ where: { organisationId: first.organisation.id, action: "communication_channel.whatsapp_number_removed" } })).toBe(1);

    // Replacing an organisation's number records the one it had.
    await assignWhatsAppNumberForPlatform(principal, { organisationId: second.organisation.id, phoneNumberId: "700800900", reason: "Number replaced" });
    expect(await db.platformAuditEvent.findFirstOrThrow({ where: { action: "platform_admin.whatsapp_number_assigned", organisationId: second.organisation.id } })).toMatchObject({ metadata: expect.objectContaining({ previousPhoneNumberId: LANDLORD_NUMBER }) });
    expect(await listWhatsAppNumbersForPlatform(principal)).toEqual([expect.objectContaining({ phoneNumberId: "700800900", organisation: { id: second.organisation.id, name: "Mensah Estates" }, official: false })]);
  });

  it("keeps the official number on the official organisation", async () => {
    const official = await organisationWithOwner("NesAfric");
    const other = await organisationWithOwner("Owusu Homes");
    const principal = await createPlatformAdmin();
    vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.organisation.id);
    await assignWhatsAppNumberForPlatform(principal, { organisationId: official.organisation.id, phoneNumberId: OFFICIAL_NUMBER, businessAccountId: "555", reason: "Official number" });
    await expect(assignWhatsAppNumberForPlatform(principal, { organisationId: other.organisation.id, phoneNumberId: OFFICIAL_NUMBER, move: true, reason: "Attempted takeover" })).rejects.toMatchObject({ code: "OFFICIAL_WHATSAPP_NUMBER" });
    await expect(upsertChannelConfig(other.owner.id, other.organisation.id, "WHATSAPP", { enabled: true, config: { phoneNumberId: OFFICIAL_NUMBER } })).rejects.toMatchObject({ code: "WHATSAPP_NUMBER_PLATFORM_ASSIGNED" });
    await expect(upsertChannelConfig(official.owner.id, official.organisation.id, "WHATSAPP", { enabled: true, config: { phoneNumberId: LANDLORD_NUMBER } })).rejects.toMatchObject({ code: "WHATSAPP_NUMBER_PLATFORM_ASSIGNED" });
    expect(await settingsOf(official.organisation.id)).toMatchObject({ phoneNumberId: OFFICIAL_NUMBER });
    expect(await settingsOf(other.organisation.id)).toEqual({});
    // Organisations without their own number still send through the official one.
    expect(await resolveWhatsAppSendConfig(other.organisation.id)).toMatchObject({ senderOrganisationId: official.organisation.id, config: { phoneNumberId: OFFICIAL_NUMBER } });
  });

  it("requires whatsapp_numbers.manage", async () => {
    const { organisation } = await organisationWithOwner("Owusu Homes");
    const admin = await createPlatformAdmin();
    for (const role of ["SUPPORT_AGENT", "BILLING_ADMIN", "READ_ONLY"] as const) {
      const principal = await db.platformPrincipal.update({ where: { id: admin.id }, data: { role } });
      await expect(assignWhatsAppNumberForPlatform(principal, { organisationId: organisation.id, phoneNumberId: LANDLORD_NUMBER, reason: "Not allowed" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await channelOf(organisation.id)).toBeNull();
    expect(await db.platformAuditEvent.count({ where: { action: { startsWith: "platform_admin.whatsapp_number" } } })).toBe(0);
  });

  it("keeps sending from a number an organisation saved before assignment became platform-only", async () => {
    const { owner, organisation } = await organisationWithOwner("Owusu Homes");
    await db.communicationChannelConfig.create({ data: { organisationId: organisation.id, channel: "WHATSAPP", enabled: true, config: { phoneNumberId: LANDLORD_NUMBER, businessAccountId: "555" } } });
    expect(await resolveWhatsAppSendConfig(organisation.id, {})).toMatchObject({ senderOrganisationId: organisation.id, config: { phoneNumberId: LANDLORD_NUMBER } });
    await upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config: { marketplaceAssistantEnabled: true } });
    expect(await resolveWhatsAppSendConfig(organisation.id, {})).toMatchObject({ config: { phoneNumberId: LANDLORD_NUMBER, businessAccountId: "555", marketplaceAssistantEnabled: true } });
    await expect(upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config: { phoneNumberId: "700800900" } })).rejects.toMatchObject({ code: "WHATSAPP_NUMBER_PLATFORM_ASSIGNED" });
  });
});
