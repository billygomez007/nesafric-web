import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty, createUnit, updateUnit } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createLease } from "@/modules/leases/service";

/**
 * The server rules behind the app's native Add property / Add unit / Edit unit / Add tenant flows:
 * every write is scoped to the organisation the member belongs to and to their role's permission,
 * whatever ids the client sends.
 */

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
}

async function landlord(name: string) {
  const user = await registerUser({ displayName: name, email: `${name.toLowerCase()}-${Math.random().toString(36).slice(2)}@example.com`, password: "secure-password-123" });
  const organisation = await createOrganisation(user.id, { name: `${name} Holdings`, type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
  const property = await createProperty(user.id, organisation.id, { name: `${name} Court`, referenceNumber: `${name.toUpperCase()}-1`, category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }] });
  const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
  return { user, organisation, property, unit };
}

async function viewerOf(organisationId: string) {
  const viewer = await registerUser({ displayName: "Viewer", email: `viewer-${Math.random().toString(36).slice(2)}@example.com`, password: "secure-password-123" });
  const role = await db.role.findUniqueOrThrow({ where: { key: "viewer" } });
  const membership = await db.organisationMember.create({ data: { organisationId, userId: viewer.id } });
  await db.membershipRole.create({ data: { memberId: membership.id, roleId: role.id } });
  return viewer;
}

describe("mobile portfolio operations (server rules)", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => { await cleanDatabase(); await db.$disconnect(); });

  it("an authorised landlord adds and edits a unit, with an audit event", async () => {
    const a = await landlord("Ama");
    const created = await createUnit(a.user.id, a.organisation.id, a.property.id, { name: "B1", bedrooms: 2 });
    const updated = await updateUnit(a.user.id, a.organisation.id, a.property.id, created.id, { name: "B1 (garden)", status: "OCCUPIED", floor: null });
    expect(updated).toMatchObject({ name: "B1 (garden)", status: "OCCUPIED", bedrooms: 2, floor: null });
    expect(await db.auditEvent.count({ where: { organisationId: a.organisation.id, entityId: created.id, action: "unit.updated" } })).toBe(1);
  });

  it("never edits a unit of another organisation or another property, whatever ids are sent", async () => {
    const a = await landlord("Ama");
    const b = await landlord("Kojo");
    await expect(updateUnit(b.user.id, b.organisation.id, a.property.id, a.unit.id, { name: "Stolen" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateUnit(b.user.id, b.organisation.id, b.property.id, a.unit.id, { name: "Stolen" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateUnit(a.user.id, b.organisation.id, b.property.id, b.unit.id, { name: "Stolen" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.unit.findUniqueOrThrow({ where: { id: a.unit.id } })).name).toBe("A1");
  });

  it("a member without the permission cannot create a property, unit or tenant, or edit a unit", async () => {
    const a = await landlord("Ama");
    const viewer = await viewerOf(a.organisation.id);
    await expect(createProperty(viewer.id, a.organisation.id, { name: "Denied", referenceNumber: "NOPE-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createUnit(viewer.id, a.organisation.id, a.property.id, { name: "Denied" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateUnit(viewer.id, a.organisation.id, a.property.id, a.unit.id, { name: "Denied" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createTenant(viewer.id, a.organisation.id, { legalName: "Denied Tenant" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("places a tenant only in a property and unit of the same organisation", async () => {
    const a = await landlord("Ama");
    const b = await landlord("Kojo");
    const { relationship } = await createTenant(a.user.id, a.organisation.id, { legalName: "Efua Mensah", email: "efua@example.com" });
    const base = { referenceNumber: "LSE-1", tenantOrganisationIds: [relationship.id], startDate: "2026-10-01", rentAmountMinor: "250000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "DRAFT" };

    const lease = await createLease(a.user.id, a.organisation.id, { ...base, propertyId: a.property.id, unitId: a.unit.id });
    const party = await db.leaseParty.findFirstOrThrow({ where: { leaseId: lease.id } });
    expect(party).toMatchObject({ tenantOrganisationId: relationship.id, role: "TENANT", isPrimary: true });

    // Another organisation's property or unit, or this tenant from another organisation, is refused.
    await expect(createLease(a.user.id, a.organisation.id, { ...base, referenceNumber: "LSE-2", propertyId: b.property.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createLease(a.user.id, a.organisation.id, { ...base, referenceNumber: "LSE-3", propertyId: a.property.id, unitId: b.unit.id })).rejects.toMatchObject({ code: "INVALID_UNIT" });
    await expect(createLease(b.user.id, b.organisation.id, { ...base, referenceNumber: "LSE-4", propertyId: b.property.id })).rejects.toMatchObject({ code: "INVALID_TENANT" });
    // A new lease from the app is always a draft.
    await expect(createLease(a.user.id, a.organisation.id, { ...base, referenceNumber: "LSE-5", propertyId: a.property.id, status: "ACTIVE" })).rejects.toMatchObject({ code: "LEASE_EXECUTION_REQUIRED" });
  });

});
