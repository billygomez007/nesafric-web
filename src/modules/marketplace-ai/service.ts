import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { requireMarketplaceRole, requireMarketplaceMember } from "@/modules/marketplace-professionals/permissions";
import { assertMarketplaceFeatureEnabled } from "@/modules/marketplace-professionals/entitlements";
import { MARKETPLACE_ENTITLEMENTS } from "@/modules/marketplace-professionals/catalog";
import { updateMarketplaceLead, createViewingRequest } from "@/modules/listings/service";
import {
  marketplaceAIEmployeeSchema,
  marketplaceAIEmployeeUpdateSchema,
  listingAvailabilityQuerySchema,
  inventorySearchSchema,
  qualifyLeadSchema,
  scheduleViewingSchema,
  escalateLeadSchema,
} from "./schemas";

/**
 * Phase 21 item 9/20 — which marketplace entitlement key gates configuring each AI role. Domain
 * code always checks the entitlement key, never the plan name directly (item 8).
 */
const ROLE_ENTITLEMENT: Record<string, string> = {
  AI_SALES_RECEPTIONIST: MARKETPLACE_ENTITLEMENTS.aiReceptionistTextEnabled.key,
  AI_SALES_AGENT: MARKETPLACE_ENTITLEMENTS.aiSalesAgentEnabled.key,
  AI_LEAD_MANAGER: MARKETPLACE_ENTITLEMENTS.aiLeadManagerEnabled.key,
  AI_LISTING_ASSISTANT: MARKETPLACE_ENTITLEMENTS.aiListingAssistantEnabled.key,
};

async function professionalOrThrow(marketplaceProfessionalId: string) {
  const professional = await db.marketplaceProfessional.findFirst({ where: { id: marketplaceProfessionalId, archivedAt: null } });
  if (!professional) throw notFound();
  return professional;
}

async function recordActivity(marketplaceProfessionalId: string, aiEmployeeId: string, type: string, reason: string, affectedEntities: unknown, idempotencyKey: string, result?: unknown) {
  const professional = await professionalOrThrow(marketplaceProfessionalId);
  return db.aIEmployeeActivity.create({
    data: {
      marketplaceProfessionalId, aiEmployeeId, type, status: "COMPLETED", reason,
      affectedEntities: affectedEntities as never, result: result as never, idempotencyKey,
    },
  }).then(async (activity) => {
    await db.auditEvent.create({ data: { organisationId: professional.backingOrganisationId, action: `ai.${type}`, entityType: "ai_employee_activity", entityId: activity.id, metadata: { marketplaceProfessionalId, aiEmployeeId } } });
    return activity;
  });
}

// ---------------------------------------------------------------------------
// AI employee CRUD (item 9)
// ---------------------------------------------------------------------------

export async function createMarketplaceAIEmployee(userId: string, marketplaceProfessionalId: string, input: unknown) {
  await requireMarketplaceRole(userId, marketplaceProfessionalId, "ADMIN");
  const data = marketplaceAIEmployeeSchema.parse(input);
  const entitlementKey = ROLE_ENTITLEMENT[data.role];
  await assertMarketplaceFeatureEnabled(marketplaceProfessionalId, entitlementKey);
  const employee = await db.aIEmployee.create({
    data: {
      marketplaceProfessionalId, name: data.name, role: data.role, description: data.description,
      status: data.status, scope: "ORGANISATION", responsibilities: [], instructions: data.instructions as Prisma.InputJsonValue,
      escalationConfiguration: data.escalationConfiguration as Prisma.InputJsonValue, timezone: data.timezone,
      createdByUserId: userId, updatedByUserId: userId,
    },
  });
  const professional = await professionalOrThrow(marketplaceProfessionalId);
  await db.auditEvent.create({ data: { organisationId: professional.backingOrganisationId, actorUserId: userId, action: "marketplace_ai_employee.created", entityType: "ai_employee", entityId: employee.id, metadata: { role: employee.role } } });
  return employee;
}

export async function listMarketplaceAIEmployees(userId: string, marketplaceProfessionalId: string) {
  await requireMarketplaceMember(userId, marketplaceProfessionalId);
  return db.aIEmployee.findMany({ where: { marketplaceProfessionalId, archivedAt: null }, orderBy: { createdAt: "asc" } });
}

export async function getMarketplaceAIEmployee(userId: string, marketplaceProfessionalId: string, employeeId: string) {
  await requireMarketplaceMember(userId, marketplaceProfessionalId);
  const employee = await db.aIEmployee.findFirst({ where: { id: employeeId, marketplaceProfessionalId, archivedAt: null } });
  if (!employee) throw notFound();
  return employee;
}

