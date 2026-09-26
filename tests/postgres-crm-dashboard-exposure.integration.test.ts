import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The route reads the session cookie through next/headers: a controllable cookie jar lets the test
// call the real route as a given user.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

import { GET as crmDashboard } from "@/app/api/crm/dashboard/route";
import { createApplicant, createRentalApplication } from "@/modules/applications/service";
import { createProperty } from "@/modules/assets/service";
import { registerUser } from "@/modules/identity/service";
import { createListing, createMarketplaceLead, transitionListing, updateListingVerification, updateMarketplaceLead } from "@/modules/listings/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createSession } from "@/platform/auth/session";
import { db } from "@/platform/database/client";

/*
 * Regression test for GET /api/crm/dashboard returning whole `User` rows (including the password
 * hash) for lead and application assignees, plus fields the leasing dashboard never shows.
 *
 * Assertions only compare booleans and key names, so a failure never prints a user record, a
 * password hash or personal data into test output.
 */

const PASSWORD = "secure-password-123";
const READER_ROLE = "test_crm_dashboard_reader";
const ASSIGNEE_EMAIL = "dashboard-assignee@crm-exposure.test";
const PRIVATE_NOTE = "STAFF-ONLY-LEAD-NOTE";
const APPLICANT = { email: "applicant@crm-exposure.test", phone: "+233 20 999 0000", internalNotes: "STAFF-ONLY-APPLICANT-NOTE", applicantNotes: "APPLICANT-OWN-NOTE", addressLine1: "12 Private Road" };

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.role.deleteMany({ where: { key: READER_ROLE } });
}

/** A member holding one test-only role with exactly the given permissions. */
async function addMemberWithPermissions(organisationId: string, userId: string, roleKey: string, permissionKeys: string[]) {
  const permissions = await db.permission.findMany({ where: { key: { in: permissionKeys } } });
  expect(permissions.map((permission) => permission.key).sort()).toEqual([...permissionKeys].sort());
  const role = await db.role.upsert({
    where: { key: roleKey },
    update: {},
    create: { key: roleKey, name: "Test CRM dashboard reader", isSystem: false, permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) } },
  });
  const member = await db.organisationMember.create({ data: { organisationId, userId } });
  await db.membershipRole.create({ data: { memberId: member.id, roleId: role.id } });
  return member;
}

async function signInAs(userId: string) {
  jar.clear();
  await createSession(userId);
}

function dashboardRequest(organisationId: string) {
  return new Request("https://nesafric.test/api/crm/dashboard", { headers: { "x-organisation-id": organisationId } });
}

/** Every key name anywhere in a JSON value. */
function keysIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysIn(item, found));
  else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) { found.add(key); keysIn(child, found); }
  return found;
}

let fixture: { organisationId: string; readerId: string; partialReaderId: string };

