import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => request.headers,
}));

import { GET as list, POST as assign } from "@/app/api/platform-admin/whatsapp-numbers/route";
import { POST as release } from "@/app/api/platform-admin/whatsapp-numbers/release/route";
import { POST as dismiss } from "@/app/api/platform-admin/whatsapp-numbers/claims/dismiss/route";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createSessionRecord } from "@/platform/auth/session";
import { db } from "@/platform/database/client";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const NUMBER = "400500600";
const OFFICIAL = "100200300";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation" CASCADE');
}

function as(token?: string) {
  request.headers = new Headers(token ? { authorization: `Bearer ${token}` } : {});
}

const post = (handler: (request: Request) => Promise<Response>, body: unknown, raw = false) =>
  handler(new Request("http://localhost/api/platform-admin/whatsapp-numbers", { method: "POST", headers: { "content-type": "application/json" }, body: raw ? String(body) : JSON.stringify(body) }));

let counter = 0;
async function user(role?: "SUPER_ADMIN" | "SUPPORT_AGENT" | "BILLING_ADMIN" | "READ_ONLY") {
  const created = await registerUser({ displayName: `User ${++counter}`, email: `user-${counter}@example.com`, password: "secure-password-123" });
  if (role) await db.platformPrincipal.create({ data: { userId: created.id, role, status: "ACTIVE", createdVia: "MANUAL" } });
  return { user: created, token: (await createSessionRecord(created.id)).token };
}

/** Everything a rejected request must leave untouched. */
async function snapshot() {
  return {
    assignments: await db.whatsAppNumberAssignment.findMany({ orderBy: { id: "asc" } }),
    channels: await db.communicationChannelConfig.findMany({ orderBy: { id: "asc" }, select: { organisationId: true, enabled: true, config: true } }),
    successAudits: await db.platformAuditEvent.count({ where: { action: { in: ["platform_admin.whatsapp_number_assigned", "platform_admin.whatsapp_number_moved", "platform_admin.whatsapp_number_released", "platform_admin.whatsapp_claim_dismissed"] } } }),
    organisationAudits: await db.auditEvent.count({ where: { action: { startsWith: "communication_channel.whatsapp" } } }),
  };
}

