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
import { upsertChannelConfig } from "@/modules/conversations/service";
import { defaultChannelAdapters, type ChannelAdapters } from "@/modules/conversations/channels/registry";
import { linkWhatsAppIdentity } from "@/modules/whatsapp-assistant/identity";
import { commitDraft } from "@/modules/whatsapp-assistant/onboarding/commit";
import { loadDraft } from "@/modules/whatsapp-assistant/onboarding/draft";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";
import { db } from "@/platform/database/client";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SECRET = "test-app-secret";
const PHONE_NUMBER_ID = "100200300";
const WA_ID = "233241234567";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge" CASCADE');
  await db.tenant.deleteMany();
}

let counter = 0;
const envelope = (body: string, id: string) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "555", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, contacts: [{ wa_id: WA_ID, profile: { name: "Ama" } }], messages: [{ id, from: WA_ID, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }] } }] }],
});
function post(payload: unknown) {
  const body = JSON.stringify(payload);
  return officialPost(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}` }, body }));
}

const sent: string[] = [];
const adapters: ChannelAdapters = { ...defaultChannelAdapters, WHATSAPP: { ...defaultChannelAdapters.WHATSAPP, channel: "WHATSAPP", send: async (request) => { sent.push(request.body); return { status: "SENT", providerReference: `wamid.out.${++counter}` }; }, normalizeInbound: () => [], verifyWebhookSignature: () => ({ verified: false }) } };

/** Sends one WhatsApp message to the official number and returns the assistant's reply. */
async function say(body: string, id = `wamid.${++counter}`) {
  const before = sent.length;
  expect((await post(envelope(body, id))).status).toBe(200);
  await runDueJobs(createJobHandlers(undefined, adapters));
  await runDueJobs(createJobHandlers(undefined, adapters));
  // The assistant allows 20 inbound messages a minute per conversation; a test types faster than a person.
  await db.message.updateMany({ where: { direction: "INBOUND", processedAt: { not: null } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  return sent.slice(before).join("\n---\n");
}

async function official() {
  const staff = await registerUser({ displayName: "NesAfric Support", email: "support@example.com", password: "secure-password-123" });
  const organisation = await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
  await upsertChannelConfig(staff.id, organisation.id, "WHATSAPP", { enabled: true, config: { phoneNumberId: PHONE_NUMBER_ID, businessAccountId: "555", marketplaceAssistantEnabled: true } });
  vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", organisation.id);
  return organisation;
}

/** Register a new landlord up to the organisation step. */
async function registerNewLandlord() {
  expect(await say("register")).toContain("landlord");
  expect(await say("1")).toContain("full name");
  expect(await say("Ama Owusu")).toContain("6-digit code");
  expect(await say(sms.codes.get(`+${WA_ID}`)!)).toContain("Signed in as Ama Owusu");
}

const draftFor = () => db.onboardingDraft.findFirstOrThrow({ where: { address: `+${WA_ID}` }, orderBy: { createdAt: "desc" } });

describe("PostgreSQL WhatsApp landlord onboarding", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    vi.stubEnv("OTP_HASH_SECRET", "x".repeat(40));
    sent.length = 0;
    await cleanDatabase();
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("registers a new landlord with several buildings, units, tenants and professionals", async () => {
    await official();
    await registerNewLandlord();
    const user = await db.user.findUniqueOrThrow({ where: { phoneE164: `+${WA_ID}` } });
    expect((await db.channelIdentity.findFirstOrThrow({ where: { address: `+${WA_ID}` } })).userId).toBe(user.id);

    expect(await say("Owusu Homes")).toContain("Property 1");
    await say("Palm Court");
    await say("East Legon");
    await say("12 Boundary Road");
    expect(await say("Block A, Block B")).toContain("Units in Block A");
    expect(await say("2")).toContain("What type");
    expect(await say("apartment")).toContain("Units in Block B");
    expect(await say("B1, studio\nB2, room, 1")).toContain("Saved Palm Court: 2 buildings, 4 units");
    await say("yes");
    await say("Sunset Villas");
    await say("Osu");
    await say("skip");
    await say("1");
    expect(await say("A1, house, 3")).toContain("Add another property");
    await say("no");
    await say("yes");
    expect(await say("Palm Court/Block A 1, Kofi Mensah, 0201112223, 1500, monthly, 2026-01-01, 2026-12-31\nSunset Villas/A1, Esi Boateng, -, 24000, yearly, 2026-03-01")).toContain("Added 2 tenants");
    await say("done");
    await say("yes");
    await say("yes");
    expect(await say("Kwame Plumbing, 0201234567, plumber\nVolta Electric, 0207654321, electrician")).toContain("Added 2 professionals");
    await say("done");
    await say("500");
    const review = await say("me");
    expect(review).toContain("Palm Court, East Legon: 2 buildings, 4 units");
    expect(review).toContain("up to GHS 500");
    const saved = await say("confirm");
    expect(saved).toContain("Owusu Homes: 2 properties, 5 units, 2 tenants");
    expect(saved).toContain("pending verification");
    expect(saved).toContain("Nobody has been contacted");

    const organisation = await db.organisation.findFirstOrThrow({ where: { name: "Owusu Homes" }, include: { members: true } });
    expect(organisation.type).toBe("INDIVIDUAL_LANDLORD");
    expect(organisation.members.map((member) => member.userId)).toEqual([user.id]);
    const palm = await db.property.findFirstOrThrow({ where: { organisationId: organisation.id, name: "Palm Court" }, include: { buildings: { include: { units: true }, orderBy: { name: "asc" } } } });
    expect(palm.buildings.map((building) => [building.name, building.units.map((unit) => unit.name).sort()])).toEqual([["Block A", ["Block A 1", "Block A 2"]], ["Block B", ["B1", "B2"]]]);
    expect(palm.buildings[0].units.every((unit) => unit.unitType === "apartment")).toBe(true);
    expect(await db.unit.count({ where: { property: { name: "Sunset Villas", organisationId: organisation.id }, buildingId: null } })).toBe(1);

    const leases = await db.lease.findMany({ where: { organisationId: organisation.id }, include: { unit: true }, orderBy: { referenceNumber: "asc" } });
    expect(leases.map((lease) => [lease.status, lease.unit?.name, lease.rentAmountMinor.toString(), lease.rentFrequency])).toEqual([["DRAFT", "Block A 1", "150000", "MONTHLY"], ["DRAFT", "A1", "2400000", "ANNUAL"]]);
    expect((await db.reminderPolicy.findMany({ where: { organisationId: organisation.id } })).map((policy) => policy.daysOffset).sort()).toEqual([30, 60]);
    const verifications = await db.portfolioVerification.findMany({ where: { organisationId: organisation.id } });
    expect(verifications).toHaveLength(2);
    expect(verifications.every((verification) => verification.status === "PENDING" && verification.claim === "OWNER" && verification.claimedByUserId === user.id)).toBe(true);
    const draft = await draftFor();
    expect(draft.status).toBe("COMMITTED");
    expect((draft.data as { providers: unknown[] }).providers).toHaveLength(2);
    expect(await db.message.count({ where: { body: { contains: "[verification code removed]" } } })).toBe(1);
  });

  it("saves progress, survives a closed conversation and resumes where it stopped", async () => {
    await official();
    await registerNewLandlord();
    await say("Owusu Homes");
    await say("Palm Court");
    expect(await say("pause")).toContain("saved");
    const conversation = await db.conversation.findFirstOrThrow({ where: { channel: "WHATSAPP" } });
    await db.conversation.update({ where: { id: conversation.id }, data: { status: "CLOSED", assistantState: {} } });
    expect(await say("register")).toContain("Which town or area is Palm Court in?");
  });

  it("keeps the draft and explains when the plan's unit limit blocks saving", async () => {
    await official();
    await registerNewLandlord();
    await say("Big Estate Ltd");
    await say("Big Estate");
    await say("Tema");
    await say("skip");
    await say("1");
    await say("20");
    await say("skip");
    await say("no");
    await say("later");
    await say("no");
    await say("no");
    await say("0");
    await say("me");
    expect(await say("confirm")).toContain("Not saved yet");
    expect((await draftFor()).status).toBe("IN_PROGRESS");
    expect(await db.property.count({ where: { name: "Big Estate" } })).toBe(0);
  });

  it("never creates records twice: redelivered confirmations and a retried commit reuse what exists", async () => {
    await official();
    await registerNewLandlord();
    await say("Owusu Homes");
    await say("Palm Court");
    await say("Osu");
    await say("skip");
    await say("1");
    await say("3");
    await say("skip");
    await say("no");
    await say("later");
    await say("no");
    await say("no");
    await say("0");
    await say("me");
    await say("confirm", "wamid.confirm");
    await say("confirm", "wamid.confirm");
    expect(await db.property.count({ where: { name: "Palm Court" } })).toBe(1);

    // A crash after creating the property but before recording it: the retry finds it by reference.
    const row = await draftFor();
    const data = row.data as { committed: { properties: Record<string, string>; verifications: boolean } };
    await db.onboardingDraft.update({ where: { id: row.id }, data: { status: "IN_PROGRESS", data: { ...data, committed: { ...data.committed, properties: {}, verifications: false } } } });
    await commitDraft((await loadDraft(row.id))!, row.userId!);
    expect(await db.property.count({ where: { name: "Palm Court" } })).toBe(1);
    expect(await db.unit.count({ where: { property: { name: "Palm Court" } } })).toBe(3);
    expect(await db.portfolioVerification.count()).toBe(1);
  });

  it("offers a linked user's existing organisation and adds the property to it", async () => {
    await official();
    const landlord = await registerUser({ displayName: "Kojo Asante", email: "kojo@example.com", password: "secure-password-123" });
    const existing = await createOrganisation(landlord.id, { name: "Asante Properties", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const officialOrg = await db.organisation.findFirstOrThrow({ where: { name: "NesAfric" } });
    await linkWhatsAppIdentity(WA_ID, landlord.id, "SMS_OTP", officialOrg.id);

    await say("register");
    expect(await say("2")).toContain("1. Asante Properties");
    await say("1");
    await say("Ridge Court");
    await say("Ridge");
    await say("skip");
    await say("1");
    await say("2");
    await say("skip");
    await say("no");
    await say("later");
    await say("no");
    await say("no");
    await say("0");
    await say("me");
    expect(await say("confirm")).toContain("Asante Properties: 1 property");
    expect(await db.organisation.count({ where: { members: { some: { userId: landlord.id } } } })).toBe(1);
    expect(await db.property.count({ where: { organisationId: existing.id } })).toBe(1);
    expect((await db.portfolioVerification.findFirstOrThrow({ where: { organisationId: existing.id } })).claim).toBe("MANAGER");
  });

  it("discards a draft without creating anything", async () => {
    await official();
    await registerNewLandlord();
    await say("Owusu Homes");
    expect(await say("discard")).toContain("deleted");
    expect((await draftFor()).status).toBe("ABANDONED");
    expect(await db.organisation.count({ where: { name: "Owusu Homes" } })).toBe(0);
  });
});
