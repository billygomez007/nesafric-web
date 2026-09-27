import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/platform/database/client";
import {
  createTenantAccessInvitation,
  hashTenantAccessCode,
  redeemTenantAccessCode,
  validateTenantAccessCode,
} from "@/modules/tenants/access-invitations";

const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const email = (label: string) => `tenant-access-${label}-${suffix}@example.test`;

let organisationId = "";
let staffUserId = "";
let tenantUserId = "";
let secondTenantUserId = "";
let tenantOrganisationId = "";

async function createUser(label: string) {
  return db.user.create({
    data: {
      email: email(label),
      displayName: `Tenant Access ${label}`,
      passwordHash: `integration-tenant-access-${suffix}`,
    },
  });
}

beforeAll(async () => {
  const staff = await createUser("staff");
  const tenant = await createUser("tenant");
  const secondTenant = await createUser("tenant-second");

  staffUserId = staff.id;
  tenantUserId = tenant.id;
  secondTenantUserId = secondTenant.id;

  await db.country.upsert({
    where: { code: "GH" },
    update: {},
    create: {
      code: "GH",
      name: "Ghana",
      defaultCurrencyCode: "GHS",
      timezone: "Africa/Accra",
      phonePrefix: "+233",
      isActive: true,
    },
  });

  const organisation = await db.organisation.create({
    data: {
      name: `Tenant Access Integration ${suffix}`,
      type: "INDIVIDUAL_LANDLORD",
      countryCode: "GH",
      defaultCurrencyCode: "GHS",
    },
  });

  organisationId = organisation.id;

  const staffMember = await db.organisationMember.create({
    data: {
      organisationId,
      userId: staffUserId,
      status: "ACTIVE",
    },
  });

  const ownerRole = await db.role.upsert({
    where: { key: "organisation_owner" },
    update: { name: "Organisation owner" },
    create: {
      key: "organisation_owner",
      name: "Organisation owner",
      isSystem: true,
    },
  });

  await db.membershipRole.create({
    data: {
      memberId: staffMember.id,
      roleId: ownerRole.id,
    },
  });

  const tenantUpdatePermission = await db.permission.upsert({
    where: { key: "tenant.update" },
    update: { description: "Update tenant records" },
    create: {
      key: "tenant.update",
      description: "Update tenant records",
    },
  });

  await db.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: ownerRole.id,
        permissionId: tenantUpdatePermission.id,
      },
    },
    update: {},
    create: {
      roleId: ownerRole.id,
      permissionId: tenantUpdatePermission.id,
    },
  });

  const tenantRecord = await db.tenant.create({
    data: {
      legalName: "Integration Tenant",
    },
  });

  const tenantOrganisation = await db.tenantOrganisation.create({
    data: {
      organisationId,
      tenantId: tenantRecord.id,
      email: email("organisation"),
      countryCode: "GH",
    },
  });

  tenantOrganisationId = tenantOrganisation.id;
});

afterAll(async () => {
  if (organisationId) {
    await db.tenantAccessInvitation.deleteMany({
      where: {
        tenantOrganisation: {
          organisationId,
        },
      },
    }).catch(() => undefined);

    const tenantRelationships = await db.tenantOrganisation.findMany({
      where: { organisationId },
      select: { tenantId: true },
    }).catch(() => []);

    await db.tenantOrganisation.deleteMany({
      where: { organisationId },
    }).catch(() => undefined);

    const tenantIds = tenantRelationships.map((relationship) => relationship.tenantId);

    if (tenantIds.length > 0) {
      await db.tenant.deleteMany({
        where: {
          id: {
            in: tenantIds,
          },
        },
      }).catch(() => undefined);
    }

    await db.organisationMember.deleteMany({
      where: { organisationId },
    }).catch(() => undefined);

    /*
     * Tenant access creation/redemption records organisation-scoped
     * domain and audit events. Remove only this integration fixture's
     * events before deleting its organisation so the real foreign-key
     * protections remain intact.
     */
    await db.domainEvent.deleteMany({
      where: { organisationId },
    }).catch(() => undefined);

    await db.auditEvent.deleteMany({
      where: { organisationId },
    }).catch(() => undefined);

    await db.organisation.delete({
      where: { id: organisationId },
    }).catch(() => undefined);
  }

  await db.user.deleteMany({
    where: {
      email: {
        endsWith: `-${suffix}@example.test`,
      },
    },
  }).catch(() => undefined);

  await db.$disconnect();
});

