import { randomBytes } from "crypto";
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { createOrganisation, listUserOrganisations } from "@/modules/organisations/service";
import { updateMarketplaceProfessionalLead } from "@/modules/listings/service";
import { requirePlatformPrincipal, PLATFORM_PERMISSIONS } from "@/platform/platform-admin/auth";
import {
  createMarketplaceProfessionalSchema,
  updateMarketplaceProfessionalSchema,
  addMarketplaceMemberSchema,
  updateMarketplaceMemberSchema,
  submitMarketplaceVerificationSchema,
  reviewMarketplaceVerificationSchema,
  changeMarketplacePlanSchema,
  directorySearchSchema,
} from "./schemas";
import { requireMarketplaceMember, requireMarketplaceRole } from "./permissions";
import { assertMarketplaceOperational } from "./entitlements";
import { MARKETPLACE_ENTITLEMENTS } from "./catalog";
import { enqueueOnboardingCompleteEmail } from "@/modules/account-emails/service";
import type { User } from "@/platform/database/generated/client";

const PROFESSIONAL_TYPE_TO_ORGANISATION_TYPE: Record<string, "REAL_ESTATE" | "DEVELOPER" | "OTHER"> = {
  INDIVIDUAL_AGENT: "OTHER",
  BROKER: "REAL_ESTATE",
  BROKERAGE: "REAL_ESTATE",
  REAL_ESTATE_COMPANY: "REAL_ESTATE",
  DEVELOPER: "DEVELOPER",
  PROPERTY_MARKETING_COMPANY: "OTHER",
  OTHER: "OTHER",
};

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 140) || "professional";
}

async function uniqueSlug(base: string) {
  const root = slugify(base);
  let candidate = root;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const existing = await db.marketplaceProfessional.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
    candidate = `${root}-${randomBytes(3).toString("hex")}`;
  }
  return `${root}-${randomBytes(6).toString("hex")}`;
}

/**
 * Creates a new Marketplace professional profile (Phase 21A item 1) for the given user, who
 * becomes its OWNER. Backed by a hidden, technical `Organisation` (never subscribed to
 * PropertyOS management — item 8) so listing/lead/viewing creation can reuse the existing,
 * already-isolated Listing/MarketplaceLead/ViewingRequest domains. Every profile gets exactly one
 * `MarketplaceSubscription`, defaulted to the free plan (item 8/9): no separate signup step, and
 * never attached to any `OrganisationSubscription`.
 */
export async function createMarketplaceProfessional(userId: string, input: unknown) {
  const data = createMarketplaceProfessionalSchema.parse(input);
  const country = await db.country.findUnique({ where: { code: data.countryCode } });
  if (!country?.isActive) throw new AppError("COUNTRY_UNSUPPORTED", 422, "The selected country is not supported.");
  const freePlan = await db.marketplacePlan.findUnique({ where: { key: "marketplace_free" } });
  if (!freePlan) throw new Error("The default marketplace plan has not been seeded.");
  const slug = await uniqueSlug(data.displayName);

  const organisation = await createOrganisation(
    userId,
    { name: data.displayName, type: PROFESSIONAL_TYPE_TO_ORGANISATION_TYPE[data.type], countryCode: data.countryCode },
    { skipSubscription: true },
  );

  return db.$transaction(async (tx) => {
    const professional = await tx.marketplaceProfessional.create({
      data: {
        backingOrganisationId: organisation.id,
        type: data.type,
        displayName: data.displayName,
        legalName: data.legalName,
        logoUrl: data.logoUrl,
        description: data.description,
        websiteUrl: data.websiteUrl,
        contactEmail: data.contactEmail,
        contactPhone: data.contactPhone,
        countryCode: data.countryCode,
        specialities: data.specialities,
        servicesOffered: data.servicesOffered,
        serviceAreas: data.serviceAreas,
        createdByUserId: userId,
        slug,
      },
    });
    await tx.marketplaceProfessionalMember.create({ data: { marketplaceProfessionalId: professional.id, userId, role: "OWNER" } });
    const now = new Date();
    const oneYearOut = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 365);
    await tx.marketplaceSubscription.create({
      data: {
        marketplaceProfessionalId: professional.id, planId: freePlan.id, status: "ACTIVE",
        billingCycle: "MONTHLY", currencyCode: country.defaultCurrencyCode,
        currentPeriodStart: now, currentPeriodEnd: oneYearOut,
      },
    });
    await tx.auditEvent.create({ data: { organisationId: organisation.id, actorUserId: userId, action: "marketplace_professional.created", entityType: "marketplace_professional", entityId: professional.id } });
    await tx.domainEvent.create({ data: { organisationId: organisation.id, name: "marketplace_professional.created", aggregateType: "marketplace_professional", aggregateId: professional.id, payload: { type: professional.type, slug } } });
    return professional;
  }).then(async (professional) => {
    await enqueueOnboardingCompleteEmail(userId, "ONBOARDING_COMPLETE_MARKETPLACE", professional.displayName);
    return professional;
  });
}

