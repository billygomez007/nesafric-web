import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateRecurringChargeObligations } from "@/modules/recurring-charges/service";
import { db } from "@/platform/database/client";

const RUN_ID = randomUUID();
const EMAIL = `recurring-charge-${RUN_ID}@propertyos.test`;

let organisationId = "";
let ownerUserId = "";
let tenantId = "";
let secondTenantId = "";
let tenantOrganisationId = "";
let secondTenantOrganisationId = "";
let propertyId = "";
let unitId = "";
let leaseId = "";

let fixedDefinitionId = "";
let variableDefinitionId = "";
let includedDefinitionId = "";
let customDefinitionId = "";

function utc(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

async function cleanup() {
  /*
   * This integration test owns only rows referenced by the IDs captured
   * above. Never use an unscoped deleteMany here.
   */

  if (organisationId) {
    await db.chargePaymentAllocation.deleteMany({
      where: {
        chargeObligation: {
          organisationId,
        },
      },
    });

    await db.chargeObligation.deleteMany({
      where: {
        organisationId,
      },
    });

    await db.recurringChargeDefinition.deleteMany({
      where: {
        organisationId,
      },
    });
  }

  if (leaseId) {
    await db.leaseParty.deleteMany({
      where: {
        leaseId,
      },
    });

    await db.rentObligation.deleteMany({
      where: {
        leaseId,
      },
    });

    await db.lease.deleteMany({
      where: {
        id: leaseId,
      },
    });
  }

  if (secondTenantOrganisationId) {
    await db.tenantOrganisation.deleteMany({
      where: {
        id: secondTenantOrganisationId,
      },
    });
  }

  if (tenantOrganisationId) {
    await db.tenantOrganisation.deleteMany({
      where: {
        id: tenantOrganisationId,
      },
    });
  }

  if (secondTenantId) {
    await db.tenant.deleteMany({
      where: {
        id: secondTenantId,
      },
    });
  }

  if (tenantId) {
    await db.tenant.deleteMany({
      where: {
        id: tenantId,
      },
    });
  }

  if (unitId) {
    await db.unit.deleteMany({
      where: {
        id: unitId,
      },
    });
  }

  if (propertyId) {
    await db.property.deleteMany({
      where: {
        id: propertyId,
      },
    });
  }

  if (organisationId) {
    const members = await db.organisationMember.findMany({
      where: {
        organisationId,
      },
      select: {
        id: true,
      },
    });

    const memberIds = members.map((member) => member.id);

    if (memberIds.length > 0) {
      await db.membershipRole.deleteMany({
        where: {
          memberId: {
            in: memberIds,
          },
        },
      });
    }

    await db.organisationMember.deleteMany({
      where: {
        organisationId,
      },
    });

    /*
     * The recurring-charge generator records organisation-scoped audit
     * events. Remove only this integration fixture's audit events before
     * deleting the fixture organisation so the real AuditEvent foreign-key
     * protection remains intact.
     */
    await db.auditEvent.deleteMany({
      where: {
        organisationId,
      },
    });

    await db.organisation.deleteMany({
      where: {
        id: organisationId,
      },
    });
  }

  if (ownerUserId) {
    await db.session.deleteMany({
      where: {
        userId: ownerUserId,
      },
    });

    await db.user.deleteMany({
      where: {
        id: ownerUserId,
      },
    });
  }
}

beforeAll(async () => {
  /*
   * Hard safety gate.
   *
   * This test is allowed to mutate only the local PostgreSQL database
   * named "propertyos".
   */
  const identity = await db.$queryRaw<
    Array<{
      database: string;
      server: string | null;
      port: number;
    }>
  >`
    SELECT
      current_database()::text AS database,
      inet_server_addr()::text AS server,
      inet_server_port() AS port
  `;

  const current = identity[0];

  if (!current) {
    throw new Error("Unable to identify PostgreSQL database.");
  }

  if (current.database !== "propertyos") {
    throw new Error(
      `Refusing recurring-charge integration test against database ${current.database}`,
    );
  }

  const localServers = new Set(["127.0.0.1", "::1", "127.0.0.1/32", "::1/128"]);

  if (current.server !== null && !localServers.has(current.server)) {
    throw new Error(
      `Refusing recurring-charge integration test against non-local server ${current.server}`,
    );
  }

  /*
   * The schema migration requires Country/Currency reference rows.
   * These are existing platform reference records; this test reads them
   * and refuses to continue if the local fixture database is not seeded.
   */
  const country = await db.country.findUnique({
    where: {
      code: "GH",
    },
  });

  if (!country) {
    throw new Error(
      "Local integration database is missing Country GH reference data.",
    );
  }

  const currency = await db.currency.findUnique({
    where: {
      code: "GHS",
    },
  });

  if (!currency) {
    throw new Error(
      "Local integration database is missing Currency GHS reference data.",
    );
  }

  const owner = await db.user.create({
    data: {
      email: EMAIL,
      displayName: "Recurring Charge Integration Owner",
      passwordHash: `integration-${RUN_ID}`,
      emailVerifiedAt: new Date(),
    },
  });

  ownerUserId = owner.id;

  const organisation = await db.organisation.create({
    data: {
      name: `Recurring Charge Integration ${RUN_ID}`,
      type: "INDIVIDUAL_LANDLORD",
      countryCode: "GH",
      defaultCurrencyCode: "GHS",
    },
  });

  organisationId = organisation.id;

  /*
   * The recurring-charge generator is organisation-scoped and does not
   * require an HTTP principal, but the fixture still gets a normal
   * organisation membership.
   */
  await db.organisationMember.create({
    data: {
      organisationId: organisation.id,
      userId: owner.id,
    },
  });

  const property = await db.property.create({
    data: {
      organisationId: organisation.id,
      referenceNumber: `RC-PROP-${RUN_ID}`,
      name: "Recurring Charge Integration Property",
      description: "Local recurring-charge integration fixture",
      category: "RESIDENTIAL",
      countryCode: "GH",
      region: "Greater Accra",
      city: "Accra",
      addressLine1: "Integration Test Property",
      currencyCode: "GHS",
      status: "ACTIVE",
    },
  });

  propertyId = property.id;

  const unit = await db.unit.create({
    data: {
      propertyId: property.id,
      name: `RC-UNIT-${RUN_ID}`,
      unitType: "APARTMENT",
      status: "OCCUPIED",
    },
  });

  unitId = unit.id;

  const tenant = await db.tenant.create({
    data: {
      legalName: "Recurring Charge Integration Tenant",
    },
  });

  tenantId = tenant.id;

  const tenantOrganisation = await db.tenantOrganisation.create({
    data: {
      tenantId: tenant.id,
      organisationId: organisation.id,
      email: `tenant-${RUN_ID}@propertyos.test`,
      countryCode: "GH",
    },
  });

  tenantOrganisationId = tenantOrganisation.id;

  const secondTenant = await db.tenant.create({
    data: {
      legalName: "Recurring Charge Second Tenant",
    },
  });

  secondTenantId = secondTenant.id;

  const secondTenantOrganisation = await db.tenantOrganisation.create({
    data: {
      tenantId: secondTenant.id,
      organisationId: organisation.id,
      email: `tenant-two-${RUN_ID}@propertyos.test`,
      countryCode: "GH",
    },
  });

  secondTenantOrganisationId = secondTenantOrganisation.id;

  const lease = await db.lease.create({
    data: {
      organisationId: organisation.id,
      propertyId: property.id,
      unitId: unit.id,
      referenceNumber: `RC-LEASE-${RUN_ID}`,
      startDate: utc(2026, 9, 1),
      endDate: utc(2027, 8, 31),
      rentAmountMinor: "250000",
      currencyCode: "GHS",
      rentFrequency: "MONTHLY",
      status: "ACTIVE",
    },
  });

  leaseId = lease.id;

  await db.leaseParty.create({
    data: {
      leaseId: lease.id,
      tenantOrganisationId: tenantOrganisation.id,
      role: "TENANT",
      isPrimary: true,
    },
  });

  /*
   * FIXED:
   * Generates finalised collectible obligations.
   */
  const fixed = await db.recurringChargeDefinition.create({
    data: {
      organisationId: organisation.id,
      leaseId: lease.id,
      propertyId: property.id,
      unitId: unit.id,

      type: "SERVICE_CHARGE",
      name: "Monthly Service Charge",
      description: "Integration test fixed service charge",

      calculationType: "FIXED",
      amountMinor: "30000",
      currencyCode: "GHS",

      frequency: "MONTHLY",
      billingMode: "SEPARATE",

      startDate: utc(2026, 9, 1),
      dueDay: 5,

      notifyTenant: true,
      reminderDaysBefore: 3,

      status: "ACTIVE",
      createdByUserId: owner.id,
    },
  });

  fixedDefinitionId = fixed.id;

  /*
   * VARIABLE:
   * Generator creates draft obligations until an amount is supplied.
   */
  const variable = await db.recurringChargeDefinition.create({
    data: {
      organisationId: organisation.id,
      leaseId: lease.id,
      propertyId: property.id,
      unitId: unit.id,

      type: "ELECTRICITY",
      name: "Electricity",
      description: "Integration test variable utility",

      calculationType: "VARIABLE",
      amountMinor: null,
      currencyCode: "GHS",

      frequency: "MONTHLY",
      billingMode: "SEPARATE",

      startDate: utc(2026, 9, 1),
      dueDay: 10,

      notifyTenant: true,

      status: "ACTIVE",
      createdByUserId: owner.id,
    },
  });

  variableDefinitionId = variable.id;

  /*
   * INCLUDED_IN_RENT:
   * Must never create an independent collectible obligation.
   */
  const included = await db.recurringChargeDefinition.create({
    data: {
      organisationId: organisation.id,
      leaseId: lease.id,
      propertyId: property.id,
      unitId: unit.id,

      type: "WASTE_COLLECTION",
      name: "Waste Collection Included in Rent",

      calculationType: "FIXED",
      amountMinor: "10000",
      currencyCode: "GHS",

      frequency: "MONTHLY",
      billingMode: "INCLUDED_IN_RENT",

      startDate: utc(2026, 9, 1),
      dueDay: 5,

      notifyTenant: false,

      status: "ACTIVE",
      createdByUserId: owner.id,
    },
  });

  includedDefinitionId = included.id;

  /*
   * CUSTOM:
   * Human-readable recurrence exists, but the generator must not invent
   * a machine schedule.
   */
  const custom = await db.recurringChargeDefinition.create({
    data: {
      organisationId: organisation.id,
      leaseId: lease.id,
      propertyId: property.id,
      unitId: unit.id,

      type: "OTHER",
      name: "Custom Charge",

      calculationType: "FIXED",
      amountMinor: "5000",
      currencyCode: "GHS",

      frequency: "CUSTOM",
      customFrequency: "When explicitly scheduled",
      billingMode: "SEPARATE",

      startDate: utc(2026, 9, 1),

      notifyTenant: true,

      status: "ACTIVE",
      createdByUserId: owner.id,
    },
  });

  customDefinitionId = custom.id;
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("PostgreSQL recurring-charge generator", () => {
  it("creates fixed and variable obligations while respecting billing safety", async () => {
    const result = await generateRecurringChargeObligations({
      organisationId,
      throughDate: utc(2026, 10, 31),
    });

    expect(result.definitionsConsidered).toBe(4);
    expect(result.skippedIncludedInRent).toBe(1);
    expect(result.skippedCustomFrequency).toBe(1);

    const fixed = await db.chargeObligation.findMany({
      where: {
        recurringChargeDefinitionId: fixedDefinitionId,
        tenantOrganisationId,
      },
      orderBy: {
        periodStart: "asc",
      },
    });

    expect(fixed).toHaveLength(2);

    expect(
      fixed.map((obligation) => ({
        periodStart: obligation.periodStart.toISOString().slice(0, 10),
        periodEnd: obligation.periodEnd.toISOString().slice(0, 10),
        dueDate: obligation.dueDate.toISOString().slice(0, 10),
        amountMinor: obligation.amountMinor?.toFixed(0),
        finalised: Boolean(obligation.finalisedAt),
        type: obligation.typeSnapshot,
        name: obligation.nameSnapshot,
        billingMode: obligation.billingModeSnapshot,
      })),
    ).toEqual([
      {
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        dueDate: "2026-09-05",
        amountMinor: "30000",
        finalised: true,
        type: "SERVICE_CHARGE",
        name: "Monthly Service Charge",
        billingMode: "SEPARATE",
      },
      {
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        dueDate: "2026-10-05",
        amountMinor: "30000",
        finalised: true,
        type: "SERVICE_CHARGE",
        name: "Monthly Service Charge",
        billingMode: "SEPARATE",
      },
    ]);

    const variable = await db.chargeObligation.findMany({
      where: {
        recurringChargeDefinitionId: variableDefinitionId,
        tenantOrganisationId,
      },
      orderBy: {
        periodStart: "asc",
      },
    });

    expect(variable).toHaveLength(2);

    for (const obligation of variable) {
      expect(obligation.amountMinor).toBeNull();
      expect(obligation.finalisedAt).toBeNull();
      expect(obligation.status).toBe("DRAFT");
      expect(obligation.typeSnapshot).toBe("ELECTRICITY");
    }

    expect(
      await db.chargeObligation.count({
        where: {
          recurringChargeDefinitionId: includedDefinitionId,
        },
      }),
    ).toBe(0);

    expect(
      await db.chargeObligation.count({
        where: {
          recurringChargeDefinitionId: customDefinitionId,
        },
      }),
    ).toBe(0);
  });

  it("is idempotent when the same generation window is run repeatedly", async () => {
    const before = await db.chargeObligation.count({
      where: {
        organisationId,
      },
    });

    const result = await generateRecurringChargeObligations({
      organisationId,
      throughDate: utc(2026, 10, 31),
    });

    const after = await db.chargeObligation.count({
      where: {
        organisationId,
      },
    });

    expect(after).toBe(before);
    expect(result.created).toBe(0);
    expect(result.existing).toBeGreaterThan(0);
  });

  it("creates only newly-needed periods when the generation horizon advances", async () => {
    const before = await db.chargeObligation.count({
      where: {
        organisationId,
      },
    });

    const result = await generateRecurringChargeObligations({
      organisationId,
      throughDate: utc(2026, 11, 30),
    });

    const after = await db.chargeObligation.count({
      where: {
        organisationId,
      },
    });

    /*
     * One November fixed obligation and one November variable draft.
     */
    expect(after - before).toBe(2);
    expect(result.created).toBe(2);

    const novemberFixed = await db.chargeObligation.findFirstOrThrow({
      where: {
        recurringChargeDefinitionId: fixedDefinitionId,
        tenantOrganisationId,
        periodStart: utc(2026, 11, 1),
      },
    });

    expect(novemberFixed.amountMinor?.toFixed(0)).toBe("30000");
    expect(novemberFixed.finalisedAt).not.toBeNull();

    const novemberVariable = await db.chargeObligation.findFirstOrThrow({
      where: {
        recurringChargeDefinitionId: variableDefinitionId,
        tenantOrganisationId,
        periodStart: utc(2026, 11, 1),
      },
    });

    expect(novemberVariable.amountMinor).toBeNull();
    expect(novemberVariable.status).toBe("DRAFT");
  });

  it("isolates generated obligations by tenant organisation", async () => {
    await db.leaseParty.create({
      data: {
        leaseId,
        tenantOrganisationId: secondTenantOrganisationId,
        role: "TENANT",
      },
    });

    const result = await generateRecurringChargeObligations({
      organisationId,
      throughDate: utc(2026, 11, 30),
    });

    expect(result.created).toBeGreaterThan(0);

    const firstTenantFixed = await db.chargeObligation.count({
      where: {
        recurringChargeDefinitionId: fixedDefinitionId,
        tenantOrganisationId,
      },
    });

    const secondTenantFixed = await db.chargeObligation.count({
      where: {
        recurringChargeDefinitionId: fixedDefinitionId,
        tenantOrganisationId: secondTenantOrganisationId,
      },
    });

    expect(firstTenantFixed).toBe(3);
    expect(secondTenantFixed).toBe(3);

    const secondTenantVariable = await db.chargeObligation.findMany({
      where: {
        recurringChargeDefinitionId: variableDefinitionId,
        tenantOrganisationId: secondTenantOrganisationId,
      },
    });

    expect(secondTenantVariable).toHaveLength(3);

    for (const obligation of secondTenantVariable) {
      expect(obligation.status).toBe("DRAFT");
      expect(obligation.amountMinor).toBeNull();
    }
  });

  it("enforces the database compound uniqueness guard", async () => {
    const existing = await db.chargeObligation.findFirstOrThrow({
      where: {
        recurringChargeDefinitionId: fixedDefinitionId,
        tenantOrganisationId,
      },
      orderBy: {
        periodStart: "asc",
      },
    });

    await expect(
      db.chargeObligation.create({
        data: {
          organisationId: existing.organisationId,
          recurringChargeDefinitionId: existing.recurringChargeDefinitionId,
          tenantOrganisationId: existing.tenantOrganisationId,

          leaseId: existing.leaseId,
          propertyId: existing.propertyId,
          unitId: existing.unitId,

          dueDate: existing.dueDate,
          periodStart: existing.periodStart,
          periodEnd: existing.periodEnd,

          amountMinor: existing.amountMinor,
          currencyCode: existing.currencyCode,

          typeSnapshot: existing.typeSnapshot,
          nameSnapshot: existing.nameSnapshot,
          descriptionSnapshot: existing.descriptionSnapshot,
          billingModeSnapshot: existing.billingModeSnapshot,

          status: existing.status,
          collectionState: existing.collectionState,

          collectedAmountMinor: existing.collectedAmountMinor,
          waivedAmountMinor: existing.waivedAmountMinor,

          finalisedAt: existing.finalisedAt,
        },
      }),
    ).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("preserves historical snapshots when a recurring definition changes", async () => {
    const historical = await db.chargeObligation.findFirstOrThrow({
      where: {
        recurringChargeDefinitionId: fixedDefinitionId,
        tenantOrganisationId,
        periodStart: utc(2026, 9, 1),
      },
    });

    expect(historical.nameSnapshot).toBe("Monthly Service Charge");
    expect(historical.amountMinor?.toFixed(0)).toBe("30000");

    await db.recurringChargeDefinition.update({
      where: {
        id: fixedDefinitionId,
      },
      data: {
        name: "Updated Service Charge",
        amountMinor: "35000",
      },
    });

    const unchangedHistorical = await db.chargeObligation.findUniqueOrThrow({
      where: {
        id: historical.id,
      },
    });

    expect(unchangedHistorical.nameSnapshot).toBe("Monthly Service Charge");
    expect(unchangedHistorical.amountMinor?.toFixed(0)).toBe("30000");

    await generateRecurringChargeObligations({
      organisationId,
      throughDate: utc(2026, 12, 31),
      definitionId: fixedDefinitionId,
    });

    const december = await db.chargeObligation.findFirstOrThrow({
      where: {
        recurringChargeDefinitionId: fixedDefinitionId,
        tenantOrganisationId,
        periodStart: utc(2026, 12, 1),
      },
    });

    expect(december.nameSnapshot).toBe("Updated Service Charge");
    expect(december.amountMinor?.toFixed(0)).toBe("35000");
  });
});