describe("tenant access invitation — PostgreSQL integration", () => {
  it("stores only the hash and validates a live invitation", async () => {
    const invitation = await createTenantAccessInvitation(
      staffUserId,
      organisationId,
      tenantOrganisationId,
    );

    expect(invitation.code).toBeTruthy();

    const stored = await db.tenantAccessInvitation.findUniqueOrThrow({
      where: { id: invitation.invitation.id },
    });

    expect(stored.tokenHash).toBe(hashTenantAccessCode(invitation.code));
    expect(stored.tokenHash).not.toBe(invitation.code);

    const validation = await validateTenantAccessCode(invitation.code);

    expect(validation.valid).toBe(true);
  });

  it("atomically links the existing TenantOrganisation.userId and redeems the invitation", async () => {
    await db.tenantOrganisation.update({
      where: { id: tenantOrganisationId },
      data: { userId: null },
    });

    const invitation = await createTenantAccessInvitation(
      staffUserId,
      organisationId,
      tenantOrganisationId,
    );

    const redeemed = await redeemTenantAccessCode(
      tenantUserId,
      invitation.code,
    );

    expect(redeemed.tenantOrganisationId).toBe(tenantOrganisationId);

    const linked = await db.tenantOrganisation.findUniqueOrThrow({
      where: { id: tenantOrganisationId },
    });

    expect(linked.userId).toBe(tenantUserId);

    const stored = await db.tenantAccessInvitation.findUniqueOrThrow({
      where: { id: invitation.invitation.id },
    });

    expect(stored.redeemedAt).not.toBeNull();
    expect(stored.redeemedByUserId).toBe(tenantUserId);
  });

  it("rejects reuse of a redeemed invitation by another account", async () => {
    await db.tenantOrganisation.update({
      where: { id: tenantOrganisationId },
      data: { userId: null },
    });

    const invitation = await createTenantAccessInvitation(
      staffUserId,
      organisationId,
      tenantOrganisationId,
    );

    await redeemTenantAccessCode(tenantUserId, invitation.code);

    await expect(
      redeemTenantAccessCode(secondTenantUserId, invitation.code),
    ).rejects.toBeTruthy();

    const linked = await db.tenantOrganisation.findUniqueOrThrow({
      where: { id: tenantOrganisationId },
    });

    expect(linked.userId).toBe(tenantUserId);
  });

  it("revokes older live invitations when a replacement is created", async () => {
    await db.tenantOrganisation.update({
      where: { id: tenantOrganisationId },
      data: { userId: null },
    });

    const first = await createTenantAccessInvitation(
      staffUserId,
      organisationId,
      tenantOrganisationId,
    );

    const second = await createTenantAccessInvitation(
      staffUserId,
      organisationId,
      tenantOrganisationId,
    );

    const firstStored = await db.tenantAccessInvitation.findUniqueOrThrow({
      where: { id: first.invitation.id },
    });

    const secondStored = await db.tenantAccessInvitation.findUniqueOrThrow({
      where: { id: second.invitation.id },
    });

    expect(firstStored.revokedAt).not.toBeNull();
    expect(secondStored.revokedAt).toBeNull();

    await expect(
      redeemTenantAccessCode(tenantUserId, first.code),
    ).rejects.toBeTruthy();

    await redeemTenantAccessCode(tenantUserId, second.code);

    const linked = await db.tenantOrganisation.findUniqueOrThrow({
      where: { id: tenantOrganisationId },
    });

    expect(linked.userId).toBe(tenantUserId);
  });

  it("allows only one winner when two accounts race to redeem the same code", async () => {
    await db.tenantOrganisation.update({
      where: { id: tenantOrganisationId },
      data: { userId: null },
    });

    const invitation = await createTenantAccessInvitation(
      staffUserId,
      organisationId,
      tenantOrganisationId,
    );

    const results = await Promise.allSettled([
      redeemTenantAccessCode(tenantUserId, invitation.code),
      redeemTenantAccessCode(secondTenantUserId, invitation.code),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const linked = await db.tenantOrganisation.findUniqueOrThrow({
      where: { id: tenantOrganisationId },
    });

    expect([tenantUserId, secondTenantUserId]).toContain(linked.userId);

    const stored = await db.tenantAccessInvitation.findUniqueOrThrow({
      where: { id: invitation.invitation.id },
    });

    expect(stored.redeemedAt).not.toBeNull();
    expect(stored.redeemedByUserId).toBe(linked.userId);
  });
});
