import {
  MarketplaceEnquiryStatus,
  Prisma,
  ProviderAvailabilityStatus,
  ProviderVerificationStatus,
} from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { AppError, forbidden, notFound } from "@/platform/errors";
import {
  createMarketplaceEnquirySchema,
  marketplaceEnquiryListSchema,
  marketplaceProviderIdSchema,
  marketplaceQuoteRequestSchema,
  publicMarketplaceDiscoverySchema,
  updateMarketplaceEnquirySchema,
  updateMarketplaceProfileSchema,
} from "./schemas";

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;

export const PUBLIC_MARKETPLACE_RATE_LIMIT = {
  policy: "public-marketplace-read",
  limit: 120,
  windowSeconds: 60,
  keyStrategy: "ip+route",
  enforcement: "gateway-ready",
} as const;

const profileInclude = {
  provider: true,
  categories: { include: { category: true }, orderBy: { category: { name: "asc" as const } } },
  serviceAreas: { orderBy: [{ countryCode: "asc" as const }, { region: "asc" as const }, { city: "asc" as const }] },
} satisfies Prisma.ProviderMarketplaceProfileInclude;

async function ownsProvider(userId: string, providerId: string, tx: Tx | typeof db = db) {
  return tx.serviceProvider.findFirst({
    where: {
      id: providerId,
      archivedAt: null,
      OR: [
        { individualUserId: userId },
        { administratorUserId: userId },
        {
          companyOrganisation: {
            members: {
              some: {
                userId,
                status: "ACTIVE",
                archivedAt: null,
                roles: { some: { role: { key: { in: ["organisation_owner", "administrator"] } } } },
              },
            },
          },
        },
      ],
    },
  });
}

async function requireProviderOwner(userId: string, providerId: string, tx: Tx | typeof db = db) {
  const provider = await ownsProvider(userId, providerId, tx);
  if (!provider) throw forbidden();
  return provider;
}

async function marketplaceEventOrganisations(tx: Tx, providerId: string) {
  const provider = await tx.serviceProvider.findUniqueOrThrow({
    where: { id: providerId },
    select: {
      companyOrganisationId: true,
      directories: { where: { status: "ACTIVE" }, select: { landlordOrganisationId: true } },
    },
  });
  return [...new Set([
    ...(provider.companyOrganisationId ? [provider.companyOrganisationId] : []),
    ...provider.directories.map(({ landlordOrganisationId }) => landlordOrganisationId),
  ])];
}

async function record(
  tx: Tx,
  organisationId: string,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown> = {},
) {
  await tx.auditEvent.create({
    data: { organisationId, actorUserId, action, entityType, entityId, metadata: json(payload) },
  });
  await tx.domainEvent.create({
    data: { organisationId, name: action, aggregateType: entityType, aggregateId: entityId, payload: json(payload) },
  });
}

function profileSnapshot(profile: {
  listed: boolean;
  publicDescription: string | null;
  showContactEmail: boolean;
  showContactPhone: boolean;
  startingRateMinor: Prisma.Decimal | null;
  currencyCode: string | null;
  responseTimeHours: number | null;
  categories: Array<{ categoryId: string }>;
  serviceAreas: Array<{
    countryCode: string;
    region: string | null;
    city: string | null;
    district: string | null;
    label: string | null;
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
    radiusKm: Prisma.Decimal | null;
  }>;
}) {
  return {
    listed: profile.listed,
    publicDescription: profile.publicDescription,
    showContactEmail: profile.showContactEmail,
    showContactPhone: profile.showContactPhone,
    startingRateMinor: profile.startingRateMinor?.toString() ?? null,
    currencyCode: profile.currencyCode,
    responseTimeHours: profile.responseTimeHours,
    categoryIds: profile.categories.map(({ categoryId }) => categoryId).sort(),
    serviceAreas: profile.serviceAreas.map((area) => ({
      countryCode: area.countryCode,
      region: area.region,
      city: area.city,
      district: area.district,
      label: area.label,
      latitude: area.latitude?.toString() ?? null,
      longitude: area.longitude?.toString() ?? null,
      radiusKm: area.radiusKm?.toString() ?? null,
    })),
  };
}

