import { createHmac, randomInt } from "crypto";

import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_GROUPS = 4;
const CODE_GROUP_LENGTH = 5;
const DEFAULT_EXPIRY_DAYS = 7;

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is required for tenant access invitations.");
  return value;
}

function normaliseCode(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function hashTenantAccessCode(value: string) {
  return createHmac("sha256", secret())
    .update(`tenant-access:v1:${normaliseCode(value)}`)
    .digest("hex");
}

export function generateTenantAccessCode() {
  const groups = Array.from({ length: CODE_GROUPS }, () =>
    Array.from(
      { length: CODE_GROUP_LENGTH },
      () => CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)],
    ).join(""),
  );

  return `NT-${groups.join("-")}`;
}

function invitationStatus(invitation: {
  redeemedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}, now = new Date()) {
  if (invitation.redeemedAt) return "redeemed" as const;
  if (invitation.revokedAt) return "revoked" as const;
  if (invitation.expiresAt <= now) return "expired" as const;
  return "active" as const;
}

export async function listTenantAccessInvitations(
  userId: string,
  organisationId: string,
  tenantOrganisationId: string,
) {
  await requirePermission(userId, organisationId, PERMISSIONS.tenantRead);

  const relationship = await db.tenantOrganisation.findFirst({
    where: {
      id: tenantOrganisationId,
      organisationId,
      archivedAt: null,
    },
    select: { id: true },
  });

  if (!relationship) throw notFound();

  const invitations = await db.tenantAccessInvitation.findMany({
    where: { tenantOrganisationId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      redeemedAt: true,
      revokedAt: true,
      redeemedByUserId: true,
    },
  });

  return invitations.map((invitation) => ({
    id: invitation.id,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    redeemedAt: invitation.redeemedAt,
    revokedAt: invitation.revokedAt,
    status: invitationStatus(invitation),
  }));
}

