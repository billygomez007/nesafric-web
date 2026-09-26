import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createMarketplaceProfessional } from "@/modules/marketplace-professionals/service";
import {
  createHomepageCompanyLogo,
  listHomepageMediaForPlatform,
  listPublicHomepageCompanies,
  updateHomepageCompanyLogo,
} from "@/modules/platform-admin/homepage-media-service";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { PLATFORM_PERMISSIONS } from "@/platform/platform-admin/permissions";

async function cleanDatabase() {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE',
  );

  await db.tenant.deleteMany();

  await db.marketplacePlan.deleteMany({
    where: {
      key: {
        notIn: [
          "marketplace_free",
          "marketplace_pro",
          "marketplace_brokerage",
          "marketplace_enterprise",
        ],
      },
    },
  });
}

async function makePrincipal(
  email: string,
  role:
    | "SUPER_ADMIN"
    | "BILLING_ADMIN"
    | "SUPPORT_AGENT"
    | "READ_ONLY" = "SUPER_ADMIN",
) {
  const user = await registerUser({
    displayName: email,
    email,
    password: "secure-password-123",
  });

  const principal = await db.platformPrincipal.create({
    data: {
      userId: user.id,
      role,
      status: "ACTIVE",
      createdVia: "MANUAL",
    },
  });

  return { user, principal };
}

async function makeProfessional(
  email: string,
  displayName: string,
) {
  const user = await registerUser({
    displayName,
    email,
    password: "secure-password-123",
  });

  const professional = await createMarketplaceProfessional(user.id, {
    type: "BROKERAGE",
    displayName,
    countryCode: "GH",
  });

  return { user, professional };
}

async function verifyProfessional(id: string) {
  return db.marketplaceProfessional.update({
    where: { id },
    data: {
      verificationStatus: "VERIFIED",
    },
  });
}