export async function listUserMarketplaceProfessionals(userId: string) {
  const memberships = await db.marketplaceProfessionalMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { role: true, marketplaceProfessional: { select: { id: true, displayName: true, type: true, status: true, verificationStatus: true, slug: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map(({ role, marketplaceProfessional }) => ({ ...marketplaceProfessional, myRole: role }));
}

/** Dual-workspace readiness (item 7): the complete set of workspaces one user identity can act
 * within — zero or more PropertyOS management organisations, and zero or more Marketplace
 * professional profiles — kept as two clearly separate collections, never merged. */
export async function listUserWorkspaces(userId: string) {
  const [propertyOsOrganisations, marketplaceProfessionals] = await Promise.all([
    listUserOrganisations(userId),
    listUserMarketplaceProfessionals(userId),
  ]);
  return { propertyOsOrganisations, marketplaceProfessionals };
}

export async function getMarketplaceProfessional(userId: string, marketplaceProfessionalId: string) {
  await requireMarketplaceMember(userId, marketplaceProfessionalId);
  const professional = await db.marketplaceProfessional.findFirst({
    where: { id: marketplaceProfessionalId, archivedAt: null },
    include: {
      members: { where: { status: { not: "REMOVED" } }, include: { user: { select: { id: true, displayName: true, email: true } } }, orderBy: { createdAt: "asc" } },
      subscription: { include: { plan: true } },
      _count: { select: { developments: true, listings: true } },
    },
  });
  if (!professional) throw notFound();
  return professional;
}

export async function updateMarketplaceProfessional(userId: string, marketplaceProfessionalId: string, input: unknown) {
  await requireMarketplaceRole(userId, marketplaceProfessionalId, "ADMIN");
  const data = updateMarketplaceProfessionalSchema.parse(input);
  const professional = await db.marketplaceProfessional.update({ where: { id: marketplaceProfessionalId }, data });
  await recordProfessionalAudit(professional.id, userId, "marketplace_professional.updated");
  return professional;
}

async function recordProfessionalAudit(marketplaceProfessionalId: string, actorUserId: string | undefined, action: string, metadata?: Record<string, unknown>) {
  const professional = await db.marketplaceProfessional.findUnique({ where: { id: marketplaceProfessionalId }, select: { backingOrganisationId: true } });
  if (!professional) return;
  await db.auditEvent.create({ data: { organisationId: professional.backingOrganisationId, actorUserId, action, entityType: "marketplace_professional", entityId: marketplaceProfessionalId, metadata: metadata as never } });
}

async function professionalOrThrow(marketplaceProfessionalId: string) {
  const professional = await db.marketplaceProfessional.findFirst({
    where: { id: marketplaceProfessionalId, archivedAt: null },
    select: { id: true, backingOrganisationId: true },
  });
  if (!professional) throw notFound();
  return professional;
}

/**
 * Every marketplace team member also gets a matching `OrganisationMember` row on the professional's
 * hidden backing organisation (item 3/6 "assign listing representative" / "lead assignment") — not
 * a redesign of the Lead/Listing domain, just ensuring a valid target exists for their existing
 * `assigneeMemberId`/`assigneeUserId` fields (which FK to `OrganisationMember`, not
 * `MarketplaceProfessionalMember`). This row carries no PropertyOS role/permissions — RBAC for
 * every marketplace action still resolves through `requireMarketplaceRole`, never this row.
 */
async function ensureBackingOrganisationMember(backingOrganisationId: string, userId: string) {
  const existing = await db.organisationMember.findFirst({ where: { organisationId: backingOrganisationId, userId } });
  if (existing) return existing;
  return db.organisationMember.create({ data: { organisationId: backingOrganisationId, userId } });
}

export async function addMarketplaceMember(userId: string, marketplaceProfessionalId: string, input: unknown) {
  await requireMarketplaceRole(userId, marketplaceProfessionalId, "ADMIN");
  await assertMarketplaceOperational(marketplaceProfessionalId, MARKETPLACE_ENTITLEMENTS.teamMembersMax.key);
  const data = addMarketplaceMemberSchema.parse(input);
  const targetUser = await db.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (!targetUser) throw new AppError("USER_NOT_FOUND", 404, "No UmoAfric account exists for that email. They must register first.");
  const existing = await db.marketplaceProfessionalMember.findUnique({ where: { marketplaceProfessionalId_userId: { marketplaceProfessionalId, userId: targetUser.id } } });
  if (existing && existing.status !== "REMOVED") throw new AppError("ALREADY_MEMBER", 409, "That user is already a member of this marketplace profile.");
  const professional = await professionalOrThrow(marketplaceProfessionalId);
  const member = existing
    ? await db.marketplaceProfessionalMember.update({ where: { id: existing.id }, data: { role: data.role, status: "ACTIVE" } })
    : await db.marketplaceProfessionalMember.create({ data: { marketplaceProfessionalId, userId: targetUser.id, role: data.role } });
  await ensureBackingOrganisationMember(professional.backingOrganisationId, targetUser.id);
  await recordProfessionalAudit(marketplaceProfessionalId, userId, "marketplace_professional.member_added", { memberUserId: targetUser.id, role: data.role });
  return member;
}

/** Assigns an existing marketplace lead to a team member (item 6's "lead assignment" / item 16's
 * "lead assignment" test) — reuses `MarketplaceLead.assigneeMemberId` exactly as-is (no schema
 * change), resolving the marketplace team member to their backing-organisation `OrganisationMember`. */
export async function assignMarketplaceLead(userId: string, marketplaceProfessionalId: string, leadId: string, representativeMemberId: string) {
  await requireMarketplaceRole(userId, marketplaceProfessionalId, "AGENT");
  const representative = await db.marketplaceProfessionalMember.findFirst({ where: { id: representativeMemberId, marketplaceProfessionalId, status: "ACTIVE" } });
  if (!representative) throw notFound();
  const professional = await professionalOrThrow(marketplaceProfessionalId);
  const orgMember = await ensureBackingOrganisationMember(professional.backingOrganisationId, representative.userId);
  return updateMarketplaceProfessionalLead(userId, marketplaceProfessionalId, leadId, { assigneeMemberId: orgMember.id });
}

export async function updateMarketplaceMember(userId: string, marketplaceProfessionalId: string, memberId: string, input: unknown) {
  await requireMarketplaceRole(userId, marketplaceProfessionalId, "ADMIN");
  const data = updateMarketplaceMemberSchema.parse(input);
  const member = await db.marketplaceProfessionalMember.findFirst({ where: { id: memberId, marketplaceProfessionalId } });
  if (!member) throw notFound();
  if (member.role === "OWNER" && (data.role === "AGENT" || data.role === "ADMIN" || data.status === "REMOVED" || data.status === "SUSPENDED")) {
    const remainingOwners = await db.marketplaceProfessionalMember.count({ where: { marketplaceProfessionalId, role: "OWNER", status: "ACTIVE", id: { not: memberId } } });
    if (remainingOwners === 0) throw new AppError("LAST_OWNER", 409, "A marketplace profile must always have at least one active owner.");
  }
  const updated = await db.marketplaceProfessionalMember.update({ where: { id: memberId }, data });
  await recordProfessionalAudit(marketplaceProfessionalId, userId, "marketplace_professional.member_updated", { memberId, ...data });
  return updated;
}

export async function submitMarketplaceVerification(userId: string, marketplaceProfessionalId: string, input: unknown) {
  await requireMarketplaceRole(userId, marketplaceProfessionalId, "ADMIN");
  const data = submitMarketplaceVerificationSchema.parse(input);
  const professional = await db.marketplaceProfessional.findFirst({ where: { id: marketplaceProfessionalId, archivedAt: null } });
  if (!professional) throw notFound();
  if (professional.verificationStatus === "VERIFIED") throw new AppError("ALREADY_VERIFIED", 409, "This profile is already verified.");
  return db.$transaction(async (tx) => {
    const updated = await tx.marketplaceProfessional.update({ where: { id: marketplaceProfessionalId }, data: { verificationStatus: "PENDING", verificationEvidenceReferences: data.evidenceReferences } });
    await tx.marketplaceProfessionalVerificationEvent.create({ data: { marketplaceProfessionalId, fromStatus: professional.verificationStatus, toStatus: "PENDING", actorUserId: userId, reason: "Evidence submitted." } });
    return updated;
  });
}

/** Verification review is a NesAfric platform-administration action (reusing Phase 20's
 * `PlatformPrincipal` RBAC — item 11's "PropertyOS/Marketplace workspace separation" applies
 * symmetrically: platform trust decisions are never delegated to the professional's own team). */
export async function reviewMarketplaceVerification(platformUser: User, marketplaceProfessionalId: string, input: unknown) {
  const principal = await requirePlatformPrincipal(platformUser, PLATFORM_PERMISSIONS.marketplaceVerify);
  const data = reviewMarketplaceVerificationSchema.parse(input);
  const professional = await db.marketplaceProfessional.findFirst({ where: { id: marketplaceProfessionalId } });
  if (!professional) throw notFound();
  if (professional.verificationStatus !== "PENDING" && data.status !== "SUSPENDED") throw new AppError("INVALID_VERIFICATION_STATE", 409, "Only a pending verification may be approved or rejected.");
  return db.$transaction(async (tx) => {
    const updated = await tx.marketplaceProfessional.update({ where: { id: marketplaceProfessionalId }, data: { verificationStatus: data.status } });
    await tx.marketplaceProfessionalVerificationEvent.create({ data: { marketplaceProfessionalId, fromStatus: professional.verificationStatus, toStatus: data.status, actorUserId: principal.userId, reason: data.reason } });
    return updated;
  });
}

export async function changeMarketplacePlan(userId: string, marketplaceProfessionalId: string, input: unknown) {
  await requireMarketplaceRole(userId, marketplaceProfessionalId, "OWNER");
  const data = changeMarketplacePlanSchema.parse(input);
  const plan = await db.marketplacePlan.findFirst({ where: { key: data.planKey, isActive: true, isPublic: true } });
  if (!plan) throw notFound();
  const subscription = await db.marketplaceSubscription.findUnique({ where: { marketplaceProfessionalId } });
  if (!subscription) throw notFound();
  const updated = await db.marketplaceSubscription.update({ where: { marketplaceProfessionalId }, data: { planId: plan.id } });
  await recordProfessionalAudit(marketplaceProfessionalId, userId, "marketplace_professional.plan_changed", { planKey: plan.key });
  return updated;
}

/** Safe public projection (item 10 + item 11) — never exposes member emails, internal ids,
 * private verification evidence references, or the backing organisation. Bounded (`take`) so a
 * large developer/brokerage's full inventory is never loaded onto one public page (item 11). */
export async function getPublicMarketplaceProfessionalProfile(slug: string) {
  const professional = await db.marketplaceProfessional.findFirst({
    where: { slug, status: "ACTIVE", archivedAt: null },
    select: {
      id: true, type: true, displayName: true, legalName: true, logoUrl: true, description: true,
      websiteUrl: true, contactEmail: true, contactPhone: true, countryCode: true,
      specialities: true, servicesOffered: true, serviceAreas: true, verificationStatus: true, createdAt: true,
      members: { where: { status: "ACTIVE" }, select: { role: true, user: { select: { displayName: true } } }, orderBy: { createdAt: "asc" }, take: 50 },
      developments: { where: { archivedAt: null }, select: { id: true, name: true, status: true, city: true, region: true, countryCode: true }, take: 50, orderBy: { createdAt: "desc" } },
      _count: { select: { listings: { where: { status: "PUBLISHED", archivedAt: null } } } },
      listings: {
        where: { status: "PUBLISHED", archivedAt: null },
        select: { id: true, title: true, listingType: true, city: true, rentAmountMinor: true, askingAmountMinor: true, currencyCode: true, listingAuthority: true },
        take: 24, orderBy: { updatedAt: "desc" },
      },
    },
  });
  if (!professional) throw notFound();
  return professional;
}

/** Item 8 — public marketplace discovery. Paginated, never favours individual agents over
 * companies/developers (no type-based default ordering). Safe projection only. */
export async function searchMarketplaceDirectory(input: unknown) {
  const filters = directorySearchSchema.parse(input);
  const where = {
    status: "ACTIVE" as const,
    archivedAt: null,
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.countryCode ? { countryCode: filters.countryCode } : {}),
    ...(filters.serviceArea ? { serviceAreas: { has: filters.serviceArea } } : {}),
    ...(filters.speciality ? { specialities: { has: filters.speciality } } : {}),
    ...(filters.verifiedOnly ? { verificationStatus: "VERIFIED" as const } : {}),
    ...(filters.query ? { displayName: { contains: filters.query, mode: "insensitive" as const } } : {}),
  };
  const [items, total] = await db.$transaction([
    db.marketplaceProfessional.findMany({
      where,
      select: {
        slug: true, displayName: true, type: true, logoUrl: true, description: true, verificationStatus: true,
        countryCode: true, serviceAreas: true, specialities: true,
        _count: { select: { listings: { where: { status: "PUBLISHED", archivedAt: null } }, developments: true } },
      },
      // Not `orderBy: verificationStatus` — Postgres enum DESC sorts by declaration order
      // (UNVERIFIED, PENDING, VERIFIED, REJECTED, SUSPENDED), which would rank a SUSPENDED
      // profile above a VERIFIED one. Verified-first ranking would need either a schema enum
      // reorder or raw SQL; recency is the safe, correct default until that's worth doing.
      orderBy: [{ createdAt: "desc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.marketplaceProfessional.count({ where }),
  ]);
  return { items, total, page: filters.page, pageSize: filters.pageSize };
}

/// Sitemap generation (SEO). Cap kept comfortably under Google's 50,000-URL-per-sitemap limit —
/// once this category alone approaches it, switch `app/sitemap.ts` to `generateSitemaps` and shard
/// by this same eligibility query instead of raising the cap.
const SITEMAP_PROFESSIONAL_LIMIT = 15_000;

export async function listPublicMarketplaceProfessionalsForSitemap(): Promise<Array<{ slug: string; updatedAt: Date }>> {
  return db.marketplaceProfessional.findMany({
    where: { status: "ACTIVE", archivedAt: null },
    select: { slug: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: SITEMAP_PROFESSIONAL_LIMIT,
  });
}

/** Item 2 — real dashboard data for both a one-person agent and a large company. */
export async function getMarketplaceDashboardMetrics(userId: string, marketplaceProfessionalId: string) {
  await requireMarketplaceMember(userId, marketplaceProfessionalId);
  const professional = await db.marketplaceProfessional.findFirst({ where: { id: marketplaceProfessionalId, archivedAt: null } });
  if (!professional) throw notFound();

  const [statusCounts, newLeadsCount, upcomingViewingsCount, teamCount, developmentCount, subscription] = await Promise.all([
    db.listing.groupBy({ by: ["status"], where: { marketplaceProfessionalId }, _count: { _all: true } }),
    db.marketplaceLead.count({ where: { listing: { marketplaceProfessionalId }, status: "NEW" } }),
    db.viewingRequest.count({ where: { listing: { marketplaceProfessionalId }, status: { in: ["REQUESTED", "CONFIRMED"] } } }),
    db.marketplaceProfessionalMember.count({ where: { marketplaceProfessionalId, status: "ACTIVE" } }),
    db.development.count({ where: { marketplaceProfessionalId, archivedAt: null } }),
    db.marketplaceSubscription.findUnique({ where: { marketplaceProfessionalId }, include: { plan: true } }),
  ]);

  const byStatus = Object.fromEntries(statusCounts.map((row) => [row.status, row._count._all]));
  const profileFields = [professional.description, professional.logoUrl, professional.websiteUrl, professional.contactEmail, professional.contactPhone];
  const hasServiceAreas = professional.serviceAreas.length > 0;
  const hasSpecialities = professional.specialities.length > 0;
  const completedFields = profileFields.filter(Boolean).length + (hasServiceAreas ? 1 : 0) + (hasSpecialities ? 1 : 0);
  const profileCompletenessPercent = Math.round((completedFields / (profileFields.length + 2)) * 100);

  return {
    listings: { active: byStatus.PUBLISHED ?? 0, draft: byStatus.DRAFT ?? 0, pendingReview: byStatus.PENDING_REVIEW ?? 0, paused: byStatus.PAUSED ?? 0, total: Object.values(byStatus).reduce((sum, count) => sum + count, 0) },
    newLeads: newLeadsCount,
    upcomingViewings: upcomingViewingsCount,
    teamMembers: teamCount,
    developments: developmentCount,
    profileCompletenessPercent,
    verificationStatus: professional.verificationStatus,
    plan: subscription ? { key: subscription.plan.key, name: subscription.plan.name, status: subscription.status } : null,
  };
}