export async function updateMarketplaceAIEmployee(userId: string, marketplaceProfessionalId: string, employeeId: string, input: unknown) {
  await requireMarketplaceRole(userId, marketplaceProfessionalId, "ADMIN");
  const existing = await db.aIEmployee.findFirst({ where: { id: employeeId, marketplaceProfessionalId } });
  if (!existing) throw notFound();
  const data = marketplaceAIEmployeeUpdateSchema.parse(input);
  if (data.role) await assertMarketplaceFeatureEnabled(marketplaceProfessionalId, ROLE_ENTITLEMENT[data.role]);
  return db.aIEmployee.update({
    where: { id: employeeId },
    data: {
      ...data,
      instructions: data.instructions as Prisma.InputJsonValue | undefined,
      escalationConfiguration: data.escalationConfiguration as Prisma.InputJsonValue | undefined,
      updatedByUserId: userId,
    },
  });
}

// ---------------------------------------------------------------------------
// AI Sales Receptionist — item 10: answers only from live, approved listing data.
// ---------------------------------------------------------------------------

const PUBLIC_LISTING_FIELDS = {
  id: true, title: true, listingType: true, status: true, publicDescription: true,
  rentAmountMinor: true, askingAmountMinor: true, currencyCode: true, frequency: true,
  bedrooms: true, bathrooms: true, sizeSqm: true, city: true, region: true, district: true,
  availableFrom: true, enquiryEnabled: true, showContactEmail: true, showContactPhone: true,
  contactEmail: true, contactPhone: true,
  amenities: { select: { key: true, label: true } },
  listingRepresentative: { select: { displayName: true } },
  development: { select: { id: true, name: true } },
} as const;

function isPubliclyAvailable(listing: { status: string }) {
  return listing.status === "PUBLISHED";
}

/**
 * Answers a live availability/price/detail question about one listing (item 10). Always reads
 * the current row — never a cached or previously-generated answer — so availability always
 * reflects the current listing state exactly as it stands at query time.
 */
