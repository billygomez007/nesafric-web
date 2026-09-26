import { db } from "@/platform/database/client";
import { Prisma, type PlatformPrincipal } from "@/platform/database/generated/client";
import {
  PLATFORM_PERMISSIONS,
  platformRoleHasPermission,
  type PlatformPermission,
} from "@/platform/platform-admin/permissions";
import { AppError } from "@/platform/errors";
import { isUuid } from "@/platform/validation/uuid";
import {
  HOMEPAGE_COMPANY_TYPES,
  HOMEPAGE_INELIGIBLE_MESSAGE,
} from "@/modules/marketplace-professionals/admin-lifecycle";

export { HOMEPAGE_COMPANY_TYPES };

function requirePermission(
  principal: PlatformPrincipal,
  permission: PlatformPermission,
) {
  if (!platformRoleHasPermission(principal.role, permission)) {
    throw new AppError(
      "FORBIDDEN",
      403,
      "You do not have permission to manage homepage media.",
    );
  }
}

type HomepageLogoInput = {
  marketplaceProfessionalId?: string;
  isPublished?: boolean;
  sortOrder?: number;
};

/** The only rule for featuring a company: active account, verified, not archived, and a company
 * type. Used both for admin mutations and, as a query filter, for the public rail. */
const ELIGIBLE_PROFESSIONAL_WHERE = {
  archivedAt: null,
  status: "ACTIVE",
  verificationStatus: "VERIFIED",
  type: { in: [...HOMEPAGE_COMPANY_TYPES] },
} satisfies Prisma.MarketplaceProfessionalWhereInput;

/** Upper bound on companies returned to the Add company picker. */
const CANDIDATE_LIMIT = 500;

function normalizeSortOrder(value: unknown) {
  if (value === undefined) return undefined;

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new AppError(
      "INVALID_SORT_ORDER",
      422,
      "Homepage company sort order must be a whole number.",
    );
  }

  return value;
}

function inputObject(input: unknown): HomepageLogoInput {
  return typeof input === "object" && input !== null
    ? (input as HomepageLogoInput)
    : {};
}

async function assertEligibleProfessional(id: string) {
  const professional = isUuid(id)
    ? await db.marketplaceProfessional.findFirst({
        where: { id, ...ELIGIBLE_PROFESSIONAL_WHERE },
        select: { id: true, displayName: true },
      })
    : null;

  if (!professional) {
    throw new AppError("HOMEPAGE_COMPANY_INELIGIBLE", 422, HOMEPAGE_INELIGIBLE_MESSAGE);
  }

  return professional;
}

const duplicateCompany = () =>
  new AppError("HOMEPAGE_COMPANY_DUPLICATE", 409, "This company is already in Homepage Media.");

const itemNotFound = () =>
  new AppError("NOT_FOUND", 404, "Homepage company item not found.");

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function auditHomepage(
  tx: Prisma.TransactionClient,
  principal: PlatformPrincipal,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  await tx.platformAuditEvent.create({
    data: {
      platformPrincipalId: principal.id,
      action,
      entityType: "homepage_company_logo",
      entityId,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}

const professionalSelect = {
  id: true,
  displayName: true,
  legalName: true,
  slug: true,
  logoUrl: true,
  type: true,
  status: true,
  verificationStatus: true,
  archivedAt: true,
} as const;

export async function listHomepageMediaForPlatform(
  principal: PlatformPrincipal,
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.homepageMediaManage);

  const [items, candidates] = await Promise.all([
    db.homepageCompanyLogo.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        marketplaceProfessional: {
          select: professionalSelect,
        },
      },
    }),

    // Every company of an eligible type, whatever its state, so the admin can see why a company
    // is not yet eligible and fix it (verify / reactivate) from the same screen.
    db.marketplaceProfessional.findMany({
      where: { type: { in: [...HOMEPAGE_COMPANY_TYPES] } },
      orderBy: [{ displayName: "asc" }],
      take: CANDIDATE_LIMIT,
      select: {
        ...professionalSelect,
        homepageCompanyLogos: { select: { id: true, isPublished: true, sortOrder: true } },
      },
    }),
  ]);

  const eligibleProfessionals = candidates.filter(
    (professional) =>
      professional.archivedAt === null &&
      professional.status === "ACTIVE" &&
      professional.verificationStatus === "VERIFIED",
  );

  return {
    items,
    eligibleProfessionals,
    candidates,
    permissions: {
      canManageHomepage: true,
      canVerify: platformRoleHasPermission(principal.role, PLATFORM_PERMISSIONS.marketplaceVerify),
    },
  };
}

