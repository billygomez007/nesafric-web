import { z } from "zod";
import { db } from "@/platform/database/client";
import { Prisma } from "@/platform/database/generated/client";
import { AppError, notFound } from "@/platform/errors";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { normalizePhone } from "@/platform/identity/phone";
import { listOwnedProviders, uniqueProviderSlug } from "@/modules/providers/service";
import { queueOfficialTemplate, safeTemplateText } from "@/modules/whatsapp-assistant/outbound";
import { categoryLabels, NETWORK_CATEGORIES, NETWORK_CATEGORY_KEYS, type NetworkCategory } from "./categories";

type Tx = Prisma.TransactionClient;
const INVITATION_DAYS = 14;

const uuid = z.string().uuid();
const minor = z.string().regex(/^\d{1,15}$/);
const settings = {
  scopeCategories: z.array(z.enum(NETWORK_CATEGORY_KEYS as [NetworkCategory, ...NetworkCategory[]])).min(1).max(10),
  /** Empty = all of the organisation's properties. */
  propertyIds: z.array(uuid).max(200).default([]),
  autoDispatchAllowed: z.boolean().default(false),
  spendingLimitMinor: minor.nullable().default(null),
  emergencyCallouts: z.boolean().default(false),
  workingHours: z.string().trim().max(200).optional(),
  paymentTerms: z.string().trim().max(500).optional(),
};
export const inviteProviderSchema = z.object({
  displayName: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(32),
  existingProviderId: uuid.optional(),
  source: z.enum(["WHATSAPP", "WEB", "ONBOARDING"]).default("WEB"),
  sourceReference: z.string().max(200).optional(),
  ...settings,
}).strict();
export const updateNetworkProviderSchema = z.object({
  scopeCategories: settings.scopeCategories.optional(),
  propertyIds: settings.propertyIds.optional(),
  autoDispatchAllowed: z.boolean().optional(),
  spendingLimitMinor: minor.nullable().optional(),
  emergencyCallouts: z.boolean().optional(),
  workingHours: z.string().trim().max(200).nullable().optional(),
  paymentTerms: z.string().trim().max(500).nullable().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  isBackup: z.boolean().optional(),
  /** ACTIVE = resume, BLOCKED = suspend, ARCHIVED = remove from the network. */
  status: z.enum(["ACTIVE", "BLOCKED", "ARCHIVED"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one change is required.");

async function record(tx: Tx, organisationId: string, actorUserId: string | null, action: string, entityId: string, metadata: Record<string, unknown>) {
  await tx.auditEvent.create({ data: { organisationId, actorUserId, action, entityType: "provider_network", entityId, metadata: JSON.parse(JSON.stringify(metadata)) } });
  await tx.domainEvent.create({ data: { organisationId, name: action, aggregateType: "provider_network", aggregateId: entityId, payload: JSON.parse(JSON.stringify(metadata)) } });
}

async function assertOwnProperties(client: Tx | typeof db, organisationId: string, propertyIds: string[]) {
  if (!propertyIds.length) return;
  const count = await client.property.count({ where: { id: { in: propertyIds }, organisationId, archivedAt: null } });
  if (count !== new Set(propertyIds).size) throw new AppError("INVALID_PROPERTY", 422, "Every property must belong to this organisation.");
}

const serialize = <T extends { spendingLimitMinor: bigint | null }>(row: T) => ({ ...row, spendingLimitMinor: row.spendingLimitMinor?.toString() ?? null });

/**
 * Invites a maintenance professional into the organisation's private network. Nothing is created
 * for the provider and no work is ever sent until they accept from the invited number. Inviting
 * the same number again while an invitation is pending updates that invitation instead.
 */
export async function inviteNetworkProvider(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.providerManage);
  const data = inviteProviderSchema.parse(input);
  const phoneE164 = normalizePhone(data.phone);
  if (!phoneE164) throw new AppError("INVALID_PHONE", 422, "Enter a valid mobile number for the provider.");
  await assertOwnProperties(db, organisationId, data.propertyIds);
  if (data.existingProviderId) {
    const provider = await db.serviceProvider.findFirst({ where: { id: data.existingProviderId, archivedAt: null, suspendedAt: null }, include: { individualUser: { select: { phoneE164: true } } } });
    if (!provider) throw notFound();
    // Only a number that already belongs to the provider may accept for it.
    const known = [provider.contactPhone ? normalizePhone(provider.contactPhone) : null, provider.individualUser?.phoneE164 ?? null];
    if (!known.includes(phoneE164)) throw new AppError("PROVIDER_PHONE_MISMATCH", 422, "Invite a marketplace provider on the phone number shown on their profile.");
  }
  // Invitations go out from the official NesAfric number, so they are limited: a number that
  // declined is not asked again for 30 days, and an organisation can send 20 invitations a day.
  if (!data.sourceReference || data.source !== "ONBOARDING") {
    const declined = await db.providerNetworkInvitation.findFirst({ where: { landlordOrganisationId: organisationId, phoneE164, status: "DECLINED", respondedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, select: { id: true } });
    if (declined) throw new AppError("RECENTLY_DECLINED", 409, "This person declined your invitation recently. You can invite them again after 30 days.");
  }
  if (await db.providerNetworkInvitation.count({ where: { landlordOrganisationId: organisationId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } }) >= 20) {
    throw new AppError("INVITATION_LIMIT", 429, "You can send up to 20 provider invitations a day.");
  }
  const member = await db.providerOrganisation.findFirst({
    where: { landlordOrganisationId: organisationId, status: { not: "ARCHIVED" }, consentedAt: { not: null }, provider: { OR: [{ contactPhone: phoneE164 }, { individualUser: { phoneE164 } }] } },
    select: { id: true },
  });
  if (member) throw new AppError("ALREADY_IN_NETWORK", 409, "This number already belongs to a provider in your network.");

  const fields = {
    displayName: data.displayName, phoneE164, existingProviderId: data.existingProviderId, scopeCategories: data.scopeCategories, propertyIds: data.propertyIds,
    autoDispatchAllowed: data.autoDispatchAllowed, spendingLimitMinor: data.spendingLimitMinor === null ? null : BigInt(data.spendingLimitMinor),
    emergencyCallouts: data.emergencyCallouts, workingHours: data.workingHours, paymentTerms: data.paymentTerms,
    expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
  };
  const invitation = await db.$transaction(async (tx) => {
    const existing = data.sourceReference
      ? await tx.providerNetworkInvitation.findUnique({ where: { sourceReference: data.sourceReference } })
      : await tx.providerNetworkInvitation.findFirst({ where: { landlordOrganisationId: organisationId, phoneE164, status: "PENDING" } });
    if (existing && existing.status !== "PENDING") return existing;
    const saved = existing
      ? await tx.providerNetworkInvitation.update({ where: { id: existing.id }, data: fields })
      : await tx.providerNetworkInvitation.create({ data: { ...fields, landlordOrganisationId: organisationId, invitedByUserId: userId, source: data.source, sourceReference: data.sourceReference } });
    if (!existing) await record(tx, organisationId, userId, "provider_network.invited", saved.id, { categories: data.scopeCategories, properties: data.propertyIds.length || "all", autoDispatchAllowed: data.autoDispatchAllowed, spendingLimitMinor: data.spendingLimitMinor });
    return saved;
  });
  if (invitation.status === "PENDING" && !invitation.messageId) await sendInvitation(invitation.id);
  return serialize(await db.providerNetworkInvitation.findUniqueOrThrow({ where: { id: invitation.id } }));
}

/**
 * Queues the invitation on the official WhatsApp number. It is business-initiated, so it needs the
 * approved PROVIDER_INVITE template; without one nothing is sent and the reason is kept on the
 * invitation for the landlord to see.
 */
async function sendInvitation(invitationId: string) {
  const invitation = await db.providerNetworkInvitation.findUniqueOrThrow({ where: { id: invitationId }, include: { landlordOrganisation: { select: { name: true } } } });
  const work = categoryLabels(invitation.scopeCategories);
  await db.$transaction(async (tx) => {
    const queued = await queueOfficialTemplate(tx, {
      phoneE164: invitation.phoneE164, displayName: invitation.displayName, template: "PROVIDER_INVITE", bodyParameters: [safeTemplateText(invitation.landlordOrganisation.name), work],
      body: `${safeTemplateText(invitation.landlordOrganisation.name)} invites you to receive ${work} work orders through NesAfric. Reply ACCEPT to join or DECLINE to refuse.`,
      externalMessageId: `provider-invite:${invitation.id}`, metadata: { providerInvitationId: invitation.id },
    });
    await tx.providerNetworkInvitation.update({ where: { id: invitation.id }, data: "reason" in queued ? { deliveryFailureReason: queued.reason } : { messageId: queued.messageId, deliveryFailureReason: null } });
  });
}

/** Pending, unexpired invitations addressed to this number. */
export async function pendingInvitationsFor(phoneE164: string) {
  await db.providerNetworkInvitation.updateMany({ where: { phoneE164, status: "PENDING", expiresAt: { lt: new Date() } }, data: { status: "EXPIRED" } });
  return db.providerNetworkInvitation.findMany({ where: { phoneE164, status: "PENDING" }, include: { landlordOrganisation: { select: { name: true } } }, orderBy: { createdAt: "asc" }, take: 9 });
}

/**
 * The invited person answers from the invited number. Accepting creates (or reuses) their
 * account and provider profile, then the directory entry with the consent and the scope the
 * landlord proposed. The provider never sees anything else about the portfolio.
 */
export async function respondToInvitation(invitationId: string, fromPhoneE164: string, accept: boolean) {
  return db.$transaction(async (tx) => {
    const invitation = await tx.providerNetworkInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation || invitation.phoneE164 !== fromPhoneE164) throw notFound();
    if (invitation.status !== "PENDING" || invitation.expiresAt < new Date()) throw new AppError("INVITATION_CLOSED", 409, "This invitation is no longer open.");
    const now = new Date();
    if (!accept) {
      const declined = await tx.providerNetworkInvitation.update({ where: { id: invitation.id }, data: { status: "DECLINED", respondedAt: now } });
      await record(tx, invitation.landlordOrganisationId, null, "provider_network.declined", invitation.id, {});
      return { invitation: declined, providerOrganisationId: null };
    }

    let providerId = invitation.existingProviderId;
    let userId: string | null = null;
    if (!providerId) {
      const user = await tx.user.findUnique({ where: { phoneE164: invitation.phoneE164 } })
        ?? await tx.user.create({ data: { phoneE164: invitation.phoneE164, displayName: invitation.displayName } });
      userId = user.id;
      const owned = await tx.serviceProvider.findFirst({ where: { individualUserId: user.id, archivedAt: null } });
      if (owned) {
        providerId = owned.id;
      } else {
        const keys = invitation.scopeCategories.map((key) => NETWORK_CATEGORIES[key as NetworkCategory]?.serviceCategoryKey).filter((key): key is NonNullable<typeof key> => Boolean(key));
        const categories = await tx.serviceCategory.findMany({ where: { key: { in: keys } }, select: { id: true } });
        providerId = (await tx.serviceProvider.create({
          data: {
            type: "INDIVIDUAL", individualUserId: user.id, administratorUserId: user.id, displayName: invitation.displayName, slug: await uniqueProviderSlug(tx, invitation.displayName),
            contactPhone: invitation.phoneE164, contactReady: true, acceptingWork: true, availabilityStatus: "AVAILABLE",
            categories: { create: categories.map(({ id }) => ({ categoryId: id })) },
          },
        })).id;
      }
    }
    if (userId) {
      // Link the number to the account only if it is not linked to someone else already.
      const identity = await tx.channelIdentity.findUnique({ where: { channel_address: { channel: "WHATSAPP", address: invitation.phoneE164 } } });
      if (!identity?.userId) await tx.channelIdentity.upsert({ where: { channel_address: { channel: "WHATSAPP", address: invitation.phoneE164 } }, update: { userId, verifiedAt: now, verificationMethod: "WHATSAPP_REPLY" }, create: { channel: "WHATSAPP", address: invitation.phoneE164, userId, verifiedAt: now, verificationMethod: "WHATSAPP_REPLY" } });
    }
    const terms = {
      status: "ACTIVE" as const, consentedAt: now, consentMethod: "WHATSAPP_REPLY", scopeCategories: invitation.scopeCategories, allPropertiesScope: invitation.propertyIds.length === 0,
      autoDispatchAllowed: invitation.autoDispatchAllowed, spendingLimitMinor: invitation.spendingLimitMinor, emergencyCallouts: invitation.emergencyCallouts, workingHours: invitation.workingHours, paymentTerms: invitation.paymentTerms,
    };
    const entry = await tx.providerOrganisation.upsert({
      where: { landlordOrganisationId_providerId: { landlordOrganisationId: invitation.landlordOrganisationId, providerId } },
      update: terms,
      create: { ...terms, landlordOrganisationId: invitation.landlordOrganisationId, providerId, createdByUserId: invitation.invitedByUserId },
    });
    await tx.providerPropertyScope.deleteMany({ where: { providerOrganisationId: entry.id } });
    if (invitation.propertyIds.length) {
      const live = await tx.property.findMany({ where: { id: { in: invitation.propertyIds }, organisationId: invitation.landlordOrganisationId, archivedAt: null }, select: { id: true } });
      await tx.providerPropertyScope.createMany({ data: live.map(({ id }) => ({ providerOrganisationId: entry.id, propertyId: id })) });
    }
    const accepted = await tx.providerNetworkInvitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED", respondedAt: now, providerOrganisationId: entry.id } });
    await record(tx, invitation.landlordOrganisationId, userId, "provider_network.accepted", entry.id, { invitationId: invitation.id, providerId, categories: invitation.scopeCategories });
    return { invitation: accepted, providerOrganisationId: entry.id };
  });
}

/** The organisation's network: consented members, entries without consent, and open invitations. */
export async function listNetwork(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.providerRead);
  const [entries, invitations] = await Promise.all([
    db.providerOrganisation.findMany({
      where: { landlordOrganisationId: organisationId, status: { not: "ARCHIVED" } },
      include: { provider: { select: { id: true, displayName: true, contactPhone: true } }, propertyScopes: { select: { propertyId: true } } },
      orderBy: [{ createdAt: "asc" }],
    }),
    db.providerNetworkInvitation.findMany({ where: { landlordOrganisationId: organisationId, status: "PENDING" }, orderBy: { createdAt: "asc" } }),
  ]);
  return { entries: entries.map(serialize), invitations: invitations.map(serialize) };
}

/**
 * Landlord changes to a network member: scope, dispatch and spending settings, suspend (BLOCKED),
 * resume (ACTIVE) or remove (ARCHIVED). Before and after values are audited. Removing or
 * suspending never touches existing jobs or history.
 */
export async function updateNetworkProvider(userId: string, organisationId: string, providerOrganisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.providerManage);
  const data = updateNetworkProviderSchema.parse(input);
  return db.$transaction(async (tx) => {
    const current = await tx.providerOrganisation.findFirst({ where: { id: providerOrganisationId, landlordOrganisationId: organisationId }, include: { propertyScopes: true } });
    if (!current) throw notFound();
    if (data.status === "ACTIVE" && !current.consentedAt) throw new AppError("CONSENT_REQUIRED", 409, "This provider has not agreed to join your network. Send them an invitation.");
    if (data.propertyIds) await assertOwnProperties(tx, organisationId, data.propertyIds);
    const { propertyIds, spendingLimitMinor, ...fields } = data;
    const updated = await tx.providerOrganisation.update({
      where: { id: current.id },
      data: { ...fields, ...(spendingLimitMinor !== undefined ? { spendingLimitMinor: spendingLimitMinor === null ? null : BigInt(spendingLimitMinor) } : {}), ...(propertyIds ? { allPropertiesScope: propertyIds.length === 0 } : {}) },
    });
    if (propertyIds) {
      await tx.providerPropertyScope.deleteMany({ where: { providerOrganisationId: current.id } });
      if (propertyIds.length) await tx.providerPropertyScope.createMany({ data: propertyIds.map((propertyId) => ({ providerOrganisationId: current.id, propertyId })) });
    }
    const action = data.status === "BLOCKED" ? "provider_network.suspended" : data.status === "ARCHIVED" ? "provider_network.removed" : data.status === "ACTIVE" && current.status !== "ACTIVE" ? "provider_network.resumed" : "provider_network.updated";
    await record(tx, organisationId, userId, action, current.id, {
      before: { status: current.status, scopeCategories: current.scopeCategories, propertyIds: current.allPropertiesScope ? "all" : current.propertyScopes.map((scope) => scope.propertyId), autoDispatchAllowed: current.autoDispatchAllowed, spendingLimitMinor: current.spendingLimitMinor?.toString() ?? null },
      after: { status: updated.status, scopeCategories: updated.scopeCategories, propertyIds: propertyIds ?? "unchanged", autoDispatchAllowed: updated.autoDispatchAllowed, spendingLimitMinor: updated.spendingLimitMinor?.toString() ?? null },
    });
    return serialize(updated);
  });
}

/**
 * Moves work categories (and optionally properties) from one member to another, for example
 * before removing a provider. The receiving provider must have consented and be active.
 */
export async function reassignNetworkScope(userId: string, organisationId: string, fromId: string, toId: string, input: unknown = {}) {
  await requirePermission(userId, organisationId, PERMISSIONS.providerManage);
  const data = z.object({ categories: settings.scopeCategories.optional() }).strict().parse(input);
  return db.$transaction(async (tx) => {
    const [from, to] = await Promise.all([
      tx.providerOrganisation.findFirst({ where: { id: fromId, landlordOrganisationId: organisationId }, include: { propertyScopes: true } }),
      tx.providerOrganisation.findFirst({ where: { id: toId, landlordOrganisationId: organisationId }, include: { propertyScopes: true } }),
    ]);
    if (!from || !to || from.id === to.id) throw notFound();
    if (to.status !== "ACTIVE" || !to.consentedAt) throw new AppError("CONSENT_REQUIRED", 409, "The receiving provider must be an active member who has agreed to join your network.");
    const moving = data.categories ?? from.scopeCategories;
    await tx.providerOrganisation.update({ where: { id: from.id }, data: { scopeCategories: from.scopeCategories.filter((key) => !moving.includes(key)) } });
    await tx.providerOrganisation.update({ where: { id: to.id }, data: { scopeCategories: [...new Set([...to.scopeCategories, ...moving])] } });
    // The receiver covers the properties the previous provider covered for this work.
    if (!to.allPropertiesScope) {
      if (from.allPropertiesScope) {
        await tx.providerOrganisation.update({ where: { id: to.id }, data: { allPropertiesScope: true } });
        await tx.providerPropertyScope.deleteMany({ where: { providerOrganisationId: to.id } });
      } else {
        await tx.providerPropertyScope.createMany({ data: from.propertyScopes.map((scope) => ({ providerOrganisationId: to.id, propertyId: scope.propertyId })), skipDuplicates: true });
      }
    }
    await record(tx, organisationId, userId, "provider_network.reassigned", from.id, { toProviderOrganisationId: to.id, categories: moving });
    return { moved: moving };
  });
}

export async function revokeInvitation(userId: string, organisationId: string, invitationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.providerManage);
  return db.$transaction(async (tx) => {
    const updated = await tx.providerNetworkInvitation.updateMany({ where: { id: invitationId, landlordOrganisationId: organisationId, status: "PENDING" }, data: { status: "REVOKED", respondedAt: new Date() } });
    if (!updated.count) throw notFound();
    await record(tx, organisationId, userId, "provider_network.invitation_revoked", invitationId, {});
  });
}

