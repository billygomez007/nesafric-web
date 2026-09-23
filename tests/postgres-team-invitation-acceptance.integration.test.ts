import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import {
  createOrganisation,
  inviteMember,
} from "@/modules/organisations/service";
import {
  acceptOrganisationInvitation,
  previewOrganisationInvitation,
} from "@/modules/organisations/invitations";

async function cleanDatabase() {
  await db.membershipRole.deleteMany();
  await db.organisationInvitation.deleteMany();
  await db.organisationMember.deleteMany();
  await db.subscriptionStatusHistory.deleteMany();
  await db.organisationSubscription.deleteMany();
  await db.auditEvent.deleteMany();
  await db.domainEvent.deleteMany();
  await db.organisation.deleteMany();
  await db.user.deleteMany();
}

describe("PostgreSQL team invitation acceptance", () => {
  beforeEach(cleanDatabase);
  afterAll(cleanDatabase);

  async function fixture() {
    const owner = await registerUser({
      displayName: "Ama Owner",
      email: "owner-invite@test.example",
      password: "secure-password-123",
    });

    const invitee = await registerUser({
      displayName: "Kojo Manager",
      email: "manager-invite@test.example",
      password: "secure-password-123",
    });

    const organisation = await createOrganisation(owner.id, {
      name: "Golden Coast Properties",
      type: "PROPERTY_MANAGEMENT",
      countryCode: "GH",
    });

    const invited = await inviteMember(
      owner.id,
      organisation.id,
      {
        email: invitee.email,
        roleKey: "property_manager",
      },
    );

    return {
      owner,
      invitee,
      organisation,
      invitation: invited.invitation,
      token: invited.token,
    };
  }

  it("previews safe invitation metadata without exposing the hash", async () => {
    const { token } = await fixture();

    const preview = await previewOrganisationInvitation(token);

    expect(preview.organisationName).toBe(
      "Golden Coast Properties",
    );
    expect(preview.invitedEmail).toBe(
      "manager-invite@test.example",
    );
    expect(preview.roleName).toBeTruthy();
    expect(preview).not.toHaveProperty("tokenHash");
  });

  it("accepts a valid invitation and assigns membership plus role", async () => {
    const { invitee, organisation, token } = await fixture();

    const result = await acceptOrganisationInvitation(
      invitee.id,
      token,
    );

    expect(result.accepted).toBe(true);
    expect(result.alreadyAccepted).toBe(false);

    const member = await db.organisationMember.findFirst({
      where: {
        userId: invitee.id,
        organisationId: organisation.id,
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    expect(member).not.toBeNull();
    expect(member?.status).toBe("ACTIVE");
    expect(
      member?.roles.some(
        (membershipRole) =>
          membershipRole.role.key === "property_manager",
      ),
    ).toBe(true);
  });

  it("is idempotent when the same user accepts again", async () => {
    const { invitee, organisation, token } = await fixture();

    await acceptOrganisationInvitation(invitee.id, token);
    const second = await acceptOrganisationInvitation(
      invitee.id,
      token,
    );

    expect(second.accepted).toBe(true);
    expect(second.alreadyAccepted).toBe(true);

    expect(
      await db.organisationMember.count({
        where: {
          userId: invitee.id,
          organisationId: organisation.id,
        },
      }),
    ).toBe(1);
  });

  it("rejects acceptance by a different signed-in email", async () => {
    const { token } = await fixture();

    const wrongUser = await registerUser({
      displayName: "Wrong User",
      email: "wrong-invite@test.example",
      password: "secure-password-123",
    });

    await expect(
      acceptOrganisationInvitation(wrongUser.id, token),
    ).rejects.toMatchObject({
      code: "INVITATION_EMAIL_MISMATCH",
      status: 403,
    });
  });

  it("rejects an invalid token", async () => {
    const { invitee } = await fixture();

    await expect(
      acceptOrganisationInvitation(
        invitee.id,
        "definitely-invalid-token",
      ),
    ).rejects.toMatchObject({
      code: "INVITATION_INVALID",
      status: 404,
    });
  });

  it("rejects an expired invitation", async () => {
    const {
      invitee,
      invitation,
      token,
    } = await fixture();

    await db.organisationInvitation.update({
      where: { id: invitation.id },
      data: {
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    await expect(
      acceptOrganisationInvitation(invitee.id, token),
    ).rejects.toMatchObject({
      code: "INVITATION_EXPIRED",
      status: 410,
    });
  });
});