export async function createHomepageCompanyLogo(
  principal: PlatformPrincipal,
  actorUserId: string,
  rawInput: unknown,
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.homepageMediaManage);
  const input = inputObject(rawInput);

  const professionalId =
    typeof input.marketplaceProfessionalId === "string"
      ? input.marketplaceProfessionalId.trim()
      : "";

  if (!professionalId) {
    throw new AppError("VALIDATION_ERROR", 422, "Select a verified marketplace company.");
  }

  const requestedSortOrder = normalizeSortOrder(input.sortOrder);
  const professional = await assertEligibleProfessional(professionalId);

  const duplicate = await db.homepageCompanyLogo.findUnique({
    where: { marketplaceProfessionalId: professionalId },
    select: { id: true },
  });

  if (duplicate) throw duplicateCompany();

  try {
    return await db.$transaction(async (tx) => {
      const last = await tx.homepageCompanyLogo.aggregate({ _max: { sortOrder: true } });
      const sortOrder = requestedSortOrder ?? (last._max.sortOrder ?? -1) + 1;
      const isPublished = Boolean(input.isPublished);

      const item = await tx.homepageCompanyLogo.create({
        data: {
          marketplaceProfessionalId: professionalId,
          isPublished,
          sortOrder,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
        },
        include: {
          marketplaceProfessional: {
            select: professionalSelect,
          },
        },
      });

      await auditHomepage(tx, principal, "homepage_company.added", item.id, {
        marketplaceProfessionalId: professionalId,
        displayName: professional.displayName,
        isPublished,
        sortOrder,
        actorUserId,
      });

      return item;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateCompany();
    throw error;
  }
}

export async function updateHomepageCompanyLogo(
  principal: PlatformPrincipal,
  actorUserId: string,
  id: string,
  rawInput: unknown,
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.homepageMediaManage);
  const input = inputObject(rawInput);

  const existing = isUuid(id)
    ? await db.homepageCompanyLogo.findUnique({ where: { id } })
    : null;

  if (!existing) throw itemNotFound();

  const professionalId =
    input.marketplaceProfessionalId === undefined
      ? existing.marketplaceProfessionalId
      : String(input.marketplaceProfessionalId).trim();

  if (!professionalId) {
    throw new AppError("VALIDATION_ERROR", 422, "Select a verified marketplace company.");
  }

  const isPublished =
    input.isPublished === undefined ? existing.isPublished : Boolean(input.isPublished);
  const sortOrder = normalizeSortOrder(input.sortOrder) ?? existing.sortOrder;
  const companyChanged = professionalId !== existing.marketplaceProfessionalId;
  const publishing = isPublished && !existing.isPublished;

  // Eligibility gates what can become public. Unpublishing, reordering or keeping an item that
  // has since become ineligible stays possible — the public rail filters it out regardless.
  if (companyChanged || publishing) {
    await assertEligibleProfessional(professionalId);
  }

  if (companyChanged) {
    const duplicate = await db.homepageCompanyLogo.findUnique({
      where: { marketplaceProfessionalId: professionalId },
      select: { id: true },
    });

    if (duplicate && duplicate.id !== id) throw duplicateCompany();
  }

  const action =
    isPublished !== existing.isPublished
      ? isPublished ? "homepage_company.published" : "homepage_company.unpublished"
      : companyChanged ? "homepage_company.company_changed"
      : "homepage_company.reordered";

  try {
    return await db.$transaction(async (tx) => {
      const item = await tx.homepageCompanyLogo.update({
        where: { id },
        data: {
          marketplaceProfessionalId: professionalId,
          isPublished,
          sortOrder,
          updatedByUserId: actorUserId,
        },
        include: {
          marketplaceProfessional: {
            select: professionalSelect,
          },
        },
      });

      await auditHomepage(tx, principal, action, id, {
        marketplaceProfessionalId: professionalId,
        from: { isPublished: existing.isPublished, sortOrder: existing.sortOrder, marketplaceProfessionalId: existing.marketplaceProfessionalId },
        to: { isPublished, sortOrder, marketplaceProfessionalId: professionalId },
        actorUserId,
      });

      return item;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateCompany();
    throw error;
  }
}

/** Sets the full rail order in one transaction. `ids` must list every current homepage item
 * exactly once, so a stale screen can never silently drop or duplicate a position. */
export async function reorderHomepageCompanyLogos(
  principal: PlatformPrincipal,
  actorUserId: string,
  rawInput: unknown,
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.homepageMediaManage);

  const ids = (rawInput as { ids?: unknown } | null)?.ids;

  if (
    !Array.isArray(ids) ||
    ids.length > 1000 ||
    !ids.every((value): value is string => typeof value === "string" && isUuid(value)) ||
    new Set(ids).size !== ids.length
  ) {
    throw new AppError("VALIDATION_ERROR", 422, "Provide the homepage items in their new order.");
  }

  return db.$transaction(async (tx) => {
    const current = await tx.homepageCompanyLogo.findMany({ select: { id: true } });
    const known = new Set(current.map((item) => item.id));

    if (current.length !== ids.length || !ids.every((value) => known.has(value))) {
      throw new AppError(
        "HOMEPAGE_RAIL_CHANGED",
        409,
        "The homepage rail changed since you opened it. Reload and try again.",
      );
    }

    for (const [index, itemId] of ids.entries()) {
      await tx.homepageCompanyLogo.update({
        where: { id: itemId },
        data: { sortOrder: index, updatedByUserId: actorUserId },
      });
    }

    await auditHomepage(tx, principal, "homepage_company.reordered", "*", { order: ids, actorUserId });

    return tx.homepageCompanyLogo.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { marketplaceProfessional: { select: professionalSelect } },
    });
  });
}