describe("Homepage Media manager", () => {
  beforeEach(cleanDatabase);

  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("allows SUPER_ADMIN and denies other platform roles", async () => {
    const superAdmin = await makePrincipal(
      "homepage-super-admin@example.com",
      "SUPER_ADMIN",
    );

    await expect(
      requirePlatformPrincipal(
        superAdmin.user,
        PLATFORM_PERMISSIONS.homepageMediaManage,
      ),
    ).resolves.toMatchObject({
      id: superAdmin.principal.id,
    });

    for (const role of [
      "BILLING_ADMIN",
      "SUPPORT_AGENT",
      "READ_ONLY",
    ] as const) {
      const account = await makePrincipal(
        `homepage-${role.toLowerCase()}@example.com`,
        role,
      );

      await expect(
        requirePlatformPrincipal(
          account.user,
          PLATFORM_PERMISSIONS.homepageMediaManage,
        ),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });

      await expect(
        listHomepageMediaForPlatform(account.principal),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
  });

  it("rejects an unverified professional", async () => {
    const admin = await makePrincipal(
      "homepage-unverified-admin@example.com",
    );

    const { professional } = await makeProfessional(
      "homepage-unverified-company@example.com",
      "Unverified Company",
    );

    await expect(
      createHomepageCompanyLogo(
        admin.principal,
        admin.user.id,
        {
          marketplaceProfessionalId: professional.id,
          isPublished: true,
          sortOrder: 1,
        },
      ),
    ).rejects.toThrow(
      "Only active, verified marketplace professionals can be featured on the homepage.",
    );
  });

  it("rejects a suspended professional", async () => {
    const admin = await makePrincipal(
      "homepage-inactive-admin@example.com",
    );

    const { professional } = await makeProfessional(
      "homepage-inactive-company@example.com",
      "Inactive Company",
    );

    await db.marketplaceProfessional.update({
      where: { id: professional.id },
      data: {
        verificationStatus: "VERIFIED",
        status: "SUSPENDED",
      },
    });

    await expect(
      createHomepageCompanyLogo(
        admin.principal,
        admin.user.id,
        {
          marketplaceProfessionalId: professional.id,
          isPublished: true,
          sortOrder: 1,
        },
      ),
    ).rejects.toThrow(
      "Only active, verified marketplace professionals can be featured on the homepage.",
    );
  });

  it("rejects an archived professional", async () => {
    const admin = await makePrincipal(
      "homepage-archived-admin@example.com",
    );

    const { professional } = await makeProfessional(
      "homepage-archived-company@example.com",
      "Archived Company",
    );

    await db.marketplaceProfessional.update({
      where: { id: professional.id },
      data: {
        verificationStatus: "VERIFIED",
        archivedAt: new Date(),
      },
    });

    await expect(
      createHomepageCompanyLogo(
        admin.principal,
        admin.user.id,
        {
          marketplaceProfessionalId: professional.id,
          isPublished: true,
          sortOrder: 1,
        },
      ),
    ).rejects.toThrow(
      "Only active, verified marketplace professionals can be featured on the homepage.",
    );
  });

  it("rejects adding the same professional twice", async () => {
    const admin = await makePrincipal(
      "homepage-duplicate-admin@example.com",
    );

    const { professional } = await makeProfessional(
      "homepage-duplicate-company@example.com",
      "Duplicate Company",
    );

    await verifyProfessional(professional.id);

    await createHomepageCompanyLogo(
      admin.principal,
      admin.user.id,
      {
        marketplaceProfessionalId: professional.id,
        isPublished: true,
        sortOrder: 1,
      },
    );

    await expect(
      createHomepageCompanyLogo(
        admin.principal,
        admin.user.id,
        {
          marketplaceProfessionalId: professional.id,
          isPublished: true,
          sortOrder: 2,
        },
      ),
    ).rejects.toThrow(
      "This company is already in Homepage Media.",
    );
  });

  it("returns only published, active, verified, non-archived companies publicly", async () => {
    const admin = await makePrincipal(
      "homepage-public-filter-admin@example.com",
    );

    const visible = await makeProfessional(
      "homepage-visible@example.com",
      "Visible Company",
    );

    const hidden = await makeProfessional(
      "homepage-hidden@example.com",
      "Hidden Company",
    );

    const laterInactive = await makeProfessional(
      "homepage-later-inactive@example.com",
      "Later Inactive Company",
    );

    const laterArchived = await makeProfessional(
      "homepage-later-archived@example.com",
      "Later Archived Company",
    );

    for (const entry of [
      visible,
      hidden,
      laterInactive,
      laterArchived,
    ]) {
      await verifyProfessional(entry.professional.id);
    }

    await createHomepageCompanyLogo(
      admin.principal,
      admin.user.id,
      {
        marketplaceProfessionalId: visible.professional.id,
        isPublished: true,
        sortOrder: 1,
      },
    );

    await createHomepageCompanyLogo(
      admin.principal,
      admin.user.id,
      {
        marketplaceProfessionalId: hidden.professional.id,
        isPublished: false,
        sortOrder: 2,
      },
    );

    await createHomepageCompanyLogo(
      admin.principal,
      admin.user.id,
      {
        marketplaceProfessionalId:
          laterInactive.professional.id,
        isPublished: true,
        sortOrder: 3,
      },
    );

    await createHomepageCompanyLogo(
      admin.principal,
      admin.user.id,
      {
        marketplaceProfessionalId:
          laterArchived.professional.id,
        isPublished: true,
        sortOrder: 4,
      },
    );

    await db.marketplaceProfessional.update({
      where: {
        id: laterInactive.professional.id,
      },
      data: {
        status: "SUSPENDED",
      },
    });

    await db.marketplaceProfessional.update({
      where: {
        id: laterArchived.professional.id,
      },
      data: {
        archivedAt: new Date(),
      },
    });

    const publicCompanies =
      await listPublicHomepageCompanies();

    expect(
      publicCompanies.map((company) => company.displayName),
    ).toEqual(["Visible Company"]);
  });

  it("orders public companies by sortOrder then createdAt", async () => {
    const admin = await makePrincipal(
      "homepage-order-admin@example.com",
    );

    const first = await makeProfessional(
      "homepage-order-first@example.com",
      "First Company",
    );

    const second = await makeProfessional(
      "homepage-order-second@example.com",
      "Second Company",
    );

    const third = await makeProfessional(
      "homepage-order-third@example.com",
      "Third Company",
    );

    for (const entry of [first, second, third]) {
      await verifyProfessional(entry.professional.id);
    }

    await createHomepageCompanyLogo(
      admin.principal,
      admin.user.id,
      {
        marketplaceProfessionalId: first.professional.id,
        isPublished: true,
        sortOrder: 20,
      },
    );

    await createHomepageCompanyLogo(
      admin.principal,
      admin.user.id,
      {
        marketplaceProfessionalId: second.professional.id,
        isPublished: true,
        sortOrder: 10,
      },
    );

    await createHomepageCompanyLogo(
      admin.principal,
      admin.user.id,
      {
        marketplaceProfessionalId: third.professional.id,
        isPublished: true,
        sortOrder: 30,
      },
    );

    const publicCompanies =
      await listPublicHomepageCompanies();

    expect(
      publicCompanies.map((company) => company.displayName),
    ).toEqual([
      "Second Company",
      "First Company",
      "Third Company",
    ]);
  });

  it("removes a company from the public rail when it is unpublished", async () => {
    const admin = await makePrincipal(
      "homepage-unpublish-admin@example.com",
    );

    const { professional } = await makeProfessional(
      "homepage-unpublish-company@example.com",
      "Unpublish Company",
    );

    await verifyProfessional(professional.id);

    const item = await createHomepageCompanyLogo(
      admin.principal,
      admin.user.id,
      {
        marketplaceProfessionalId: professional.id,
        isPublished: true,
        sortOrder: 1,
      },
    );

    expect(
      (await listPublicHomepageCompanies()).map(
        (company) => company.displayName,
      ),
    ).toContain("Unpublish Company");

    await updateHomepageCompanyLogo(
      admin.principal,
      admin.user.id,
      item.id,
      {
        isPublished: false,
      },
    );

    expect(
      (await listPublicHomepageCompanies()).map(
        (company) => company.displayName,
      ),
    ).not.toContain("Unpublish Company");
  });
});