export async function checkListingAvailability(userId: string, marketplaceProfessionalId: string, input: unknown) {
  await requireMarketplaceMember(userId, marketplaceProfessionalId);
  const data = listingAvailabilityQuerySchema.parse(input);
  const listing = data.listingId
    ? await db.listing.findFirst({ where: { id: data.listingId, marketplaceProfessionalId }, select: PUBLIC_LISTING_FIELDS })
    : await db.listing.findFirst({
        where: {
          marketplaceProfessionalId, status: "PUBLISHED",
          OR: [
            { title: { contains: data.query, mode: "insensitive" } },
            { city: { contains: data.query, mode: "insensitive" } },
            { district: { contains: data.query, mode: "insensitive" } },
            { category: { contains: data.query, mode: "insensitive" } },
          ],
        },
        select: PUBLIC_LISTING_FIELDS,
        orderBy: { updatedAt: "desc" },
      });
  if (!listing) return { found: false, available: false };
  return {
    found: true,
    available: isPubliclyAvailable(listing) && listing.enquiryEnabled,
    listing: {
      id: listing.id, title: listing.title, listingType: listing.listingType, status: listing.status,
      description: listing.publicDescription,
      price: listing.listingType === "RENT" ? listing.rentAmountMinor?.toString() : listing.askingAmountMinor?.toString(),
      currencyCode: listing.currencyCode, frequency: listing.frequency,
      bedrooms: listing.bedrooms, bathrooms: listing.bathrooms?.toString() ?? null, sizeSqm: listing.sizeSqm?.toString() ?? null,
      location: { city: listing.city, region: listing.region, district: listing.district },
      availableFrom: listing.availableFrom,
      amenities: listing.amenities.map((amenity) => amenity.label),
      representative: listing.listingRepresentative?.displayName ?? null,
      development: listing.development?.name ?? null,
      contact: {
        email: listing.showContactEmail ? listing.contactEmail : null,
        phone: listing.showContactPhone ? listing.contactPhone : null,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Live inventory search — item 11.
// ---------------------------------------------------------------------------

export async function searchInventory(userId: string, marketplaceProfessionalId: string, input: unknown) {
  await requireMarketplaceMember(userId, marketplaceProfessionalId);
  await assertMarketplaceFeatureEnabled(marketplaceProfessionalId, MARKETPLACE_ENTITLEMENTS.aiInventorySearchEnabled.key);
  const filters = inventorySearchSchema.parse(input);
  const priceField = filters.purpose === "SALE" ? "askingAmountMinor" : "rentAmountMinor";
  const results = await db.listing.findMany({
    where: {
      marketplaceProfessionalId, status: "PUBLISHED",
      ...(filters.purpose ? { listingType: filters.purpose } : {}),
      ...(filters.bedrooms !== undefined ? { bedrooms: { gte: filters.bedrooms } } : {}),
      ...(filters.bathrooms !== undefined ? { bathrooms: { gte: filters.bathrooms } } : {}),
      ...(filters.city ? { city: { contains: filters.city, mode: "insensitive" } } : {}),
      ...(filters.region ? { region: { contains: filters.region, mode: "insensitive" } } : {}),
      ...(filters.category ? { category: { contains: filters.category, mode: "insensitive" } } : {}),
      ...(filters.developmentId ? { developmentId: filters.developmentId } : {}),
      ...(filters.minPriceMinor || filters.maxPriceMinor
        ? { [priceField]: { ...(filters.minPriceMinor ? { gte: filters.minPriceMinor } : {}), ...(filters.maxPriceMinor ? { lte: filters.maxPriceMinor } : {}) } }
        : {}),
      ...(filters.amenities?.length ? { amenities: { some: { key: { in: filters.amenities } } } } : {}),
    },
    select: PUBLIC_LISTING_FIELDS,
    orderBy: { updatedAt: "desc" },
    take: 25,
  });
  return results.map((listing) => ({
    id: listing.id, title: listing.title, listingType: listing.listingType,
    price: listing.listingType === "RENT" ? listing.rentAmountMinor?.toString() : listing.askingAmountMinor?.toString(),
    currencyCode: listing.currencyCode, bedrooms: listing.bedrooms, bathrooms: listing.bathrooms?.toString() ?? null,
    city: listing.city, region: listing.region, development: listing.development?.name ?? null,
  }));
}

// ---------------------------------------------------------------------------
// AI Sales Agent — item 12. Deterministic capabilities; never independently commits to a
// legally-binding transaction (no lease/sale-agreement finalisation function exists here).
// ---------------------------------------------------------------------------

export async function qualifyLead(userId: string, marketplaceProfessionalId: string, employeeId: string, input: unknown) {
  await requireMarketplaceMember(userId, marketplaceProfessionalId);
  const employee = await getMarketplaceAIEmployee(userId, marketplaceProfessionalId, employeeId);
  if (employee.role !== "AI_SALES_AGENT") throw new AppError("AI_EMPLOYEE_ROLE_INVALID", 409, "Lead qualification requires an AI Sales Agent.");
  const professional = await professionalOrThrow(marketplaceProfessionalId);
  const data = qualifyLeadSchema.parse(input);
  const updated = await updateMarketplaceLead(userId, professional.backingOrganisationId, data.leadId, {
    status: data.status, privateNotes: data.requirements,
  });
  await recordActivity(marketplaceProfessionalId, employeeId, "lead_qualified", "AI Sales Agent captured prospect requirements.", { leadId: data.leadId }, `qualify:${data.leadId}:${Date.now()}`, { status: updated.status });
  return updated;
}

export async function scheduleViewingForLead(userId: string, marketplaceProfessionalId: string, employeeId: string, input: unknown) {
  await requireMarketplaceMember(userId, marketplaceProfessionalId);
  await assertMarketplaceFeatureEnabled(marketplaceProfessionalId, MARKETPLACE_ENTITLEMENTS.aiViewingSchedulerEnabled.key);
  const employee = await getMarketplaceAIEmployee(userId, marketplaceProfessionalId, employeeId);
  if (employee.role !== "AI_SALES_AGENT") throw new AppError("AI_EMPLOYEE_ROLE_INVALID", 409, "Scheduling a viewing requires an AI Sales Agent.");
  const data = scheduleViewingSchema.parse(input);
  const viewing = await createViewingRequest(data.listingId, userId, {
    leadId: data.leadId,
    preferredTimes: [{ startsAt: data.startsAt.toISOString(), endsAt: data.endsAt.toISOString(), timezone: data.timezone }],
    requesterNote: data.requesterNote,
  });
  await recordActivity(marketplaceProfessionalId, employeeId, "viewing_scheduled", "AI Sales Agent scheduled a viewing.", { leadId: data.leadId, listingId: data.listingId }, `viewing:${data.leadId}:${data.listingId}:${data.startsAt.toISOString()}`, { viewingId: viewing.id });
  return viewing;
}

/** Recommends alternative listings for a prospect (item 12) — reuses live inventory search. */
export async function recommendAlternativeListings(userId: string, marketplaceProfessionalId: string, input: unknown) {
  return searchInventory(userId, marketplaceProfessionalId, input);
}

/** Escalates to a human representative (item 12/24) — the AI Sales Agent's only path when it
 * cannot proceed on its own; never independently finalises a transaction. */
export async function escalateLeadToHuman(userId: string, marketplaceProfessionalId: string, employeeId: string, input: unknown) {
  await requireMarketplaceMember(userId, marketplaceProfessionalId);
  await getMarketplaceAIEmployee(userId, marketplaceProfessionalId, employeeId);
  const data = escalateLeadSchema.parse(input);
  const handoff = await db.aIEmployeeHandoff.create({
    data: {
      marketplaceProfessionalId, aiEmployeeId: employeeId, operationalItemType: data.leadId ? "marketplace_lead" : undefined,
      operationalItemId: data.leadId, reason: data.reason, urgency: data.urgency, contextSummary: data.contextSummary,
      status: "OPEN", createdByUserId: userId,
    },
  });
  const professional = await professionalOrThrow(marketplaceProfessionalId);
  await db.auditEvent.create({ data: { organisationId: professional.backingOrganisationId, actorUserId: userId, action: "ai.employee.handoff_created", entityType: "ai_employee_handoff", entityId: handoff.id, metadata: { marketplaceProfessionalId, urgency: handoff.urgency } } });
  return handoff;
}

// ---------------------------------------------------------------------------
// AI Lead Manager — item 13. Deterministic monitoring only; sending is never automatic.
// ---------------------------------------------------------------------------

const STALE_HOURS = 24;
const NO_FOLLOW_UP_DAYS = 7;

export async function detectLeadAttentionSignals(userId: string, marketplaceProfessionalId: string) {
  await requireMarketplaceMember(userId, marketplaceProfessionalId);
  await professionalOrThrow(marketplaceProfessionalId);
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - STALE_HOURS * 60 * 60 * 1000);
  const noFollowUpThreshold = new Date(now.getTime() - NO_FOLLOW_UP_DAYS * 24 * 60 * 60 * 1000);

  // Deliberately scoped by `listing.marketplaceProfessionalId` alone (not the backing
  // organisation) — this professional may be marketing a third-party listing whose
  // `organisationId` belongs to the underlying landlord's own PropertyOS organisation (item 4/6),
  // and the AI Lead Manager must still see those leads.
  const [unanswered, noFollowUp, missedViewings, completedWithoutFollowUp] = await Promise.all([
    db.marketplaceLead.findMany({ where: { listing: { marketplaceProfessionalId }, status: "NEW", createdAt: { lt: staleThreshold } }, select: { id: true, name: true, createdAt: true } }),
    db.marketplaceLead.findMany({ where: { listing: { marketplaceProfessionalId }, status: { notIn: ["CLOSED", "LOST"] }, lastActivityAt: { lt: noFollowUpThreshold } }, select: { id: true, name: true, lastActivityAt: true } }),
    db.viewingRequest.findMany({ where: { listing: { marketplaceProfessionalId }, status: "CONFIRMED", confirmedEndsAt: { lt: now } }, select: { id: true, leadId: true, confirmedEndsAt: true } }),
    db.marketplaceLead.findMany({ where: { listing: { marketplaceProfessionalId }, status: "VIEWING_COMPLETED", viewingCompletedAt: { lt: noFollowUpThreshold } }, select: { id: true, name: true, viewingCompletedAt: true } }),
  ]);

  return {
    unansweredLeads: unanswered,
    noFollowUpLeads: noFollowUp,
    missedViewings,
    completedViewingsWithoutFollowUp: completedWithoutFollowUp,
    generatedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// AI Listing Assistant — item 14. Never fabricates property characteristics — every flag is a
// deterministic check against fields already recorded on the listing.
// ---------------------------------------------------------------------------

export async function detectListingQualityIssues(userId: string, marketplaceProfessionalId: string) {
  await requireMarketplaceMember(userId, marketplaceProfessionalId);
  const listings = await db.listing.findMany({
    where: { marketplaceProfessionalId, archivedAt: null, status: { in: ["DRAFT", "PENDING_REVIEW", "PUBLISHED"] } },
    include: { media: true, amenities: true, development: true, developmentUnit: true },
  });
  const staleThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  return listings.map((listing) => {
    const issues: string[] = [];
    if (listing.media.length === 0) issues.push("MISSING_PHOTOS");
    if (listing.publicDescription.trim().length < 40) issues.push("DESCRIPTION_TOO_SHORT");
    if (listing.amenities.length === 0) issues.push("NO_AMENITIES_LISTED");
    if (!listing.bedrooms && listing.category.toLowerCase() !== "land") issues.push("MISSING_BEDROOMS");
    if (listing.status === "PUBLISHED" && listing.updatedAt < staleThreshold) issues.push("STALE_LISTING");
    if (listing.developmentUnit && listing.developmentUnit.status !== "AVAILABLE" && listing.status === "PUBLISHED") {
      issues.push("AVAILABILITY_MISMATCH");
    }
    return { listingId: listing.id, title: listing.title, status: listing.status, issues };
  }).filter((entry) => entry.issues.length > 0);
}
