import { createHash } from "crypto";
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const normalizeEmail = (value: string) => value.trim().toLowerCase();

export async function previewOrganisationInvitation(rawToken: string) {
  if (!rawToken) {
    throw new AppError(
      "INVITATION_INVALID",
      404,
      "This invitation link is invalid.",
    );
  }

  const invitation = await db.organisationInvitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      email: true,
      status: true,
      expiresAt: true,
      organisation: {
        select: {
          name: true,
        },
      },
      role: {
        select: {
          name: true,
          key: true,
        },
      },
      invitedBy: {
        select: {
          displayName: true,
        },
      },
    },
  });

  if (!invitation) {
    throw notFound();
  }

  const expired = invitation.expiresAt.getTime() <= Date.now();

  return {
    organisationName: invitation.organisation.name,
    invitedEmail: invitation.email,
    inviterName:
      invitation.invitedBy.displayName ??
      "A NesAfric workspace administrator",
    roleName: invitation.role.name ?? invitation.role.key,
    status: expired ? "EXPIRED" : invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

export async function acceptOrganisationInvitation(
  userId: string,
  rawToken: string,
) {
  if (!rawToken) {
    throw new AppError(
      "INVITATION_INVALID",
      404,
      "This invitation link is invalid.",
    );
  }

  const tokenHash = hashToken(rawToken);

  return db.$transaction(async (tx) => {
    const invitation = await tx.organisationInvitation.findUnique({
      where: { tokenHash },
      include: {
        organisation: {
          select: {
            id: true,
            name: true,
          },
        },
        role: {
          select: {
            id: true,
            key: true,
            name: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new AppError(
        "INVITATION_INVALID",
        404,
        "This invitation link is invalid.",
      );
    }

    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw new AppError(
        "INVITATION_EXPIRED",
        410,
        "This invitation has expired.",
      );
    }

    if (invitation.status === "REVOKED") {
      throw new AppError(
        "INVITATION_REVOKED",
        410,
        "This invitation is no longer active.",
      );
    }

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
      },
    });

    if (!user) {
      throw new AppError(
        "UNAUTHENTICATED",
        401,
        "Please sign in to accept this invitation.",
      );
    }

    // Team invitations are addressed to an email: a phone-only account must add and verify that
    // email first (it is then this same account), never accept on someone else's address.
    if (!user.email) {
      throw new AppError(
        "INVITATION_EMAIL_REQUIRED",
        403,
        "This invitation was sent to an email address. Add and verify that email on your account, then open the invitation again.",
      );
    }

    if (normalizeEmail(user.email) !== normalizeEmail(invitation.email)) {
      throw new AppError(
        "INVITATION_EMAIL_MISMATCH",
        403,
        "This invitation was sent to a different email address.",
      );
    }

    let member = await tx.organisationMember.findFirst({
      where: {
        userId,
        organisationId: invitation.organisationId,
      },
    });

    if (!member) {
      member = await tx.organisationMember.create({
        data: {
          userId,
          organisationId: invitation.organisationId,
          status: "ACTIVE",
        },
      });
    } else if (member.status !== "ACTIVE" || member.archivedAt) {
      member = await tx.organisationMember.update({
        where: { id: member.id },
        data: {
          status: "ACTIVE",
          archivedAt: null,
        },
      });
    }

    await tx.membershipRole.upsert({
      where: {
        memberId_roleId: {
          memberId: member.id,
          roleId: invitation.roleId,
        },
      },
      update: {},
      create: {
        memberId: member.id,
        roleId: invitation.roleId,
      },
    });

    const alreadyAccepted = invitation.status === "ACCEPTED";

    if (!alreadyAccepted) {
      await tx.organisationInvitation.update({
        where: { id: invitation.id },
        data: {
          status: "ACCEPTED",
        },
      });

      await tx.auditEvent.create({
        data: {
          organisationId: invitation.organisationId,
          actorUserId: userId,
          action: "member.invitation.accepted",
          entityType: "organisation_invitation",
          entityId: invitation.id,
        },
      });

      await tx.domainEvent.create({
        data: {
          organisationId: invitation.organisationId,
          name: "member.invitation.accepted",
          aggregateType: "organisation_invitation",
          aggregateId: invitation.id,
          payload: {
            userId,
            roleKey: invitation.role.key,
          },
        },
      });
    }

    return {
      accepted: true,
      alreadyAccepted,
      organisationId: invitation.organisation.id,
      organisationName: invitation.organisation.name,
      roleName: invitation.role.name ?? invitation.role.key,
    };
  });
}