export async function getMarketplaceProfile(userId: string, providerId: string) {
  await requireProviderOwner(userId, providerId);
  const profile = await db.providerMarketplaceProfile.findUnique({
    where: { providerId },
    include: {
      ...profileInclude,
      history: { orderBy: { createdAt: "desc" }, take: 100 },
    },
  });
  return profile ?? {
    providerId,
    listed: false,
    publicDescription: null,
    showContactEmail: false,
    showContactPhone: false,
    startingRateMinor: null,
    currencyCode: null,
    responseTimeHours: null,
    categories: [],
    serviceAreas: [],
    history: [],
  };
}

export async function listMarketplaceProfileHistory(userId: string, providerId: string) {
  await requireProviderOwner(userId, providerId);
  return db.providerMarketplaceProfileHistory.findMany({
    where: { providerId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function updateMarketplaceProfile(userId: string, providerId: string, input: unknown) {
  const data = updateMarketplaceProfileSchema.parse(input);
  return db.$transaction(async (tx) => {
    const provider = await requireProviderOwner(userId, providerId, tx);
    const current = await tx.providerMarketplaceProfile.findUnique({
      where: { providerId },
      include: { categories: true, serviceAreas: true },
    });
    if (data.categoryIds) {
      const count = await tx.serviceProviderCategory.count({
        where: { providerId, categoryId: { in: data.categoryIds }, category: { active: true } },
      });
      if (count !== new Set(data.categoryIds).size) {
        throw new AppError("INVALID_PUBLIC_CATEGORY", 422, "Public categories must be active categories on this provider.");
      }
    }
    if (data.showContactEmail && !provider.contactEmail) {
      throw new AppError("PUBLIC_CONTACT_UNAVAILABLE", 422, "The provider has no email address to publish.");
    }
    if (data.showContactPhone && !provider.contactPhone) {
      throw new AppError("PUBLIC_CONTACT_UNAVAILABLE", 422, "The provider has no phone number to publish.");
    }
    const startingRateMinor = data.startingRateMinor === undefined
      ? current?.startingRateMinor
      : data.startingRateMinor === null ? null : new Prisma.Decimal(data.startingRateMinor);
    const currencyCode = data.currencyCode === undefined ? current?.currencyCode : data.currencyCode;
    if (startingRateMinor !== null && startingRateMinor !== undefined && !currencyCode) {
      throw new AppError("RATE_CURRENCY_REQUIRED", 422, "Currency is required when a starting rate is published.");
    }
    if (data.currencyCode === null && startingRateMinor !== null && startingRateMinor !== undefined) {
      throw new AppError("RATE_CURRENCY_REQUIRED", 422, "Remove the starting rate before removing its currency.");
    }
    const categoryCount = data.categoryIds?.length ?? current?.categories.length ?? 0;
    const areaCount = data.serviceAreas?.length ?? current?.serviceAreas.length ?? 0;
    if (data.listed && (!categoryCount || !areaCount)) {
      throw new AppError("INCOMPLETE_MARKETPLACE_PROFILE", 409, "At least one explicit public category and service area are required to list.");
    }
    if (data.listed && provider.verificationStatus !== "VERIFIED") {
      throw new AppError(
        "PROVIDER_NOT_VERIFIED",
        409,
        "Identity verification must be approved before this provider can be publicly listed.",
      );
    }
    if (data.listed && provider.suspendedAt) {
      throw new AppError("PROVIDER_SUSPENDED", 409, "A suspended provider cannot be publicly listed.");
    }
    if (data.serviceAreas) {
      const keys = data.serviceAreas.map((area) => [
        area.countryCode,
        area.region?.toLocaleLowerCase() ?? "",
        area.city?.toLocaleLowerCase() ?? "",
        area.district?.toLocaleLowerCase() ?? "",
      ].join("|"));
      if (new Set(keys).size !== keys.length) {
        throw new AppError("DUPLICATE_PUBLIC_SERVICE_AREA", 422, "Public service areas must be unique.");
      }
    }

    const now = new Date();
    const listed = data.listed ?? current?.listed ?? false;
    const { categoryIds, serviceAreas, ...fields } = data;
    await tx.providerMarketplaceProfile.upsert({
      where: { providerId },
      create: {
        providerId,
        ...fields,
        startingRateMinor,
        currencyCode,
        listed,
        listedAt: listed ? now : null,
        unlistedAt: listed ? null : now,
      },
      update: {
        ...fields,
        startingRateMinor,
        currencyCode,
        ...(data.listed === undefined ? {} : {
          listed,
          listedAt: listed ? current?.listedAt ?? now : current?.listedAt,
          unlistedAt: listed ? null : now,
        }),
      },
    });
    if (categoryIds) {
      await tx.providerMarketplaceCategory.deleteMany({ where: { providerId } });
      if (categoryIds.length) {
        await tx.providerMarketplaceCategory.createMany({
          data: categoryIds.map((categoryId) => ({ providerId, categoryId })),
        });
      }
    }
    if (serviceAreas) {
      await tx.providerMarketplaceServiceArea.deleteMany({ where: { providerId } });
      if (serviceAreas.length) {
        await tx.providerMarketplaceServiceArea.createMany({
          data: serviceAreas.map((area) => ({
            ...area,
            providerId,
            latitude: area.latitude === undefined ? undefined : new Prisma.Decimal(area.latitude),
            longitude: area.longitude === undefined ? undefined : new Prisma.Decimal(area.longitude),
            radiusKm: area.radiusKm === undefined ? undefined : new Prisma.Decimal(area.radiusKm),
          })),
        });
      }
    }
    const updated = await tx.providerMarketplaceProfile.findUniqueOrThrow({
      where: { providerId },
      include: { categories: true, serviceAreas: true },
    });
    const action = !current?.listed && updated.listed
      ? "provider.marketplace_listed"
      : current?.listed && !updated.listed
        ? "provider.marketplace_unlisted"
        : "provider.marketplace_profile_updated";
    const changedFields = Object.keys(data).sort();
    await tx.providerMarketplaceProfileHistory.create({
      data: {
        providerId,
        actorUserId: userId,
        action,
        changedFields,
        snapshot: json(profileSnapshot(updated)),
      },
    });
    for (const organisationId of await marketplaceEventOrganisations(tx, providerId)) {
      await record(tx, organisationId, userId, action, "provider_marketplace_profile", providerId, { changedFields });
    }
    return tx.providerMarketplaceProfile.findUniqueOrThrow({ where: { providerId }, include: profileInclude });
  });
}

type RankRow = {
  id: string;
  total: bigint;
  score: number;
  category_score: number;
  area_score: number;
  verification_score: number;
  availability_score: number;
  rating_score: number;
  completed_score: number;
  readiness_score: number;
  average_rating: number | null;
  rating_count: bigint;
  completed_jobs: bigint;
};

const publicProfile = (
  profile: Prisma.ProviderMarketplaceProfileGetPayload<{ include: typeof profileInclude }>,
  rank: RankRow,
) => ({
  id: profile.providerId,
  slug: profile.provider.slug,
  displayName: profile.provider.displayName,
  type: profile.provider.type,
  description: profile.publicDescription,
  availability: profile.provider.availabilityStatus,
  verification: profile.provider.verificationStatus,
  acceptingWork: profile.provider.acceptingWork,
  categories: profile.categories.map(({ category }) => ({
    id: category.id,
    key: category.key,
    name: category.name,
  })),
  serviceAreas: profile.serviceAreas.map((area) => ({
    countryCode: area.countryCode,
    region: area.region,
    city: area.city,
    district: area.district,
    label: area.label,
    latitude: area.latitude?.toString() ?? null,
    longitude: area.longitude?.toString() ?? null,
    radiusKm: area.radiusKm?.toString() ?? null,
  })),
  contact: {
    email: profile.showContactEmail ? profile.provider.contactEmail : null,
    phone: profile.showContactPhone ? profile.provider.contactPhone : null,
  },
  pricing: {
    startingRateMinor: profile.startingRateMinor?.toString() ?? null,
    currencyCode: profile.currencyCode,
  },
  responseTimeHours: profile.responseTimeHours,
  aggregateRating: rank.average_rating === null ? null : Number(rank.average_rating),
  ratingCount: Number(rank.rating_count),
  completedJobs: Number(rank.completed_jobs),
  ranking: {
    score: Number(rank.score),
    signals: {
      categoryMatch: Number(rank.category_score),
      areaMatch: Number(rank.area_score),
      verification: Number(rank.verification_score),
      availability: Number(rank.availability_score),
      aggregateRating: Number(rank.rating_score),
      completedJobs: Number(rank.completed_score),
      ratesAndResponseReadiness: Number(rank.readiness_score),
    },
  },
});

function rankingQuery(filters: ReturnType<typeof publicMarketplaceDiscoverySchema.parse>, page: boolean) {
  const region = filters.region ?? filters.state;
  const conditions: Prisma.Sql[] = [
    Prisma.sql`mp."listed" = true`,
    Prisma.sql`p."archivedAt" IS NULL`,
    // Unconditional, regardless of any caller-supplied filter — a provider whose verification
    // status has moved away from VERIFIED (rejected, suspended, flagged for more information)
    // must disappear from public discovery immediately, not just at the point `listed` was set.
    Prisma.sql`p."verificationStatus" = 'VERIFIED'`,
    // Platform-wide suspension (`ServiceProvider.suspendedAt`) is independent of
    // `verificationStatus` — a provider can remain VERIFIED while suspended platform-wide.
    Prisma.sql`p."suspendedAt" IS NULL`,
  ];
  if (filters.category || filters.categoryId) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ProviderMarketplaceCategory" mpc
      JOIN "ServiceCategory" c ON c."id" = mpc."categoryId"
      WHERE mpc."providerId" = p."id"
        ${filters.category ? Prisma.sql`AND c."key" = ${filters.category}` : Prisma.sql`AND c."id" = ${filters.categoryId}::uuid`}
        AND c."active" = true
    )`);
  }
  if (filters.country) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ProviderMarketplaceServiceArea" msa
      WHERE msa."providerId" = p."id"
        AND msa."countryCode" = ${filters.country}
        ${region ? Prisma.sql`AND (msa."region" IS NULL OR lower(msa."region") = lower(${region}))` : Prisma.empty}
        ${filters.city ? Prisma.sql`AND (msa."city" IS NULL OR lower(msa."city") = lower(${filters.city}))` : Prisma.empty}
        ${filters.district ? Prisma.sql`AND (msa."district" IS NULL OR lower(msa."district") = lower(${filters.district}))` : Prisma.empty}
    )`);
  }
  if (filters.availability) conditions.push(Prisma.sql`p."availabilityStatus" = ${filters.availability}::"ProviderAvailabilityStatus"`);
  if (filters.verification) conditions.push(Prisma.sql`p."verificationStatus" = ${filters.verification}::"ProviderVerificationStatus"`);
  if (filters.providerType) conditions.push(Prisma.sql`p."type" = ${filters.providerType}::"ServiceProviderType"`);
  if (filters.minimumRating !== undefined) {
    conditions.push(Prisma.sql`COALESCE((SELECT avg(r."score") FROM "ProviderRating" r WHERE r."providerId" = p."id"), 0) >= ${filters.minimumRating}`);
  }
  const offset = (filters.page - 1) * filters.pageSize;
  return Prisma.sql`
    WITH signals AS (
      SELECT
        p."id",
        ${filters.category || filters.categoryId ? 30 : 0}::int AS category_score,
        ${filters.country ? Prisma.sql`COALESCE((
          SELECT max(
            10
            + CASE WHEN ${region ?? null}::text IS NOT NULL AND lower(msa."region") = lower(${region ?? null}) THEN 10 ELSE 0 END
            + CASE WHEN ${filters.city ?? null}::text IS NOT NULL AND lower(msa."city") = lower(${filters.city ?? null}) THEN 10 ELSE 0 END
            + CASE WHEN ${filters.district ?? null}::text IS NOT NULL AND lower(msa."district") = lower(${filters.district ?? null}) THEN 10 ELSE 0 END
          )
          FROM "ProviderMarketplaceServiceArea" msa
          WHERE msa."providerId" = p."id" AND msa."countryCode" = ${filters.country}
        ), 0)` : 0}::int AS area_score,
        CASE p."verificationStatus" WHEN 'VERIFIED' THEN 15 WHEN 'PENDING' THEN 5 ELSE 0 END::int AS verification_score,
        CASE p."availabilityStatus" WHEN 'AVAILABLE' THEN 10 WHEN 'LIMITED' THEN 5 ELSE 0 END::int AS availability_score,
        round(COALESCE((SELECT avg(r."score") FROM "ProviderRating" r WHERE r."providerId" = p."id"), 0) * 4)::int AS rating_score,
        LEAST((SELECT count(*) FROM "ProviderAssignment" a WHERE a."providerId" = p."id" AND a."status" = 'COMPLETED'), 10)::int AS completed_score,
        (
          CASE WHEN p."acceptingWork" THEN 3 ELSE 0 END
          + CASE WHEN p."contactReady" THEN 2 ELSE 0 END
          + CASE WHEN mp."startingRateMinor" IS NOT NULL THEN 2 ELSE 0 END
          + CASE WHEN mp."responseTimeHours" IS NOT NULL THEN 3 ELSE 0 END
        )::int AS readiness_score,
        (SELECT avg(r."score")::float FROM "ProviderRating" r WHERE r."providerId" = p."id") AS average_rating,
        (SELECT count(*) FROM "ProviderRating" r WHERE r."providerId" = p."id") AS rating_count,
        (SELECT count(*) FROM "ProviderAssignment" a WHERE a."providerId" = p."id" AND a."status" = 'COMPLETED') AS completed_jobs
      FROM "ServiceProvider" p
      JOIN "ProviderMarketplaceProfile" mp ON mp."providerId" = p."id"
      WHERE ${Prisma.join(conditions, " AND ")}
    ),
    ranked AS (
      SELECT *, (
        category_score + area_score + verification_score + availability_score
        + rating_score + completed_score + readiness_score
      )::int AS score
      FROM signals
    )
    SELECT *, count(*) OVER() AS total
    FROM ranked
    ORDER BY score DESC, average_rating DESC NULLS LAST, completed_jobs DESC, id ASC
    ${page ? Prisma.sql`LIMIT ${filters.pageSize} OFFSET ${offset}` : Prisma.empty}
  `;
}

const rankingMetadata = {
  version: "marketplace-v1",
  deterministicTieBreakers: ["aggregateRating", "completedJobs", "providerId"],
  maximumSignalPoints: {
    categoryMatch: 30,
    areaMatch: 40,
    verification: 15,
    availability: 10,
    aggregateRating: 20,
    completedJobs: 10,
    ratesAndResponseReadiness: 10,
  },
  privateSignalsUsed: false,
} as const;

export async function discoverMarketplaceProviders(query: unknown = {}) {
  const filters = publicMarketplaceDiscoverySchema.parse(query);
  const ranks = await db.$queryRaw<RankRow[]>(rankingQuery(filters, true));
  const profiles = ranks.length
    ? await db.providerMarketplaceProfile.findMany({
      where: { providerId: { in: ranks.map(({ id }) => id) }, listed: true },
      include: profileInclude,
    })
    : [];
  const byId = new Map(profiles.map((profile) => [profile.providerId, profile]));
  const items = ranks.flatMap((rank) => {
    const profile = byId.get(rank.id);
    return profile ? [publicProfile(profile, rank)] : [];
  });
  const firstMatch = !ranks.length && filters.page > 1
    ? (await db.$queryRaw<RankRow[]>(rankingQuery({ ...filters, page: 1, pageSize: 1 }, true)))[0]
    : undefined;
  const total = ranks.length ? Number(ranks[0].total) : Number(firstMatch?.total ?? 0);
  return {
    items,
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.ceil(total / filters.pageSize),
    },
    meta: { ranking: rankingMetadata, rateLimit: PUBLIC_MARKETPLACE_RATE_LIMIT },
  };
}

