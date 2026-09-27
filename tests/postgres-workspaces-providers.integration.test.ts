import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// `/api/workspaces` reads the session from next/headers; stand in the mobile bearer header.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => request.headers,
}));

import { POST as mobileSignIn } from "@/app/api/auth/mobile/session/route";
import { GET as workspaces } from "@/app/api/workspaces/route";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createServiceProvider } from "@/modules/providers/service";
import { db } from "@/platform/database/client";

const PASSWORD = "correct-horse-battery-1";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "LoginAttempt", "ServiceProvider" CASCADE');
}

async function user(email: string) {
  return registerUser({ email, password: PASSWORD, displayName: email.split("@")[0] });
}

async function tokenFor(email: string) {
  request.headers = new Headers();
  const response = await mobileSignIn(
    new Request("https://nesafric.test/api/auth/mobile/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) }),
  );
  return ((await response.json()) as { token: string }).token;
}

async function workspacesFor(email: string) {
  const token = await tokenFor(email);
  request.headers = new Headers({ authorization: `Bearer ${token}` });
  const response = await workspaces();
  expect(response.status).toBe(200);
  return (await response.json()) as { serviceProviders: Record<string, unknown>[]; propertyOsOrganisations: unknown[]; marketplaceProfessionals: unknown[] };
}

async function addMember(organisationId: string, userId: string, roleKey: string) {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  await db.organisationMember.create({ data: { organisationId, userId, roles: { create: { roleId: role.id } } } });
}

describe("/api/workspaces service providers", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("lists only the providers the signed-in user owns, with status fields only", async () => {
    const artisan = await user("artisan@example.com");
    const owner = await user("owner@example.com");
    const staff = await user("staff@example.com");
    const admin = await user("admin@example.com");
    await user("stranger@example.com");

    const individual = await createServiceProvider(artisan.id, {
      type: "INDIVIDUAL",
      displayName: "Kofi Plumbing",
      legalName: "Kofi Mensah",
      contactEmail: "kofi@example.com",
      contactPhone: "+233200000000",
    });
    const organisation = await createOrganisation(owner.id, { name: "Accra Repairs Ltd", type: "OTHER", countryCode: "GH" });
    const company = await createServiceProvider(owner.id, { type: "COMPANY", companyOrganisationId: organisation.id, displayName: "Accra Repairs" });
    await addMember(organisation.id, staff.id, "technician");
    await addMember(organisation.id, admin.id, "administrator");

    const artisanView = await workspacesFor("artisan@example.com");
    expect(artisanView.serviceProviders).toEqual([
      { id: individual.id, displayName: "Kofi Plumbing", type: "INDIVIDUAL", slug: expect.any(String), verificationStatus: "UNVERIFIED", availabilityStatus: "UNAVAILABLE", suspended: false },
    ]);
    // Existing collections are unchanged.
    expect(artisanView.propertyOsOrganisations).toEqual([]);
    expect(artisanView.marketplaceProfessionals).toEqual([]);
    // No contact, legal, evidence or review data.
    for (const key of ["contactEmail", "contactPhone", "legalName", "evidence", "suspensionReason", "administratorUserId", "individualUserId"]) {
      expect(artisanView.serviceProviders[0]).not.toHaveProperty(key);
    }

    expect((await workspacesFor("owner@example.com")).serviceProviders.map((provider) => provider.id)).toEqual([company.id]);
    expect((await workspacesFor("admin@example.com")).serviceProviders.map((provider) => provider.id)).toEqual([company.id]);
    // A company member without an owner or administrator role doesn't own the provider.
    expect((await workspacesFor("staff@example.com")).serviceProviders).toEqual([]);
    expect((await workspacesFor("stranger@example.com")).serviceProviders).toEqual([]);
  });

  it("drops archived providers and flags platform suspension", async () => {
    const artisan = await user("artisan@example.com");
    const provider = await createServiceProvider(artisan.id, { type: "INDIVIDUAL", displayName: "Kofi Plumbing" });

    await db.serviceProvider.update({ where: { id: provider.id }, data: { suspendedAt: new Date(), suspensionReason: "Internal note" } });
    const suspended = (await workspacesFor("artisan@example.com")).serviceProviders;
    expect(suspended).toEqual([expect.objectContaining({ id: provider.id, suspended: true })]);
    expect(suspended[0]).not.toHaveProperty("suspensionReason");

    await db.serviceProvider.update({ where: { id: provider.id }, data: { archivedAt: new Date() } });
    expect((await workspacesFor("artisan@example.com")).serviceProviders).toEqual([]);
  });

  it("still requires a signed-in user", async () => {
    request.headers = new Headers();
    expect((await workspaces()).status).toBe(401);
  });
});