async function fixture() {
  const owner = await user();
  const official = await createOrganisation(owner.user.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
  const first = await createOrganisation(owner.user.id, { name: "Owusu Homes", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
  const second = await createOrganisation(owner.user.id, { name: "Mensah Estates", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
  vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.id);
  return { owner, official, first, second, admin: await user("SUPER_ADMIN") };
}

describe("PostgreSQL WhatsApp number routes", () => {
  beforeEach(async () => {
    as();
    await cleanDatabase();
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("rejects unauthenticated, non-platform and under-privileged callers without changing anything", async () => {
    const { owner, first } = await fixture();
    const body = { organisationId: first.id, phoneNumberId: NUMBER, reason: "Attempt" };
    const before = await snapshot();

    as();
    expect((await list()).status).toBe(401);
    expect((await post(assign, body)).status).toBe(401);
    expect((await post(release, { phoneNumberId: NUMBER, confirmPhoneNumberId: NUMBER, reason: "Attempt" })).status).toBe(401);

    // An organisation owner is not a platform principal.
    as(owner.token);
    expect((await list()).status).toBe(403);
    expect((await post(assign, body)).status).toBe(403);
    expect((await post(dismiss, { organisationId: first.id, phoneNumberId: NUMBER, reason: "Attempt" })).status).toBe(403);

    for (const role of ["SUPPORT_AGENT", "READ_ONLY"] as const) {
      as((await user(role)).token);
      expect((await list()).status).toBe(200);
      const response = await post(assign, body);
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("FORBIDDEN");
      expect((await post(release, { phoneNumberId: NUMBER, confirmPhoneNumberId: NUMBER, reason: "Attempt" })).status).toBe(403);
    }
    as((await user("BILLING_ADMIN")).token);
    expect((await list()).status).toBe(403);
    expect((await post(assign, body)).status).toBe(403);
    expect(await snapshot()).toEqual(before);
  });

  it("rejects malformed JSON and invalid fields", async () => {
    const { admin, first } = await fixture();
    as(admin.token);
    const before = await snapshot();
    const malformed = await post(assign, "{not json", true);
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe("INVALID_JSON");
    for (const body of [
      {},
      { organisationId: first.id, phoneNumberId: "+233 24", reason: "Bad number" },
      { organisationId: "not-a-uuid", phoneNumberId: NUMBER, reason: "Bad organisation" },
      { organisationId: first.id, phoneNumberId: NUMBER },
      { organisationId: first.id, phoneNumberId: NUMBER, reason: "Extra", official: true },
      { organisationId: first.id, phoneNumberId: NUMBER, reason: "Bad move", move: "yes" },
    ]) {
      const response = await post(assign, body);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    }
    expect((await post(release, "]", true)).status).toBe(400);
    const mismatch = await post(release, { phoneNumberId: NUMBER, confirmPhoneNumberId: "999", reason: "Mismatch" });
    expect(mismatch.status).toBe(400);
    expect((await mismatch.json()).error.issues).toEqual([expect.objectContaining({ path: "confirmPhoneNumberId" })]);
    const missing = await post(assign, { organisationId: "00000000-0000-4000-8000-000000000000", phoneNumberId: NUMBER, reason: "No such organisation" });
    expect(missing.status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it("assigns, refuses an implicit move, moves explicitly and lists the result", async () => {
    const { admin, first, second } = await fixture();
    as(admin.token);
    const assigned = await post(assign, { organisationId: first.id, phoneNumberId: NUMBER, businessAccountId: "555", reason: "Onboarded" });
    expect(assigned.status).toBe(200);
    expect(await assigned.json()).toMatchObject({ changed: true, assignment: { organisationId: first.id, phoneNumberId: NUMBER, official: false } });

    const unchanged = await post(assign, { organisationId: first.id, phoneNumberId: NUMBER, businessAccountId: "555", reason: "Again" });
    expect(await unchanged.json()).toMatchObject({ changed: false });

    const before = await snapshot();
    const refused = await post(assign, { organisationId: second.id, phoneNumberId: NUMBER, reason: "Take it" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "WHATSAPP_NUMBER_IN_USE", details: { organisationIds: [first.id] } } });
    expect(await snapshot()).toEqual(before);

    const moved = await post(assign, { organisationId: second.id, phoneNumberId: NUMBER, move: true, reason: "Customer moved accounts" });
    expect(moved.status).toBe(200);
    expect(await db.platformAuditEvent.findFirstOrThrow({ where: { action: "platform_admin.whatsapp_number_moved" } })).toMatchObject({ platformPrincipalId: expect.any(String), organisationId: second.id });

    const listed = await list();
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({ assignments: [{ phoneNumberId: NUMBER, organisation: { id: second.id } }], unreviewedClaims: [], protectedNumbers: [] });
  });

  it("enforces the official-number rules over HTTP", async () => {
    const { admin, official, first } = await fixture();
    as(admin.token);
    expect((await post(assign, { organisationId: official.id, phoneNumberId: OFFICIAL, reason: "Official" })).status).toBe(200);
    const before = await snapshot();

    const takeover = await post(assign, { organisationId: first.id, phoneNumberId: OFFICIAL, move: true, reason: "Takeover" });
    expect(takeover.status).toBe(409);
    expect((await takeover.json()).error.code).toBe("OFFICIAL_WHATSAPP_NUMBER");
    const releaseActive = await post(release, { phoneNumberId: OFFICIAL, confirmPhoneNumberId: OFFICIAL, reason: "Release" });
    expect(releaseActive.status).toBe(409);
    expect((await releaseActive.json()).error.code).toBe("OFFICIAL_WHATSAPP_NUMBER_ACTIVE");
    expect(await snapshot()).toEqual(before);

    expect((await post(assign, { organisationId: official.id, phoneNumberId: "100200399", reason: "Replacement" })).status).toBe(200);
    const reuse = await post(assign, { organisationId: first.id, phoneNumberId: OFFICIAL, reason: "Reuse old official" });
    expect(reuse.status).toBe(409);
    expect((await (await list()).json()).protectedNumbers).toEqual([expect.objectContaining({ phoneNumberId: OFFICIAL })]);

    const released = await post(release, { phoneNumberId: OFFICIAL, confirmPhoneNumberId: OFFICIAL, reason: "Reissued by Meta" });
    expect(released.status).toBe(200);
    expect(await released.json()).toEqual({ phoneNumberId: OFFICIAL, assignmentEnded: false, officialProtectionReleased: true });
    expect((await post(assign, { organisationId: first.id, phoneNumberId: OFFICIAL, reason: "Reissued" })).status).toBe(200);
  });

  it("dismisses an unreviewed claim", async () => {
    const { admin, first } = await fixture();
    await db.communicationChannelConfig.create({ data: { organisationId: first.id, channel: "WHATSAPP", enabled: true, config: { phoneNumberId: NUMBER } } });
    as(admin.token);
    expect((await (await list()).json()).unreviewedClaims).toEqual([expect.objectContaining({ phoneNumberId: NUMBER })]);
    const before = await snapshot();
    expect((await post(dismiss, { organisationId: first.id, phoneNumberId: "999", reason: "Wrong number" })).status).toBe(404);
    expect(await snapshot()).toEqual(before);
    expect((await post(dismiss, { organisationId: first.id, phoneNumberId: NUMBER, reason: "Not theirs" })).status).toBe(200);
    expect((await (await list()).json()).unreviewedClaims).toEqual([]);
  });
});
