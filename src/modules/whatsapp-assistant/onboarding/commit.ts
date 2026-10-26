import { db } from "@/platform/database/client";
import { Prisma } from "@/platform/database/generated/client";
import { AppError } from "@/platform/errors";
import { createOrganisation } from "@/modules/organisations/service";
import { createBuilding, createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createTenantAccessInvitation } from "@/modules/tenants/access-invitations";
import { createLease } from "@/modules/leases/service";
import { createReminderPolicy } from "@/modules/reminders/service";
import { inviteNetworkProvider } from "@/modules/provider-network/service";
import { parseNetworkCategory } from "@/modules/provider-network/categories";
import { onboardingDataSchema, type Draft, type OnboardingData } from "./draft";

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

export type CommitSummary = { organisationId: string; organisationName: string; properties: number; units: number; tenants: number; draftLeases: number; invitations: Array<{ label: string; code: string }>; invitationProblems: number; reminders: boolean; pendingVerifications: number; providersInvited: number; providerInviteProblem: string | null; plan?: { status: string; trialEndsAt: Date | null } };

/** Deterministic per-draft references, so a retried commit finds what it already created. */
export const draftReference = (draftId: string) => `WA-${draftId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

/**
 * Saves a confirmed draft through the ordinary domain services, so every permission, entitlement
 * limit, audit event and domain event applies exactly as on the web. Each created record is
 * written back to the draft before the next one, and each step first looks for the record by its
 * deterministic reference: a crash or retry resumes without duplicates.
 *
 * Leases are created as DRAFT: the existing execution rules still decide when one becomes active.
 * Tenants the landlord confirmed live there now (`inviteTenants`) are invited: once a tenant
 * redeems the code, they can report repairs on a started draft tenancy (`reportableLease`).
 * Ownership or authority is recorded as a PENDING claim per property, never as verified.
 */
export async function commitDraft(draft: Draft, userId: string): Promise<CommitSummary> {
  const claimed = await db.onboardingDraft.updateMany({ where: { id: draft.id, status: { in: ["IN_PROGRESS", "COMMITTING"] } }, data: { status: "COMMITTING", userId } });
  if (!claimed.count) throw new AppError("ONBOARDING_ALREADY_SAVED", 409, "This onboarding has already been saved.");
  const data: OnboardingData = onboardingDataSchema.parse(draft.data);
  const reference = draftReference(draft.id);
  const progress = async () => { await db.onboardingDraft.update({ where: { id: draft.id }, data: { data: json(data), organisationId: data.committed.organisationId } }); };

  try {
    // 1. Organisation: an existing one the person manages, or a new one they own.
    if (!data.committed.organisationId) {
      if (data.existingOrganisationId) {
        data.committed.organisationId = data.existingOrganisationId;
      } else {
        const organisation = await createOrganisation(userId, { name: data.organisationName, type: data.role === "MANAGER" ? "PROPERTY_MANAGEMENT" : "INDIVIDUAL_LANDLORD", countryCode: data.countryCode, defaultCurrencyCode: data.currencyCode });
        data.committed.organisationId = organisation.id;
      }
      await progress();
    }
    const organisationId = data.committed.organisationId;

    // 2. Properties, their buildings and units.
    for (const [index, property] of data.properties.entries()) {
      const referenceNumber = `${reference}-P${index + 1}`;
      let propertyId = data.committed.properties[index];
      if (!propertyId) {
        const existing = await db.property.findFirst({ where: { organisationId, referenceNumber }, select: { id: true } });
        const first = property.buildings[0];
        propertyId = existing?.id ?? (await createProperty(userId, organisationId, {
          name: property.name, referenceNumber, category: "Residential", countryCode: data.countryCode, currencyCode: data.currencyCode,
          city: property.city, addressLine1: property.addressLine1,
          ...(first?.name ? { building: { name: first.name, units: first.units } } : { units: first?.units ?? [] }),
        })).id;
        data.committed.properties[index] = propertyId;
        if (first?.name) {
          const building = await db.building.findFirst({ where: { propertyId, name: first.name }, select: { id: true } });
          if (building) data.committed.buildings[`${index}:0`] = building.id;
        }
        await progress();
      }
      for (const [buildingIndex, building] of property.buildings.entries()) {
        const key = `${index}:${buildingIndex}`;
        if (buildingIndex === 0 || !building.name || data.committed.buildings[key]) continue;
        const existing = await db.building.findFirst({ where: { propertyId, name: building.name }, select: { id: true } });
        data.committed.buildings[key] = existing?.id ?? (await createBuilding(userId, organisationId, propertyId, { name: building.name, units: building.units })).id;
        await progress();
      }
    }

    // 3. Tenants and their (draft) leases.
    for (const [index, tenant] of data.tenants.entries()) {
      const marker = `Added via WhatsApp onboarding (${reference}-T${index + 1}).`;
      const propertyId = data.committed.properties[tenant.propertyIndex];
      let record = data.committed.tenants[index];
      if (!record) {
        const existing = await db.tenantOrganisation.findFirst({ where: { organisationId, notes: marker }, select: { id: true } });
        const tenantOrganisationId = existing?.id ?? (await createTenant(userId, organisationId, { legalName: tenant.legalName, phone: tenant.phone, countryCode: data.countryCode, notes: marker })).relationship.id;
        record = { tenantOrganisationId };
        data.committed.tenants[index] = record;
        await progress();
      }
      if (!record.leaseId) {
        const leaseReference = `${reference}-L${index + 1}`;
        const unit = await db.unit.findFirst({ where: { propertyId, name: tenant.unitName, archivedAt: null }, select: { id: true } });
        const existing = await db.lease.findFirst({ where: { organisationId, referenceNumber: leaseReference }, select: { id: true } });
        record.leaseId = existing?.id ?? (await createLease(userId, organisationId, {
          referenceNumber: leaseReference, propertyId, unitId: unit?.id, tenantOrganisationIds: [record.tenantOrganisationId],
          startDate: tenant.startDate, endDate: tenant.endDate, rentAmountMinor: tenant.rentAmountMinor, currencyCode: data.currencyCode, rentFrequency: tenant.rentFrequency,
          notes: "Rent terms supplied by the landlord over WhatsApp. Complete lease execution to activate.",
        })).id;
        await progress();
      }
    }

    // 3b. Invite tenants the landlord confirmed (consent to WhatsApp recorded by that answer). Each
    // invitation sends the tenant the U17 message; the access code goes only to the landlord. A
    // retry after this step sends nothing again (codes are never stored in the draft).
    const invitations: Array<{ label: string; code: string }> = [];
    let invitationProblems = 0;
    if (data.inviteTenants && !data.committed.tenantsInvited) {
      for (const [index, tenant] of data.tenants.entries()) {
        const record = data.committed.tenants[index];
        if (!tenant.phone || !record) continue;
        try {
          await db.tenantOrganisation.update({ where: { id: record.tenantOrganisationId }, data: { communicationWhatsappAllowed: true } });
          const created = await createTenantAccessInvitation(userId, organisationId, record.tenantOrganisationId, record.leaseId);
          invitations.push({ label: `${data.properties.length > 1 ? `${data.properties[tenant.propertyIndex]?.name}/` : ""}${tenant.unitName} ${tenant.legalName}`, code: created.code });
        } catch (error) {
          if (!(error instanceof AppError && error.status < 500)) throw error;
          invitationProblems += 1;
        }
      }
      data.committed.tenantsInvited = true;
      await progress();
    }

    // 4. Lease-expiry reminders, 60 and 30 days before the end date.
    if (data.leaseExpiryReminders && !data.committed.reminders) {
      for (const daysOffset of [60, 30]) {
        await createReminderPolicy(userId, organisationId, { daysOffset, channels: ["IN_APP", "WHATSAPP"], enabled: true }).catch((error) => {
          if (!(error instanceof AppError && error.code === "DUPLICATE_REMINDER_POLICY")) throw error;
        });
      }
      data.committed.reminders = true;
      await progress();
    }

    // 5. Ownership/authority claims, pending review.
    const propertyIds = Object.values(data.committed.properties);
    if (!data.committed.verifications) {
      for (const propertyId of propertyIds) {
        await db.portfolioVerification.upsert({
          where: { organisationId_propertyId: { organisationId, propertyId } },
          update: {},
          create: { organisationId, propertyId, claimedByUserId: userId, claim: data.role === "MANAGER" ? "MANAGER" : "OWNER", source: "WHATSAPP_ONBOARDING" },
        });
      }
      data.committed.verifications = true;
      await progress();
    }

    // 6. Invite the professionals the person listed. They join only by accepting.
    let providerInviteProblem: string | null = null;
    if (!data.committed.providersInvited) {
      for (const [index, provider] of data.providers.entries()) {
        const category = parseNetworkCategory(provider.category);
        if (!category) continue;
        try {
          const invitation = await inviteNetworkProvider(userId, organisationId, { displayName: provider.name, phone: provider.phone, scopeCategories: [category], source: "ONBOARDING", sourceReference: `${draft.id}:P${index + 1}` });
          providerInviteProblem ??= invitation.deliveryFailureReason;
        } catch (error) {
          if (!(error instanceof AppError && error.code === "ALREADY_IN_NETWORK")) throw error;
        }
      }
      data.committed.providersInvited = true;
      await progress();
    }

    const organisation = await db.organisation.findUniqueOrThrow({ where: { id: organisationId }, select: { name: true, subscription: { select: { status: true, trialEndsAt: true } } } });
    await db.$transaction([
      db.onboardingDraft.update({ where: { id: draft.id }, data: { status: "COMMITTED", committedAt: new Date(), data: json(data), organisationId } }),
      db.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "onboarding.whatsapp_committed", entityType: "onboarding_draft", entityId: draft.id, metadata: { properties: propertyIds.length, tenants: data.tenants.length, providersPending: data.providers.length } } }),
    ]);
    return {
      organisationId, organisationName: organisation.name, properties: propertyIds.length,
      units: data.properties.reduce((sum, property) => sum + property.buildings.reduce((count, building) => count + building.units.length, 0), 0),
      tenants: data.tenants.length, draftLeases: data.tenants.length, invitations, invitationProblems, reminders: data.committed.reminders, pendingVerifications: propertyIds.length,
      providersInvited: data.providers.length, providerInviteProblem,
      plan: organisation.subscription ? { status: organisation.subscription.status, trialEndsAt: organisation.subscription.trialEndsAt } : undefined,
    };
  } catch (error) {
    // Keep what was created; the person can retry confirm after fixing the cause (for example a plan limit).
    await db.onboardingDraft.update({ where: { id: draft.id }, data: { status: "IN_PROGRESS", data: json(data), organisationId: data.committed.organisationId } });
    throw error;
  }
}