export async function getPublicMarketplaceProviderBySlug(slug: string) {
  const provider = await db.serviceProvider.findFirst({
    where: { slug, verificationStatus: "VERIFIED", archivedAt: null },
    select: { id: true },
  });
  if (!provider) throw notFound();
  return getPublicMarketplaceProvider(provider.id);
}

export async function getPublicMarketplaceProvider(providerId: string) {
  providerId = marketplaceProviderIdSchema.parse(providerId);
  const filters = publicMarketplaceDiscoverySchema.parse({ page: 1, pageSize: 1 });
  const ranks = await db.$queryRaw<RankRow[]>(Prisma.sql`
    SELECT * FROM (${rankingQuery(filters, false)}) public_ranking WHERE id = ${providerId}::uuid
  `);
  const profile = await db.providerMarketplaceProfile.findFirst({
    where: { providerId, listed: true, provider: { archivedAt: null } },
    include: profileInclude,
  });
  if (!profile || !ranks[0]) throw notFound();
  return {
    provider: publicProfile(profile, ranks[0]),
    meta: { ranking: rankingMetadata, rateLimit: PUBLIC_MARKETPLACE_RATE_LIMIT },
  };
}

const enquiryInclude = {
  category: { select: { id: true, key: true, name: true } },
  provider: { select: { id: true, displayName: true } },
  requestingOrganisation: { select: { id: true, name: true, countryCode: true } },
  history: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.MarketplaceEnquiryInclude;

async function canAccessProviderEnquiry(userId: string, providerId: string, tx: Tx | typeof db = db) {
  return Boolean(await ownsProvider(userId, providerId, tx));
}

export async function createMarketplaceEnquiry(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.marketplaceEnquiryCreate);
  const data = createMarketplaceEnquirySchema.parse(input);
  return db.$transaction(async (tx) => {
    const profile = await tx.providerMarketplaceProfile.findFirst({
      where: {
        providerId: data.providerId,
        listed: true,
        provider: { archivedAt: null, verificationStatus: "VERIFIED" },
        categories: { some: { categoryId: data.categoryId, category: { active: true } } },
      },
    });
    if (!profile) throw new AppError("MARKETPLACE_PROVIDER_UNAVAILABLE", 409, "The listed provider does not publish this category.");
    const maintenance = data.maintenanceRequestId
      ? await tx.maintenanceRequest.findFirst({
        where: { id: data.maintenanceRequestId, organisationId },
        select: { id: true, propertyId: true },
      })
      : null;
    if (data.maintenanceRequestId && !maintenance) throw notFound();
    if (data.propertyId) {
      const property = await tx.property.findFirst({ where: { id: data.propertyId, organisationId }, select: { id: true } });
      if (!property) throw notFound();
    }
    if (maintenance && data.propertyId && maintenance.propertyId !== data.propertyId) {
      throw new AppError("INVALID_ENQUIRY_SCOPE", 422, "The maintenance request does not belong to the scoped property.");
    }
    const enquiry = await tx.marketplaceEnquiry.create({
      data: {
        requestingOrganisationId: organisationId,
        providerId: data.providerId,
        categoryId: data.categoryId,
        propertyId: data.propertyId ?? maintenance?.propertyId,
        maintenanceRequestId: data.maintenanceRequestId,
        requestedByUserId: userId,
        message: data.message,
        history: { create: { actorUserId: userId, toStatus: "NEW" } },
      },
      include: enquiryInclude,
    });
    await record(tx, organisationId, userId, "marketplace.enquiry_created", "marketplace_enquiry", enquiry.id, {
      providerId: enquiry.providerId,
      categoryId: enquiry.categoryId,
      hasPropertyScope: Boolean(enquiry.propertyId),
      hasMaintenanceScope: Boolean(enquiry.maintenanceRequestId),
    });
    return enquiry;
  });
}

