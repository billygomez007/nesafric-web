import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as officialPost } from "@/app/api/webhooks/whatsapp/route";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createMarketplaceProfessional } from "@/modules/marketplace-professionals/service";
import { defaultChannelAdapters, type ChannelAdapters } from "@/modules/conversations/channels/registry";
import type { OutboundMessageRequest } from "@/modules/conversations/channels/types";
import { adminRef } from "@/modules/whatsapp-assistant/admin";
import { hashPassword } from "@/platform/auth/passwords";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";
import { db } from "@/platform/database/client";
import { connectWhatsAppChannel, createPlatformAdmin } from "./helpers/whatsapp-channel";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });

const SECRET = "test-app-secret";
const PHONE_NUMBER_ID = "100200300";
const ADMIN = "233231582898";
const CUSTOMER = "233241110001";
const PIN = "472913";
let counter = 0;
const sent: OutboundMessageRequest[] = [];
const adapters: ChannelAdapters = { ...defaultChannelAdapters, WHATSAPP: { ...defaultChannelAdapters.WHATSAPP, channel: "WHATSAPP", normalizeInbound: () => [], verifyWebhookSignature: () => ({ verified: false }), send: async (request) => { sent.push(request); return { status: "SENT", providerReference: `wamid.out.${++counter}` }; } } };

