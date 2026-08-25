import { randomBytes, createHash } from "crypto";
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { requirePermission, PERMISSIONS } from "@/platform/authorization/permissions";
import { recordAudit } from "@/modules/audit/service";
import { publishDomainEvent } from "@/modules/events/service";
import { createOrganisationSchema, inviteMemberSchema } from "./schemas";

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createOrganisation(userId: string, input: unknown) {
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
    return organisation;
  });
}

export async function inviteMember(actorUserId: string, organisationId: string, input: unknown) {
  await requirePermission(actorUserId, organisationId, PERMISSIONS.organisationManageMembers);
  const data = inviteMemberSchema.parse(input);
  const role = await db.role.findUnique({ where: { key: data.roleKey } });
  if (!role) throw notFound();
  const rawToken = randomBytes(32).toString("base64url");
  const invitation = await db.organisationInvitation.create({
    data: { organisationId, email: data.email.toLowerCase(), roleId: role.id, invitedById: actorUserId, tokenHash: tokenHash(rawToken), expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) },
  });
  await Promise.all([
    recordAudit({ organisationId, actorUserId, action: "member.invited", entityType: "organisation_invitation", entityId: invitation.id }),
    publishDomainEvent({ organisationId, name: "member.invited", aggregateType: "organisation_invitation", aggregateId: invitation.id, payload: { roleKey: role.key } }),
  ]);
  return { invitation, token: rawToken };
}