export async function listMarketplaceEnquiries(
  userId: string,
  organisationId: string | null,
  query: unknown = {},
) {
  const filters = marketplaceEnquiryListSchema.parse(query);
  const providerOwned = filters.providerId
    ? await canAccessProviderEnquiry(userId, filters.providerId)
    : false;
  if (!providerOwned) {
    if (!organisationId) throw new AppError("ORGANISATION_REQUIRED", 400, "An active organisation is required.");
    await requirePermission(userId, organisationId, PERMISSIONS.marketplaceEnquiryRead);
  }
  const where: Prisma.MarketplaceEnquiryWhereInput = {
    ...(providerOwned
      ? { providerId: filters.providerId }
      : { requestingOrganisationId: organisationId!, ...(filters.providerId ? { providerId: filters.providerId } : {}) }),
    ...(filters.status ? { status: filters.status } : {}),
  };
  const [items, total] = await db.$transaction([
    db.marketplaceEnquiry.findMany({
      where,
      include: enquiryInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.marketplaceEnquiry.count({ where }),
  ]);
  return {
    items,
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.ceil(total / filters.pageSize),
    },
  };
}

export async function getMarketplaceEnquiry(
  userId: string,
  organisationId: string | null,
  enquiryId: string,
) {
  const enquiry = await db.marketplaceEnquiry.findUnique({ where: { id: enquiryId }, include: enquiryInclude });
  if (!enquiry) throw notFound();
  if (!await canAccessProviderEnquiry(userId, enquiry.providerId)) {
    if (!organisationId || enquiry.requestingOrganisationId !== organisationId) throw notFound();
    await requirePermission(userId, organisationId, PERMISSIONS.marketplaceEnquiryRead);
  }
  return enquiry;
}

const enquiryTransitions: Record<MarketplaceEnquiryStatus, MarketplaceEnquiryStatus[]> = {
  NEW: ["VIEWED", "RESPONDED", "CLOSED", "CANCELLED"],
  VIEWED: ["RESPONDED", "CLOSED", "CANCELLED"],
  RESPONDED: ["CLOSED", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};

export async function updateMarketplaceEnquiry(
  userId: string,
  organisationId: string | null,
  enquiryId: string,
  input: unknown,
) {
  const data = updateMarketplaceEnquirySchema.parse(input);
  return db.$transaction(async (tx) => {
    const enquiry = await tx.marketplaceEnquiry.findUnique({ where: { id: enquiryId } });
    if (!enquiry) throw notFound();
    const providerOwned = await canAccessProviderEnquiry(userId, enquiry.providerId, tx);
    if (["VIEWED", "RESPONDED"].includes(data.status) && !providerOwned) throw forbidden();
    if (data.status === "CANCELLED") {
      if (!organisationId || organisationId !== enquiry.requestingOrganisationId) throw notFound();
      await requirePermission(userId, organisationId, PERMISSIONS.marketplaceEnquiryManage);
    }
    if (data.status === "CLOSED" && !providerOwned) {
      if (!organisationId || organisationId !== enquiry.requestingOrganisationId) throw notFound();
      await requirePermission(userId, organisationId, PERMISSIONS.marketplaceEnquiryManage);
    }
    if (!enquiryTransitions[enquiry.status].includes(data.status)) {
      throw new AppError("INVALID_ENQUIRY_TRANSITION", 409, "The enquiry cannot transition to that status.");
    }
    const now = new Date();
    const updated = await tx.marketplaceEnquiry.update({
      where: { id: enquiry.id },
      data: {
        status: data.status,
        viewedAt: data.status === "VIEWED" ? now : enquiry.viewedAt,
        respondedAt: data.status === "RESPONDED" ? now : enquiry.respondedAt,
        closedAt: data.status === "CLOSED" ? now : enquiry.closedAt,
        cancelledAt: data.status === "CANCELLED" ? now : enquiry.cancelledAt,
        history: {
          create: {
            actorUserId: userId,
            fromStatus: enquiry.status,
            toStatus: data.status,
            note: data.note,
          },
        },
      },
      include: enquiryInclude,
    });
    await record(tx, enquiry.requestingOrganisationId, userId, "marketplace.enquiry_updated", "marketplace_enquiry", enquiry.id, {
      providerId: enquiry.providerId,
      fromStatus: enquiry.status,
      toStatus: data.status,
    });
    return updated;
  });
}

export async function requestMarketplaceQuote(
  userId: string,
  organisationId: string,
  enquiryId: string,
  input: unknown,
) {
  await requirePermission(userId, organisationId, PERMISSIONS.marketplaceQuoteRequest);
  const data = marketplaceQuoteRequestSchema.parse(input);
  if (data.responseDueAt && data.responseDueAt <= new Date()) {
    throw new AppError("INVALID_RESPONSE_DUE_AT", 422, "Response due date must be in the future.");
  }
  return db.$transaction(async (tx) => {
    const enquiry = await tx.marketplaceEnquiry.findFirst({
      where: { id: enquiryId, requestingOrganisationId: organisationId },
    });
    if (!enquiry) throw notFound();
    if (!enquiry.maintenanceRequestId) {
      throw new AppError("MAINTENANCE_REQUEST_REQUIRED", 422, "A direct quotation requires a scoped maintenance request.");
    }
    if (["CLOSED", "CANCELLED"].includes(enquiry.status)) {
      throw new AppError("IMMUTABLE_ENQUIRY", 409, "A quotation cannot be requested from a closed enquiry.");
    }
    const provider = await tx.serviceProvider.findUniqueOrThrow({ where: { id: enquiry.providerId } });
    const evidenceCount = await tx.providerEvidence.count({
      where: { providerId: provider.id, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
    if (
      provider.verificationStatus !== "VERIFIED"
      || provider.suspendedAt !== null
      || !provider.contactReady
      || !provider.evidenceReady
      || evidenceCount === 0
      || !provider.acceptingWork
      || provider.availabilityStatus === "UNAVAILABLE"
    ) {
      throw new AppError("PROVIDER_NOT_READY", 409, "The provider is not ready to receive a quotation request.");
    }
    const maintenance = await tx.maintenanceRequest.findFirst({
      where: { id: enquiry.maintenanceRequestId, organisationId },
    });
    if (!maintenance) throw notFound();
    if (["COMPLETED", "CLOSED", "REJECTED", "CANCELLED"].includes(maintenance.status)) {
      throw new AppError("INVALID_MAINTENANCE_STATE", 409, "A quotation cannot be requested for terminal maintenance.");
    }
    const directory = await tx.providerOrganisation.findUnique({
      where: {
        landlordOrganisationId_providerId: {
          landlordOrganisationId: organisationId,
          providerId: provider.id,
        },
      },
    });
    if (directory && directory.status !== "ACTIVE") {
      throw new AppError("PROVIDER_DIRECTORY_INACTIVE", 409, "The provider directory relationship is not active.");
    }
    if (!directory) {
      const relationship = await tx.providerOrganisation.create({
        data: {
          landlordOrganisationId: organisationId,
          providerId: provider.id,
          createdByUserId: userId,
        },
      });
      await record(tx, organisationId, userId, "provider.directory_added", "service_provider", provider.id, {
        providerOrganisationId: relationship.id,
        source: "marketplace",
      });
    }
    let quotationRequest = await tx.providerQuotationRequest.findUnique({
      where: {
        landlordOrganisationId_providerId_maintenanceRequestId: {
          landlordOrganisationId: organisationId,
          providerId: provider.id,
          maintenanceRequestId: maintenance.id,
        },
      },
    });
    if (quotationRequest && !["OPEN", "SUBMITTED"].includes(quotationRequest.status)) {
      throw new AppError("IMMUTABLE_QUOTATION_REQUEST", 409, "The existing quotation request is closed.");
    }
    const reused = Boolean(quotationRequest);
    if (!quotationRequest) {
      quotationRequest = await tx.providerQuotationRequest.create({
        data: {
          landlordOrganisationId: organisationId,
          providerId: provider.id,
          maintenanceRequestId: maintenance.id,
          requestedByUserId: userId,
          scope: data.scope,
          responseDueAt: data.responseDueAt,
        },
      });
      const quoteEvent = {
        providerId: provider.id,
        maintenanceRequestId: maintenance.id,
        enquiryId: enquiry.id,
      };
      await record(tx, organisationId, userId, "provider.quotation_requested", "provider_quotation_request", quotationRequest.id, quoteEvent);
      await record(tx, organisationId, userId, "quote.requested", "provider_quotation_request", quotationRequest.id, quoteEvent);
    }
    await tx.marketplaceEnquiry.update({
      where: { id: enquiry.id },
      data: { quotationRequestId: quotationRequest.id },
    });
    await record(tx, organisationId, userId, "marketplace.quote_requested", "provider_quotation_request", quotationRequest.id, {
      enquiryId: enquiry.id,
      providerId: provider.id,
      maintenanceRequestId: maintenance.id,
      reused,
    });
    return quotationRequest;
  });
}

export type PublicMarketplaceAvailability = ProviderAvailabilityStatus;
export type PublicMarketplaceVerification = ProviderVerificationStatus;