/**
 * Providers that may be sent a job automatically for this organisation, category and property:
 * active, consented, allowed to receive automatic dispatch, in scope, and not suspended or removed
 * by the platform. Backups come after primaries, then by priority. Callers still check spending.
 */
export async function eligibleNetworkProviders(organisationId: string, input: { category: NetworkCategory; propertyId: string }) {
  const entries = await db.providerOrganisation.findMany({
    where: {
      landlordOrganisationId: organisationId, status: "ACTIVE", consentedAt: { not: null }, autoDispatchAllowed: true, scopeCategories: { has: input.category },
      OR: [{ allPropertiesScope: true }, { propertyScopes: { some: { propertyId: input.propertyId } } }],
      provider: { archivedAt: null, suspendedAt: null },
    },
    include: { provider: { select: { id: true, displayName: true, contactPhone: true } } },
    orderBy: [{ isBackup: "asc" }, { priority: "asc" }, { consentedAt: "asc" }],
  });
  return entries.map(serialize);
}

/**
 * Jobs assigned to the providers this user owns, with only what is needed to do the work:
 * the work order, the property and the unit. No tenant, lease or financial data.
 */
export async function providerJobsForUser(userId: string) {
  const providers = await listOwnedProviders(userId);
  if (!providers.length) return { providers: [], jobs: [] };
  const assignments = await db.providerAssignment.findMany({
    where: { providerId: { in: providers.map((provider) => provider.id) }, status: { in: ["PENDING", "ACCEPTED"] } },
    select: { id: true, status: true, assignedAt: true, expectedStartAt: true, landlordOrganisation: { select: { name: true } }, workOrder: { select: { title: true, maintenanceRequest: { select: { priority: true } }, property: { select: { name: true } }, unit: { select: { name: true } } } } },
    orderBy: { assignedAt: "desc" },
    take: 10,
  });
  return { providers, jobs: assignments };
}