export async function createTenantAccessInvitation(
  userId: string,
  organisationId: string,
  tenantOrganisationId: string,
) {
  await requirePermission(userId, organisationId, PERMISSIONS.tenantUpdate);

  const relationship = await db.tenantOrganisation.findFirst({
    where: {
      id: tenantOrganisationId,
      organisationId,
      archivedAt: null,
    },
    select: {
      id: true,
      userId: true,
    },
  });

  if (!relationship) throw notFound();

  if (relationship.userId) {
    throw new AppError(
      "TENANT_ALREADY_LINKED",
      409,
      "This tenant is already connected to a NesAfric account.",
    );
  }

  const rawCode = generateTenantAccessCode();
  const tokenHash = hashTenantAccessCode(rawCode);
  const expiresAt = new Date(
    Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );

  const invitation = await db.$transaction(async (tx) => {
    await tx.tenantAccessInvitation.updateMany({
      where: {
        tenantOrganisationId,
        redeemedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    const created = await tx.tenantAccessInvitation.create({
      data: {
        tenantOrganisationId,
        tokenHash,
        createdByUserId: userId,
        expiresAt,
      },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    await tx.auditEvent.create({
      data: {
        organisationId,
        actorUserId: userId,
        action: "tenant.access_invitation_created",
        entityType: "tenant",
        entityId: tenantOrganisationId,
        metadata: { invitationId: created.id, expiresAt },
      },
    });

    await tx.domainEvent.create({
      data: {
        organisationId,
        name: "tenant.access_invitation_created",
        aggregateType: "tenant",
        aggregateId: tenantOrganisationId,
        payload: { invitationId: created.id, expiresAt },
      },
    });

    return created;
  });

  return {
    invitation: {
      ...invitation,
      status: "active" as const,
    },
    code: rawCode,
  };
}

export async function revokeTenantAccessInvitation(
  userId: string,
  organisationId: string,
  tenantOrganisationId: string,
  invitationId: string,
) {
  await requirePermission(userId, organisationId, PERMISSIONS.tenantUpdate);

  return db.$transaction(async (tx) => {
    const relationship = await tx.tenantOrganisation.findFirst({
      where: {
        id: tenantOrganisationId,
        organisationId,
        archivedAt: null,
      },
      select: { id: true },
    });

    if (!relationship) throw notFound();

    const invitation = await tx.tenantAccessInvitation.findFirst({
      where: {
        id: invitationId,
        tenantOrganisationId,
      },
    });

    if (!invitation) throw notFound();

    if (invitation.redeemedAt) {
      throw new AppError(
        "TENANT_ACCESS_ALREADY_REDEEMED",
        409,
        "A redeemed tenant invitation cannot be revoked.",
      );
    }

    const revokedAt = invitation.revokedAt ?? new Date();

    const updated = await tx.tenantAccessInvitation.update({
      where: { id: invitation.id },
      data: { revokedAt },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        redeemedAt: true,
        revokedAt: true,
      },
    });

    await tx.auditEvent.create({
      data: {
        organisationId,
        actorUserId: userId,
        action: "tenant.access_invitation_revoked",
        entityType: "tenant",
        entityId: tenantOrganisationId,
        metadata: { invitationId: invitation.id },
      },
    });

    return {
      ...updated,
      status: "revoked" as const,
    };
  });
}

const INVALID_ACCESS = () =>
  new AppError(
    "TENANT_ACCESS_INVALID",
    422,
    "This tenant access code is invalid or is no longer available.",
  );

export async function validateTenantAccessCode(code: string) {
  const tokenHash = hashTenantAccessCode(code);

  const invitation = await db.tenantAccessInvitation.findUnique({
    where: { tokenHash },
    select: {
      expiresAt: true,
      redeemedAt: true,
      revokedAt: true,
      tenantOrganisation: {
        select: {
          archivedAt: true,
          userId: true,
          organisation: {
            select: { archivedAt: true },
          },
        },
      },
    },
  });

  if (
    !invitation ||
    invitation.redeemedAt ||
    invitation.revokedAt ||
    invitation.expiresAt <= new Date() ||
    invitation.tenantOrganisation.archivedAt ||
    invitation.tenantOrganisation.organisation.archivedAt ||
    invitation.tenantOrganisation.userId
  ) {
    return { valid: false as const };
  }

  return {
    valid: true as const,
    expiresAt: invitation.expiresAt,
  };
}

export async function redeemTenantAccessCode(userId: string, code: string) {
  const tokenHash = hashTenantAccessCode(code);
  const now = new Date();

  return db.$transaction(
    async (tx) => {
      const lockedInvitation = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "TenantAccessInvitation"
        WHERE "tokenHash" = ${tokenHash}
        FOR UPDATE
      `;

      if (!lockedInvitation.length) throw INVALID_ACCESS();

      const invitation = await tx.tenantAccessInvitation.findUnique({
        where: { id: lockedInvitation[0].id },
        include: {
          tenantOrganisation: {
            select: {
              id: true,
              organisationId: true,
              userId: true,
              archivedAt: true,
              organisation: {
                select: { archivedAt: true },
              },
            },
          },
        },
      });

      if (!invitation) throw INVALID_ACCESS();

      await tx.$queryRaw`
        SELECT "id"
        FROM "TenantOrganisation"
        WHERE "id" = ${invitation.tenantOrganisationId}::uuid
        FOR UPDATE
      `;

      const relationship = await tx.tenantOrganisation.findUnique({
        where: { id: invitation.tenantOrganisationId },
        select: {
          id: true,
          organisationId: true,
          userId: true,
          archivedAt: true,
          organisation: { select: { archivedAt: true } },
        },
      });

      if (!relationship) throw INVALID_ACCESS();

      if (
        invitation.redeemedAt &&
        invitation.redeemedByUserId === userId &&
        relationship.userId === userId
      ) {
        return {
          tenantOrganisationId: relationship.id,
          alreadyRedeemed: true,
        };
      }

      if (
        invitation.redeemedAt ||
        invitation.revokedAt ||
        invitation.expiresAt <= now ||
        relationship.archivedAt ||
        relationship.organisation.archivedAt
      ) {
        throw INVALID_ACCESS();
      }

      if (relationship.userId && relationship.userId !== userId) {
        throw INVALID_ACCESS();
      }

      if (relationship.userId === userId) {
        await tx.tenantAccessInvitation.update({
          where: { id: invitation.id },
          data: {
            redeemedAt: now,
            redeemedByUserId: userId,
          },
        });

        return {
          tenantOrganisationId: relationship.id,
          alreadyRedeemed: true,
        };
      }

      try {
        await tx.tenantOrganisation.update({
          where: { id: relationship.id },
          data: { userId },
        });
      } catch {
        throw new AppError(
          "TENANT_ACCOUNT_CONFLICT",
          409,
          "This account cannot be connected to that tenancy.",
        );
      }

      await tx.tenantAccessInvitation.update({
        where: { id: invitation.id },
        data: {
          redeemedAt: now,
          redeemedByUserId: userId,
        },
      });

      await tx.tenantAccessInvitation.updateMany({
        where: {
          tenantOrganisationId: relationship.id,
          id: { not: invitation.id },
          redeemedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });

      await tx.auditEvent.create({
        data: {
          organisationId: relationship.organisationId,
          actorUserId: userId,
          action: "tenant.access_invitation_redeemed",
          entityType: "tenant",
          entityId: relationship.id,
          metadata: { invitationId: invitation.id },
        },
      });

      await tx.domainEvent.create({
        data: {
          organisationId: relationship.organisationId,
          name: "tenant.access_invitation_redeemed",
          aggregateType: "tenant",
          aggregateId: relationship.id,
          payload: { invitationId: invitation.id, userId },
        },
      });

      return {
        tenantOrganisationId: relationship.id,
        alreadyRedeemed: false,
      };
    },
    { maxWait: 10_000, timeout: 10_000 },
  );
}