async function clean() { await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge", "PlatformPrincipal", "PlatformAuditEvent" CASCADE'); }

async function say(from: string, body: string) {
  const before = sent.length;
  const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "555", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, contacts: [{ wa_id: from, profile: { name: from === ADMIN ? "Realtegic" : "Ama Owusu" } }], messages: [{ id: `wamid.admin.${++counter}`, from, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }] } }] }] });
  expect((await officialPost(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}` }, body: raw }))).status).toBe(200);
  for (let pass = 0; pass < 3; pass += 1) await runDueJobs(createJobHandlers(undefined, adapters));
  await db.message.updateMany({ where: { direction: "INBOUND", processedAt: { not: null } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  return sent.slice(before).filter((request) => request.recipientAddress === from);
}
const last = async (from: string, body: string) => (await say(from, body)).at(-1)!;

async function setup() {
  const staff = await registerUser({ displayName: "NesAfric Support", email: "support@admin.test", password: "secure-password-123" });
  const official = await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
  vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.id);
  await connectWhatsAppChannel(staff.id, official.id, { enabled: true, config: { phoneNumberId: PHONE_NUMBER_ID, businessAccountId: "555", marketplaceAssistantEnabled: true } });
  const principal = await createPlatformAdmin();
  // What scripts/whatsapp-admin.ts link does.
  await db.channelIdentity.create({ data: { channel: "WHATSAPP", address: `+${ADMIN}`, userId: principal.userId, verifiedAt: new Date(), verificationMethod: "ADMIN" } });
  await db.platformPrincipal.update({ where: { id: principal.id }, data: { whatsappPinHash: await hashPassword(PIN) } });
  const agent = await registerUser({ displayName: "Kofi Agent", email: "kofi@admin.test", password: "secure-password-123" });
  const professional = await createMarketplaceProfessional(agent.id, { type: "INDIVIDUAL_AGENT", displayName: "Kofi Mensah Realty", countryCode: "GH" }) as { id: string };
  await db.marketplaceProfessional.update({ where: { id: professional.id }, data: { verificationStatus: "PENDING" } });
  return { official, principal, professional };
}

describe("PostgreSQL WhatsApp super admin", () => {
  beforeEach(async () => { vi.stubEnv("WHATSAPP_APP_SECRET", SECRET); sent.length = 0; await clean(); });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => { await clean(); await db.$disconnect(); });

  it("means nothing to anyone else: admin is not a command for a customer", async () => {
    await setup();
    const reply = await last(CUSTOMER, "admin queue");
    expect(reply.body).not.toMatch(/admin|PIN|queue/i);
    expect(await db.platformAuditEvent.count({ where: { action: { startsWith: "platform_admin.whatsapp" }, NOT: { action: "platform_admin.whatsapp_number_assigned" } } })).toBe(0);
  });

  it("asks for the PIN, removes it from the transcript, then reviews and approves a registration after confirm", async () => {
    const { professional, principal } = await setup();
    expect((await last(ADMIN, "admin queue")).body).toContain("Enter your 6-digit admin PIN");
    const wrong = await last(ADMIN, "000000");
    expect(wrong.body).toContain("Wrong PIN. 4 tries left.");
    const unlocked = await last(ADMIN, PIN);
    // The command that asked for the PIN runs right after it.
    const ref = adminRef("professional", professional.id);
    expect(unlocked.body).toContain("📋 *Review queue*: 1 waiting");
    expect(unlocked.body).toContain(`${ref} Agent: Kofi Mensah Realty`);
    expect(await db.message.count({ where: { body: { in: [PIN, "000000"] } } })).toBe(0);

    const viewed = await last(ADMIN, `admin view ${ref.toLowerCase()}`);
    expect(viewed.body).toContain("Kofi Mensah Realty");
    expect(viewed.whatsappInteractive).toMatchObject({ buttons: [{ id: `admin approve ${ref}` }, { id: `admin reject ${ref}` }] });

    const asked = await last(ADMIN, `admin approve ${ref}`);
    expect(asked.body).toContain(`Please confirm: APPROVE Kofi Mensah Realty (${ref})`);
    expect((await db.marketplaceProfessional.findUniqueOrThrow({ where: { id: professional.id } })).verificationStatus).toBe("PENDING");
    const done = await last(ADMIN, "confirm");
    expect(done.body).toContain("✅ Done: APPROVE Kofi Mensah Realty");
    expect((await db.marketplaceProfessional.findUniqueOrThrow({ where: { id: professional.id } })).verificationStatus).toBe("VERIFIED");
    expect(await db.platformAuditEvent.count({ where: { platformPrincipalId: principal.id, action: "platform_admin.whatsapp_approve", entityId: professional.id } })).toBe(1);

    // A rejection needs a reason; cancel changes nothing.
    expect((await last(ADMIN, `admin reject ${ref}`)).body).toContain("Add the reason");
    await last(ADMIN, `admin reject ${ref} Wrong card`);
    expect((await last(ADMIN, "cancel")).body).toContain("Nothing was changed");
    expect((await db.marketplaceProfessional.findUniqueOrThrow({ where: { id: professional.id } })).verificationStatus).toBe("VERIFIED");
  });

  it("locks admin for 30 minutes after 5 wrong PINs, and admin lock locks it at once", async () => {
    const { principal } = await setup();
    await say(ADMIN, "admin");
    for (let attempt = 0; attempt < 4; attempt += 1) await say(ADMIN, "111112");
    expect((await last(ADMIN, "111113")).body).toContain("locked for 30 minutes");
    expect((await last(ADMIN, "admin")).body).toContain("Admin is locked until");
    expect(await db.platformAuditEvent.count({ where: { platformPrincipalId: principal.id, action: "platform_admin.whatsapp_admin_locked" } })).toBe(1);

    await db.platformPrincipal.update({ where: { id: principal.id }, data: { whatsappPinLockedUntil: null } });
    await say(ADMIN, "admin");
    expect((await last(ADMIN, PIN)).body).toContain("Admin unlocked for 12 hours");
    expect((await last(ADMIN, "admin lock")).body).toContain("Admin locked");
    expect((await last(ADMIN, "admin queue")).body).toContain("Enter your 6-digit admin PIN");
  });

  it("stops at once when the operator revokes WhatsApp admin", async () => {
    const { principal } = await setup();
    await say(ADMIN, "admin");
    await say(ADMIN, PIN);
    await db.platformPrincipal.update({ where: { id: principal.id }, data: { whatsappPinHash: null } });
    expect((await last(ADMIN, "admin queue")).body).not.toContain("Review queue");
  });

  it("alerts the admin when a customer asks for a person, and lets them reply and hand the chat back", async () => {
    await setup();
    await say(ADMIN, "admin");
    await say(ADMIN, PIN);
    sent.length = 0;
    await say(CUSTOMER, "hi");
    await say(CUSTOMER, "support");
    const alert = sent.filter((request) => request.recipientAddress === ADMIN).at(-1)!;
    const conversation = await db.conversation.findFirstOrThrow({ where: { channelAddress: CUSTOMER } });
    const ref = adminRef("conversation", conversation.id);
    expect(alert.body).toContain(`💬 Support: Ama Owusu (+${CUSTOMER}) in ${ref}`);

    expect((await last(ADMIN, "admin support")).body).toContain(`${ref} Ama Owusu`);
    expect((await last(ADMIN, `admin open ${ref}`)).body).toContain("support");
    expect((await last(ADMIN, `admin reply ${ref} Hello Ama, how can we help?`)).body).toContain("Please confirm: send to");
    await say(ADMIN, "confirm");
    expect(sent.filter((request) => request.recipientAddress === CUSTOMER).at(-1)?.body).toBe("Hello Ama, how can we help?\n\n— NesAfric team");
    expect((await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).status).toBe("HUMAN_ACTIVE");

    // The assistant stays quiet in that chat; the admin is told instead.
    const quiet = await say(CUSTOMER, "I want a 2 bedroom in Osu");
    expect(quiet).toEqual([]);
    expect(sent.filter((request) => request.recipientAddress === ADMIN).at(-1)?.body).toContain("I want a 2 bedroom in Osu");

    await say(ADMIN, `admin done ${ref}`);
    await say(ADMIN, "confirm");
    expect((await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).status).toBe("AI_ACTIVE");
    expect(sent.filter((request) => request.recipientAddress === CUSTOMER).at(-1)?.body).toContain("You're back with the NesAfric assistant");
  });
});
