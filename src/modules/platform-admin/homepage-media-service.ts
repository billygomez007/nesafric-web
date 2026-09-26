import { db } from "@/platform/database/client";
import type { PlatformPrincipal } from "@/platform/database/generated/client";
import {
  PLATFORM_PERMISSIONS,
  platformRoleHasPermission,
  type PlatformPermission,
} from "@/platform/platform-admin/permissions";
import { AppError } from "@/platform/errors";

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

const HOMEPAGE_COMPANY_TYPES = [
  "BROKERAGE",
  "REAL_ESTATE_COMPANY",
  "DEVELOPER",
  "PROPERTY_MARKETING_COMPANY",
] as const;

function normalizeSortOrder(value: number | undefined) {
  if (value === undefined) return 0;

  if (!Number.isInteger(value)) {
    throw new Error("Homepage company sort order must be an integer.");
  }

  return value;
}

async function assertEligibleProfessional(id: string) {
  const professional = await db.marketplaceProfessional.findFirst({
    where: {
      id,
      archivedAt: null,
      status: "ACTIVE",
      verificationStatus: "VERIFIED",
      type: {
        in: [...HOMEPAGE_COMPANY_TYPES],
      },
    },
    select: {
      id: true,
      displayName: true,
      slug: true,
      logoUrl: true,
      type: true,
      verificationStatus: true,
    },
  });

  if (!professional) {
    throw new Error(
      "Only active, verified marketplace companies can be featured on the homepage.",
    );
  }

  return professional;
}

const professionalSelect = {
  id: true,
  displayName: true,
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

  const [items, eligibleProfessionals] = await Promise.all([
    db.homepageCompanyLogo.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        marketplaceProfessional: {
          select: professionalSelect,
        },
      },
    }),

    db.marketplaceProfessional.findMany({
      where: {
        archivedAt: null,
        status: "ACTIVE",
        verificationStatus: "VERIFIED",
        type: {
          in: [...HOMEPAGE_COMPANY_TYPES],
        },
      },
      orderBy: [{ displayName: "asc" }],
      select: {
        id: true,
        displayName: true,
        slug: true,
        logoUrl: true,
        type: true,
        verificationStatus: true,
      },
    }),
  ]);

  return { items, eligibleProfessionals };
}

export async function createHomepageCompanyLogo(
  principal: PlatformPrincipal,
  actorUserId: string,
  input: HomepageLogoInput,
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.homepageMediaManage);

  const professionalId = input.marketplaceProfessionalId?.trim();

  if (!professionalId) {
    throw new Error("Select a verified marketplace company.");
  }

  await assertEligibleProfessional(professionalId);

  const duplicate = await db.homepageCompanyLogo.findUnique({
    where: { marketplaceProfessionalId: professionalId },
    select: { id: true },
  });

  if (duplicate) {
    throw new Error("This company is already in Homepage Media.");
  }

  return db.homepageCompanyLogo.create({
    data: {
      marketplaceProfessionalId: professionalId,
      isPublished: Boolean(input.isPublished),
      sortOrder: normalizeSortOrder(input.sortOrder),
      createdByUserId: actorUserId,
      updatedByUserId: actorUserId,
    },
    include: {
      marketplaceProfessional: {
        select: professionalSelect,
      },
    },
  });
}

export async function updateHomepageCompanyLogo(
  principal: PlatformPrincipal,
  actorUserId: string,
  id: string,
  input: HomepageLogoInput,
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.homepageMediaManage);

  const existing = await db.homepageCompanyLogo.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new Error("Homepage company item not found.");
  }

  const professionalId =
    input.marketplaceProfessionalId === undefined
      ? existing.marketplaceProfessionalId
      : input.marketplaceProfessionalId.trim();

  if (!professionalId) {
    throw new Error("Select a verified marketplace company.");
  }

  await assertEligibleProfessional(professionalId);

  if (professionalId !== existing.marketplaceProfessionalId) {
    const duplicate = await db.homepageCompanyLogo.findUnique({
      where: { marketplaceProfessionalId: professionalId },
      select: { id: true },
    });

    if (duplicate && duplicate.id !== id) {
      throw new Error("This company is already in Homepage Media.");
    }
  }

  return db.homepageCompanyLogo.update({
    where: { id },
    data: {
      marketplaceProfessionalId: professionalId,
      isPublished:
        input.isPublished === undefined
          ? existing.isPublished
          : Boolean(input.isPublished),
      sortOrder:
        input.sortOrder === undefined
          ? existing.sortOrder
          : normalizeSortOrder(input.sortOrder),
      updatedByUserId: actorUserId,
    },
    include: {
      marketplaceProfessional: {
        select: professionalSelect,
      },
    },
  });
}

export async function deleteHomepageCompanyLogo(
  principal: PlatformPrincipal,
  id: string,
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.homepageMediaManage);

  const existing = await db.homepageCompanyLogo.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) {
    throw new Error("Homepage company item not found.");
  }

  await db.homepageCompanyLogo.delete({
    where: { id },
  });

  return { deleted: true };
}

export async function listPublicHomepageCompanies() {
  const items = await db.homepageCompanyLogo.findMany({
    where: {
      isPublished: true,
      marketplaceProfessional: {
        archivedAt: null,
        status: "ACTIVE",
        verificationStatus: "VERIFIED",
        type: {
          in: [...HOMEPAGE_COMPANY_TYPES],
        },
      },
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
