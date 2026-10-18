import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { queueOfficialTemplate, queueOfficialText } from "@/modules/whatsapp-assistant/outbound";
import { setWhatsAppOptOut } from "@/modules/whatsapp-assistant/identity";
import { normalizePhone } from "@/platform/identity/phone";
import { db } from "@/platform/database/client";
import { connectWhatsAppChannel } from "./helpers/whatsapp-channel";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge" CASCADE');
}

let counter = 0;
const recipientOf = async (result: { messageId: string | null }) => result.messageId ? (await db.messageDelivery.findFirstOrThrow({ where: { messageId: result.messageId } })).recipientAddress : null;
const text = (phone: string) => db.$transaction((tx) => queueOfficialText(tx, { phoneE164: phone, displayName: "Recipient", text: "Hello", externalMessageId: `recipient-test:${++counter}` }));
const template = (phone: string) => db.$transaction((tx) => queueOfficialTemplate(tx, { phoneE164: phone, displayName: "Recipient", template: "NOTIFICATION", bodyParameters: ["Hello"], body: "Hello", externalMessageId: `recipient-test:${++counter}` }));

describe("PostgreSQL WhatsApp recipient normalisation on the official number", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_TEMPLATE_NOTIFICATION", "nesafric_notification:en");
    await cleanDatabase();
    const staff = await registerUser({ displayName: "NesAfric Support", email: "support@example.com", password: "secure-password-123" });
    const official = await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
    vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.id);
    await connectWhatsAppChannel(staff.id, official.id, { enabled: true, config: { phoneNumberId: "100200300", businessAccountId: "555", marketplaceAssistantEnabled: true } });
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it.each([
    ["E.164 mobile", "+233241234567", "233241234567"],
    ["Ghana local mobile", "024 123 4567", "233241234567"],
    ["E.164 fixed line (WhatsApp Business on a landline)", "+233302123456", "233302123456"],
    ["Ghana local fixed line", "030 212 3456", "233302123456"],
    ["foreign mobile", "+44 7911 123456", "447911123456"],
  ])("sends to a valid %s in E.164 form, from both queues", async (_label, input, expected) => {
    expect(await recipientOf(await text(input))).toBe(expected);
    expect(await recipientOf(await template(input))).toBe(expected);
  });

  it.each(["12345", "not a number", "+1234"])("refuses an invalid number %s without queuing anything", async (input) => {
    for (const result of [await text(input), await template(input)]) {
      expect(result).toEqual({ messageId: null, reason: "The recipient's phone number is not a valid WhatsApp number." });
    }
    expect(await db.messageDelivery.count()).toBe(0);
  });

  it("matches STOP for the number however it was written, mobile and fixed line", async () => {
    await setWhatsAppOptOut(db, "233241234567", true);
    await setWhatsAppOptOut(db, "233302123456", true);
    for (const input of ["0241234567", "+233 24 123 4567", "0302123456"]) {
      expect(await text(input)).toEqual({ messageId: null, reason: "The recipient opted out of WhatsApp messages (STOP)." });
      expect(await template(input)).toEqual({ messageId: null, reason: "The recipient opted out of WhatsApp messages (STOP)." });
    }
    expect(await db.messageDelivery.count()).toBe(0);
  });

  it("leaves SMS sign-in identity rules unchanged: fixed lines are still not SMS identities", () => {
    expect(normalizePhone("0241234567")).toBe("+233241234567");
    expect(normalizePhone("+233302123456")).toBeNull();
  });
});