export async function deleteHomepageCompanyLogo(
  principal: PlatformPrincipal,
  id: string,
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.homepageMediaManage);

  const existing = isUuid(id)
    ? await db.homepageCompanyLogo.findUnique({
        where: { id },
        select: { id: true, marketplaceProfessionalId: true, isPublished: true },
      })
    : null;

  if (!existing) throw itemNotFound();

  await db.$transaction(async (tx) => {
    await tx.homepageCompanyLogo.delete({
      where: { id },
    });

    await auditHomepage(tx, principal, "homepage_company.removed", id, {
      marketplaceProfessionalId: existing.marketplaceProfessionalId,
      wasPublished: existing.isPublished,
      actorUserId: principal.userId,
    });
  });

  return { deleted: true };
}

export async function listPublicHomepageCompanies() {
  const items = await db.homepageCompanyLogo.findMany({
    where: {
      isPublished: true,
      marketplaceProfessional: ELIGIBLE_PROFESSIONAL_WHERE,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      marketplaceProfessional: {
        select: {
          displayName: true,
          slug: true,
          logoUrl: true,
          type: true,
          verificationStatus: true,
        },
      },
    },
  });

  return items.map((item) => ({
    id: item.id,
    slug: item.marketplaceProfessional.slug,
    displayName: item.marketplaceProfessional.displayName,
    type: item.marketplaceProfessional.type,
    logoUrl: item.marketplaceProfessional.logoUrl,
    verificationStatus: item.marketplaceProfessional.verificationStatus,
  }));
}
