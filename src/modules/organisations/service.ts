import { randomBytes, createHash } from "crypto";
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { requirePermission, PERMISSIONS } from "@/platform/authorization/permissions";
import { recordAudit } from "@/modules/audit/service";
import { publishDomainEvent } from "@/modules/events/service";
import { assertOperational, getManagementState, hasFeature } from "@/modules/entitlements/service";
import { entitlementFeatureDisabled } from "@/modules/entitlements/errors";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";
import { createOrganisationSchema, inviteMemberSchema } from "./schemas";
import {
  enqueueOnboardingCompleteEmail,
  enqueueTeamInvitationEmail,
} from "@/modules/account-emails/service";

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createOrganisation(userId: string, input: unknown, options: { skipSubscription?: boolean } = {}) {
  const data = createOrganisationSchema.parse(input);
  const country = await db.country.findUnique({ where: { code: data.countryCode } });
  if (!country?.isActive) throw new AppError("COUNTRY_UNSUPPORTED", 422, "The selected country is not supported.");
  const currencyCode = data.defaultCurrencyCode ?? country.defaultCurrencyCode;
  const currency = await db.currency.findUnique({ where: { code: currencyCode } });
  if (!currency?.isActive) throw new AppError("CURRENCY_UNSUPPORTED", 422, "The selected currency is not supported.");
  return db.$transaction(async (tx) => {
    const ownerRole = await tx.role.findUnique({ where: { key: "organisation_owner" } });
    if (!ownerRole) throw new Error("System roles have not been seeded.");
    const organisation = await tx.organisation.create({ data: { ...data, defaultCurrencyCode: currencyCode } });
    const member = await tx.organisationMember.create({ data: { userId, organisationId: organisation.id } });
    await tx.membershipRole.create({ data: { memberId: member.id, roleId: ownerRole.id } });
    await tx.auditEvent.create({ data: { organisationId: organisation.id, actorUserId: userId, action: "organisation.created", entityType: "organisation", entityId: organisation.id } });
    await tx.domainEvent.create({ data: { organisationId: organisation.id, name: "organisation.created", aggregateType: "organisation", aggregateId: organisation.id, payload: { countryCode: organisation.countryCode } } });
    // No subscription and no trial here: creating an account or organisation never starts the
    // property-management trial. It starts when property management is first used (see
    // `subscriptions/activation.ts`), so agents, sellers and marketplace-only accounts stay free.
    return organisation;
  }).then(async (organisation) => {
    // Skipped for the hidden technical-backing organisation `marketplace-professionals/service.ts`
    // creates alongside a Marketplace profile — that isn't a PropertyOS organisation the user
    // actually asked for, so it must never trigger a "your organisation is ready" email.
    if (!options.skipSubscription) await enqueueOnboardingCompleteEmail(userId, "ONBOARDING_COMPLETE_PROPERTYOS", organisation.name);
    return organisation;
  });
}
export async function listUserOrganisations(userId: string) {
  // Excludes any organisation that exists purely as a Marketplace professional's technical
  // backing store (Phase 21A item 6/11: a marketplace account must never see PropertyOS
  // management screens merely because it has a marketplace profile — see
  // `Organisation.marketplaceProfessional`'s doc comment).
  const memberships = await db.organisationMember.findMany({
    where: { userId, status: "ACTIVE", archivedAt: null, organisation: { marketplaceProfessional: null } },
    select: { organisation: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map(({ organisation }) => organisation);
}

export async function inviteMember(actorUserId: string, organisationId: string, input: unknown) {
  await requirePermission(actorUserId, organisationId, PERMISSIONS.organisationManageMembers);
  // Representative entitlement check (item 2): team seats are capped per plan and the
  // organisation must be in a writable subscription state to grow its team.
  await assertOperational(organisationId, ENTITLEMENTS.teamMembersMax.key);
  const data = inviteMemberSchema.parse(input);
  // On a management plan, inviting staff with a non-owner role is role-based staff permissions
  // (Growth and above). Marketplace-only teams are not on a management plan and are unaffected.
  if (data.roleKey !== "organisation_owner" && (await getManagementState(organisationId)).entitled && !(await hasFeature(organisationId, ENTITLEMENTS.pmStaffRolesEnabled.key))) {
    throw entitlementFeatureDisabled(ENTITLEMENTS.pmStaffRolesEnabled.key, ENTITLEMENTS.pmStaffRolesEnabled.label, true);
  }
  const role = await db.role.findUnique({ where: { key: data.roleKey } });
  if (!role) throw notFound();

  const [organisation, inviter] = await Promise.all([
    db.organisation.findUnique({
      where: { id: organisationId },
      select: { name: true },
    }),
    db.user.findUnique({
      where: { id: actorUserId },
      select: { displayName: true },
    }),
  ]);

  if (!organisation) throw notFound();

  const rawToken = randomBytes(32).toString("base64url");
  const invitation = await db.organisationInvitation.create({
    data: { organisationId, email: data.email.toLowerCase(), roleId: role.id, invitedById: actorUserId, tokenHash: tokenHash(rawToken), expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) },
  });
  await Promise.all([
    recordAudit({ organisationId, actorUserId, action: "member.invited", entityType: "organisation_invitation", entityId: invitation.id }),
    publishDomainEvent({ organisationId, name: "member.invited", aggregateType: "organisation_invitation", aggregateId: invitation.id, payload: { roleKey: role.key } }),
  ]);
  await enqueueTeamInvitationEmail({
    invitationId: invitation.id,
    recipientEmail: invitation.email,
    organisationName: organisation.name,
    inviterName: inviter?.displayName ?? "A NesAfric workspace administrator",
    roleLabel: role.name ?? role.key,
    invitationExpiresAt: invitation.expiresAt,
    invitationToken: rawToken,
  }).catch((error) => {
    // Invitation creation is authoritative; email transport failures are retried by the
    // background-job system and must never roll back the invitation itself.
    console.error("Failed to enqueue team invitation email", {
      invitationId: invitation.id,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  });

  return { invitation, token: rawToken };
}
