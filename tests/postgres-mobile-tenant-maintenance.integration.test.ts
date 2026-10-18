import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Routes read the session from next/headers; each call is made "from" the app with a bearer token.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => request.headers,
}));

import { GET as tenancies } from "@/app/api/account/tenancies/route";
import { POST as mobileSignIn } from "@/app/api/auth/mobile/session/route";
import { GET as maintenanceDetail } from "@/app/api/maintenance/requests/[requestId]/route";
import { GET as maintenanceList, POST as maintenanceCreate } from "@/app/api/maintenance/requests/route";
import { GET as tenantHistory } from "@/app/api/maintenance/tenants/[tenantOrganisationId]/history/route";
import { createProperty } from "@/modules/assets/service";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createTenant } from "@/modules/tenants/service";
import { db } from "@/platform/database/client";
import { createLease } from "./helpers/lease";

// Assertions check key names, statuses and booleans only; no record content is printed on failure.
const PASSWORD = "correct-horse-battery-1";
const TENANT_REQUEST_KEYS = [
  "attachments", "category", "closedAt", "completedAt", "createdAt", "description", "id", "priority",
  "property", "referenceNumber", "status", "tenantOrganisationId", "timeline", "title", "unit", "updatedAt", "workOrders",
].sort();

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "LoginAttempt" CASCADE');
}

function as(bearer?: string) {
  request.headers = new Headers();
  if (bearer) request.headers.set("authorization", `Bearer ${bearer}`);
}

async function tokenFor(email: string) {
  as();
  const response = await mobileSignIn(new Request("https://nesafric.test/api/auth/mobile/session", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
  }));
  expect(response.status).toBe(200);
  return (await response.json()).token as string;
}

const scoped = (path: string, organisationId: string, init: RequestInit = {}) =>
  new Request(`https://nesafric.test${path}`, { ...init, headers: { "x-organisation-id": organisationId, "content-type": "application/json", ...init.headers } });
const params = <T,>(value: T) => ({ params: Promise.resolve(value) });