describe("GET /api/crm/dashboard response exposure", () => {
  beforeAll(async () => {
    await cleanDatabase();
    const owner = await registerUser({ displayName: "Dashboard Owner", email: "dashboard-owner@crm-exposure.test", password: PASSWORD });
    const assignee = await registerUser({ displayName: "Ama Assignee", email: ASSIGNEE_EMAIL, password: PASSWORD });
    const reader = await registerUser({ displayName: "Least Privilege Reader", email: "dashboard-reader@crm-exposure.test", password: PASSWORD });
    const partialReader = await registerUser({ displayName: "Partial Reader", email: "dashboard-partial@crm-exposure.test", password: PASSWORD });
    const organisation = await createOrganisation(owner.id, { name: "Dashboard Exposure Estates", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });

    // The least privilege that can open the dashboard: exactly the three permissions it checks.
    await addMemberWithPermissions(organisation.id, reader.id, READER_ROLE, ["application.read", "listing.lead.read", "listing.viewing.read"]);
    await addMemberWithPermissions(organisation.id, partialReader.id, `${READER_ROLE}_partial`, ["application.read", "listing.lead.read"]);
    const assigneeRole = await db.role.findUniqueOrThrow({ where: { key: "property_manager" } });
    const assigneeMember = await db.organisationMember.create({ data: { organisationId: organisation.id, userId: assignee.id } });
    await db.membershipRole.create({ data: { memberId: assigneeMember.id, roleId: assigneeRole.id } });

    const property = await createProperty(owner.id, organisation.id, { name: "Exposure House", referenceNumber: "EXP-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }] });
    const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id, name: "A1" } });
    const listing = await createListing(owner.id, organisation.id, {
      propertyId: property.id, unitId: unit.id, listingType: "RENT", category: "apartment", title: "Exposure test flat",
      publicDescription: "A listing used to verify what the CRM dashboard returns.", rentAmountMinor: "250000", currencyCode: "GHS",
      frequency: "MONTHLY", availableFrom: "2026-09-01", countryCode: "GH", city: "Accra", enquiryEnabled: true,
      media: [{ type: "PHOTO", publicUrl: "https://cdn.example.com/exposure.jpg" }], amenities: [],
    });
    await updateListingVerification(owner.id, organisation.id, listing.id, { status: "PENDING", evidence: [{ type: "MANAGEMENT_AUTHORITY", privateReference: "exposure-evidence" }] });
    await updateListingVerification(owner.id, organisation.id, listing.id, { status: "VERIFIED" });
    await transitionListing(owner.id, organisation.id, listing.id, { status: "PENDING_REVIEW" });
    await transitionListing(owner.id, organisation.id, listing.id, { status: "PUBLISHED" });

    const lead = await createMarketplaceLead(listing.id, undefined, { name: "Kofi Prospect", email: "kofi@crm-exposure.test", phone: "+233 24 555 0101", message: "Is it available?" });
    await updateMarketplaceLead(owner.id, organisation.id, lead.id, { assigneeMemberId: assigneeMember.id, privateNotes: PRIVATE_NOTE });
    const applicant = await createApplicant(owner.id, organisation.id, { legalName: "Kofi Applicant", ...APPLICANT });
    await createRentalApplication(owner.id, organisation.id, { listingId: listing.id, leadId: lead.id, applicantId: applicant.id, assigneeMemberId: assigneeMember.id });

    fixture = { organisationId: organisation.id, readerId: reader.id, partialReaderId: partialReader.id };
  });

  afterAll(async () => {
    await cleanDatabase();
    await db.role.deleteMany({ where: { key: `${READER_ROLE}_partial` } });
    await db.$disconnect();
  });

  it("never returns password hashes, assignee account details, private notes or applicant personal data", async () => {
    await signInAs(fixture.readerId);
    const response = await crmDashboard(dashboardRequest(fixture.organisationId));
    expect(response.status).toBe(200);
    const body = await response.json();
    const text = JSON.stringify(body);
    const keys = keysIn(body);

    expect(keys.has("passwordHash"), "a passwordHash field is in the response").toBe(false);
    expect(text.includes("$argon2"), "a password hash value is in the response").toBe(false);
    expect(text.includes(ASSIGNEE_EMAIL), "the assignee's account email is in the response").toBe(false);
    expect(keys.has("emailVerifiedAt"), "assignee account fields are in the response").toBe(false);
    expect(text.includes(PRIVATE_NOTE), "a lead's staff-only note is in the response").toBe(false);
    for (const [field, value] of Object.entries(APPLICANT)) {
      expect(text.includes(value), `applicant ${field} is in the response`).toBe(false);
    }

    // Exactly what the website's leasing dashboard renders (src/components/leasing-dashboard.tsx).
    expect(body.recentLeads).toHaveLength(1);
    expect(Object.keys(body.recentLeads[0]).sort()).toEqual(["assignee", "email", "id", "lastActivityAt", "listing", "name", "phone", "status"]);
    expect(Object.keys(body.recentLeads[0].assignee.user)).toEqual(["displayName"]);
    // Creating the application moved the lead to APPLICATION_STARTED.
    expect(body.recentLeads[0]).toMatchObject({ name: "Kofi Prospect", status: "APPLICATION_STARTED", listing: { title: "Exposure test flat" }, assignee: { user: { displayName: "Ama Assignee" } } });

    expect(body.recentApplications).toHaveLength(1);
    expect(Object.keys(body.recentApplications[0]).sort()).toEqual(["applicant", "assignee", "id", "lastActivityAt", "listing", "status"]);
    expect(Object.keys(body.recentApplications[0].applicant).sort()).toEqual(["id", "legalName"]);
    expect(Object.keys(body.recentApplications[0].assignee.user)).toEqual(["displayName"]);
    expect(body.recentApplications[0]).toMatchObject({ applicant: { legalName: "Kofi Applicant" }, listing: { title: "Exposure test flat" }, assignee: { user: { displayName: "Ama Assignee" } } });

    expect(body.counts.leads).toMatchObject({ APPLICATION_STARTED: 1 });
    expect(Object.values(body.counts.applications as Record<string, number>).reduce((sum, count) => sum + count, 0)).toBe(1);
  });

  it("still refuses a member missing one of the dashboard's permissions, and anonymous callers", async () => {
    await signInAs(fixture.partialReaderId);
    expect((await crmDashboard(dashboardRequest(fixture.organisationId))).status).toBe(403);
    jar.clear();
    expect((await crmDashboard(dashboardRequest(fixture.organisationId))).status).toBe(401);
  });
});
