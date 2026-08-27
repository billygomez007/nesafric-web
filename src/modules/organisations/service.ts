import { randomBytes, createHash } from "crypto";
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { requirePermission, PERMISSIONS } from "@/platform/authorization/permissions";
import { recordAudit } from "@/modules/audit/service";
import { publishDomainEvent } from "@/modules/events/service";
import { createTrialSubscription } from "@/modules/subscriptions/lifecycle";
import { assertOperational } from "@/modules/entitlements/service";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";
import { createOrganisationSchema, inviteMemberSchema } from "./schemas";
import { enqueueOnboardingCompleteEmail } from "@/modules/account-emails/service";

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
    // Every ordinary organisation gains a subscription the moment it exists (item 1 + item 6's
    // onboarding checklist "org setup -> plan/trial"): no duplicate identity, never a second
    // signup step. `skipSubscription` exists solely for `marketplace-professionals/service.ts`,
    // which creates a hidden technical-backing organisation for a Marketplace professional
    // profile (Phase 21A item 8) — that organisation must never carry a PropertyOS management
    // subscription of its own; the professional's commercial track is a separate
    // `MarketplaceSubscription` entirely. Every ordinary caller omits `options`, so this changes
    // nothing about existing behaviour.
    if (!options.skipSubscription) await createTrialSubscription(tx, organisation.id, currencyCode);
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