describe("mobile tenant self-service: tenancies and maintenance", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("lists only the caller's own current tenancies and keeps maintenance tenant-safe and isolated", async () => {
    const owner = await registerUser({ displayName: "Tenancy Owner", email: "owner@tenancy.test", password: PASSWORD });
    const otherOwner = await registerUser({ displayName: "Other Owner", email: "other-owner@tenancy.test", password: PASSWORD });
    const tenantUser = await registerUser({ displayName: "Tenancy Tenant", email: "tenant@tenancy.test", password: PASSWORD });
    const neighbourUser = await registerUser({ displayName: "Neighbour", email: "neighbour@tenancy.test", password: PASSWORD });
    const organisation = await createOrganisation(owner.id, { name: "Tenancy Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const otherOrganisation = await createOrganisation(otherOwner.id, { name: "Other Tenancy Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const property = await createProperty(owner.id, organisation.id, {
      name: "Tenancy House", referenceNumber: "TEN-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }, { name: "A2" }],
    });
    const [unit, neighbourUnit] = await db.unit.findMany({ where: { propertyId: property.id }, orderBy: { name: "asc" } });

    const tenant = await createTenant(owner.id, organisation.id, { legalName: "Tenancy Tenant", email: "tenant-record@tenancy.test" });
    const neighbour = await createTenant(owner.id, organisation.id, { legalName: "Neighbour Record", email: "neighbour-record@tenancy.test" });
    const archived = await createTenant(otherOwner.id, otherOrganisation.id, { legalName: "Archived Link", email: "archived-record@tenancy.test" });
    await db.tenantOrganisation.update({ where: { id: tenant.relationship.id }, data: { userId: tenantUser.id } });
    await db.tenantOrganisation.update({ where: { id: neighbour.relationship.id }, data: { userId: neighbourUser.id } });
    await db.tenantOrganisation.update({ where: { id: archived.relationship.id }, data: { userId: tenantUser.id, archivedAt: new Date() } });
    const activeLease = await createLease(owner.id, organisation.id, {
      referenceNumber: "TEN-LEASE-1", propertyId: property.id, unitId: unit.id, tenantOrganisationIds: [tenant.relationship.id],
      startDate: "2026-01-01", endDate: "2026-12-31", rentAmountMinor: "100000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE",
    });
    // A draft lease is not a current tenancy and must not be listed.
    await createLease(owner.id, organisation.id, {
      referenceNumber: "TEN-LEASE-DRAFT", propertyId: property.id, unitId: neighbourUnit.id, tenantOrganisationIds: [tenant.relationship.id],
      startDate: "2027-01-01", endDate: "2027-12-31", rentAmountMinor: "100000", currencyCode: "GHS", rentFrequency: "MONTHLY",
    });
    await createLease(owner.id, organisation.id, {
      referenceNumber: "TEN-LEASE-2", propertyId: property.id, unitId: neighbourUnit.id, tenantOrganisationIds: [neighbour.relationship.id],
      startDate: "2026-01-01", endDate: "2026-12-31", rentAmountMinor: "100000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE",
    });

    as();
    expect((await tenancies()).status).toBe(401);

    const tenantToken = await tokenFor("tenant@tenancy.test");
    const neighbourToken = await tokenFor("neighbour@tenancy.test");
    const ownerToken = await tokenFor("owner@tenancy.test");

    as(tenantToken);
    const listed = await tenancies();
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(Object.keys(body)).toEqual(["tenancies"]);
    expect(body.tenancies).toHaveLength(1);
    const [home] = body.tenancies;
    expect(Object.keys(home).sort()).toEqual(["leases", "organisation", "tenantOrganisationId"]);
    expect(home.tenantOrganisationId === tenant.relationship.id).toBe(true);
    expect(Object.keys(home.organisation).sort()).toEqual(["id", "name"]);
    expect(home.organisation.id === organisation.id).toBe(true);
    expect(home.leases).toHaveLength(1);
    expect(Object.keys(home.leases[0]).sort()).toEqual(["endDate", "id", "property", "startDate", "status", "unit"]);
    expect(home.leases[0].id === activeLease.id).toBe(true);

    // Staff with no tenant link have no tenancies.
    as(ownerToken);
    expect((await (await tenancies()).json()).tenancies).toEqual([]);

    // Tenant creates a request for their own lease; the response is the tenant view.
    as(tenantToken);
    const created = await maintenanceCreate(scoped("/api/maintenance/requests", organisation.id, {
      method: "POST",
      body: JSON.stringify({ propertyId: property.id, unitId: unit.id, tenantOrganisationId: tenant.relationship.id, title: "Tap is dripping", description: "The kitchen tap drips all night", category: "plumbing" }),
    }));
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(Object.keys(createdBody).sort()).toEqual(TENANT_REQUEST_KEYS);

    const history = await tenantHistory(scoped(`/api/maintenance/tenants/${tenant.relationship.id}/history`, organisation.id), params({ tenantOrganisationId: tenant.relationship.id }));
    expect(history.status).toBe(200);
    const historyBody = await history.json();
    expect(historyBody).toHaveLength(1);
    expect(Object.keys(historyBody[0]).sort()).toEqual(TENANT_REQUEST_KEYS);

    const detail = await maintenanceDetail(scoped(`/api/maintenance/requests/${createdBody.id}`, organisation.id), params({ requestId: createdBody.id }));
    expect(detail.status).toBe(200);
    expect(Object.keys(await detail.json()).sort()).toEqual(TENANT_REQUEST_KEYS);

    // Tenants cannot use the staff list, another organisation's scope, or another tenant's link.
    expect((await maintenanceList(scoped("/api/maintenance/requests", organisation.id))).status).toBe(403);
    expect((await tenantHistory(scoped(`/api/maintenance/tenants/${tenant.relationship.id}/history`, otherOrganisation.id), params({ tenantOrganisationId: tenant.relationship.id }))).status).toBe(403);
    expect((await maintenanceDetail(scoped(`/api/maintenance/requests/${createdBody.id}`, otherOrganisation.id), params({ requestId: createdBody.id }))).status).toBe(404);
    expect((await tenantHistory(scoped(`/api/maintenance/tenants/${neighbour.relationship.id}/history`, organisation.id), params({ tenantOrganisationId: neighbour.relationship.id }))).status).toBe(403);
    // The archived link (in another organisation) is not listed and not usable.
    expect((await tenantHistory(scoped(`/api/maintenance/tenants/${archived.relationship.id}/history`, otherOrganisation.id), params({ tenantOrganisationId: archived.relationship.id }))).status).toBe(403);

    as(neighbourToken);
    expect((await maintenanceDetail(scoped(`/api/maintenance/requests/${createdBody.id}`, organisation.id), params({ requestId: createdBody.id }))).status).toBe(403);
    const impersonated = await maintenanceCreate(scoped("/api/maintenance/requests", organisation.id, {
      method: "POST",
      body: JSON.stringify({ propertyId: property.id, unitId: unit.id, tenantOrganisationId: tenant.relationship.id, title: "Not mine", description: "Should be refused", category: "other" }),
    }));
    expect(impersonated.status).toBe(403);
    expect(await db.maintenanceRequest.count()).toBe(1);
  });
});
