import { Prisma } from "@/platform/database/generated/client";

import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import {
  createRecurringChargeSchema,
  finaliseVariableChargeSchema,
  updateRecurringChargeSchema,
  waiveChargeSchema,
} from "./schemas";

type Tx = Prisma.TransactionClient;

function decimal(value: string | number | Prisma.Decimal) {
  return new Prisma.Decimal(value);
}

function startOfUtcDay(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

async function assertLeaseScope(
  tx: Tx,
  organisationId: string,
  leaseId: string,
  propertyId: string,
  unitId: string | null | undefined,
) {
  const lease = await tx.lease.findFirst({
    where: {
      id: leaseId,
      organisationId,
    },
    select: {
      id: true,
      propertyId: true,
      unitId: true,
      currencyCode: true,
      startDate: true,
      endDate: true,
      status: true,
      parties: {
        where: {
          role: "TENANT",
        },
        select: {
          tenantOrganisationId: true,
        },
      },
    },
  });

  if (!lease) {
    throw new AppError("LEASE_NOT_FOUND", 404, "Lease not found.");
  }

  if (lease.propertyId !== propertyId) {
    throw new AppError(
      "PROPERTY_MISMATCH",
      422,
      "The charge property must match the lease property.",
    );
  }

  if ((lease.unitId ?? null) !== (unitId ?? null)) {
    throw new AppError(
      "UNIT_MISMATCH",
      422,
      "The charge unit must match the lease unit.",
    );
  }

  return lease;
}

async function writeAudit(
  tx: Tx,
  input: {
    organisationId: string;
    actorUserId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Prisma.InputJsonValue;
  },
) {
  await tx.auditEvent.create({
    data: {
      organisationId: input.organisationId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata ?? {},
    },
  });
}

export async function createRecurringChargeDefinition(
  organisationId: string,
  actorUserId: string,
  rawInput: unknown,
) {
  const data = createRecurringChargeSchema.parse(rawInput);

  return db.$transaction(async (tx) => {
    const lease = await assertLeaseScope(
      tx,
      organisationId,
      data.leaseId,
      data.propertyId,
      data.unitId,
    );

    if (lease.currencyCode !== data.currencyCode) {
      throw new AppError(
        "CURRENCY_MISMATCH",
        422,
        "Charge currency must match the lease currency.",
      );
    }

    const startDate = startOfUtcDay(data.startDate);
    const endDate = data.endDate ? startOfUtcDay(data.endDate) : null;

    if (startDate < startOfUtcDay(lease.startDate)) {
      throw new AppError(
        "CHARGE_BEFORE_LEASE",
        422,
        "Charge start date cannot be before the lease start date.",
      );
    }

    if (lease.endDate && (!endDate || endDate > startOfUtcDay(lease.endDate))) {
      throw new AppError(
        "CHARGE_AFTER_LEASE",
        422,
        "Charge end date cannot extend beyond the lease end date.",
      );
    }

    const definition = await tx.recurringChargeDefinition.create({
      data: {
        organisationId,
        leaseId: data.leaseId,
        propertyId: data.propertyId,
        unitId: data.unitId ?? null,

        type: data.type,
        name: data.name,
        description: data.description ?? null,

        calculationType: data.calculationType,
        amountMinor:
          data.calculationType === "FIXED" ? decimal(data.amountMinor!) : null,
        currencyCode: data.currencyCode,

        frequency: data.frequency,
        customFrequency: data.customFrequency ?? null,

        billingMode: data.billingMode,

        startDate,
        endDate,
        dueDay: data.dueDay ?? null,

        notifyTenant: data.notifyTenant,
        reminderDaysBefore: data.reminderDaysBefore ?? null,

        status: "ACTIVE",
        createdByUserId: actorUserId,
      },
    });

    await writeAudit(tx, {
      organisationId,
      actorUserId,
      action: "recurring_charge.created",
      entityType: "recurring_charge_definition",
      entityId: definition.id,
      metadata: {
        leaseId: definition.leaseId,
        propertyId: definition.propertyId,
        unitId: definition.unitId,
        type: definition.type,
        calculationType: definition.calculationType,
        frequency: definition.frequency,
        billingMode: definition.billingMode,
      },
    });

    return definition;
  });
}

export async function listRecurringChargeDefinitions(
  organisationId: string,
  filters: {
    leaseId?: string;
    propertyId?: string;
    unitId?: string | null;
    includeArchived?: boolean;
  } = {},
) {
  return db.recurringChargeDefinition.findMany({
    where: {
      organisationId,
      ...(filters.leaseId ? { leaseId: filters.leaseId } : {}),
      ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
      ...(filters.unitId !== undefined ? { unitId: filters.unitId } : {}),
      ...(!filters.includeArchived ? { archivedAt: null } : {}),
    },
    include: {
      property: {
        select: {
          id: true,
          name: true,
          referenceNumber: true,
        },
      },
      unit: {
        select: {
          id: true,
          name: true,
        },
      },
      lease: {
        select: {
          id: true,
          referenceNumber: true,
          status: true,
        },
      },
      _count: {
        select: {
          obligations: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

export async function getRecurringChargeDefinition(
  organisationId: string,
  definitionId: string,
) {
  const definition = await db.recurringChargeDefinition.findFirst({
    where: {
      id: definitionId,
      organisationId,
    },
    include: {
      property: true,
      unit: true,
      lease: {
        include: {
          parties: {
            include: {
              tenantOrganisation: {
                include: {
                  tenant: true,
                },
              },
            },
          },
        },
      },
      obligations: {
        include: {
          tenantOrganisation: {
            include: {
              tenant: true,
            },
          },
          allocations: {
            where: {
              reversedAt: null,
            },
          },
        },
        orderBy: {
          dueDate: "desc",
        },
      },
    },
  });

  if (!definition) {
    throw new AppError(
      "RECURRING_CHARGE_NOT_FOUND",
      404,
      "Recurring charge not found.",
    );
  }

  return definition;
}

export async function updateRecurringChargeDefinition(
  organisationId: string,
  actorUserId: string,
  definitionId: string,
  rawInput: unknown,
) {
  const data = updateRecurringChargeSchema.parse(rawInput);

  return db.$transaction(async (tx) => {
    const current = await tx.recurringChargeDefinition.findFirst({
      where: {
        id: definitionId,
        organisationId,
      },
    });

    if (!current) {
      throw new AppError(
        "RECURRING_CHARGE_NOT_FOUND",
        404,
        "Recurring charge not found.",
      );
    }

    if (current.archivedAt) {
      throw new AppError(
        "RECURRING_CHARGE_ARCHIVED",
        409,
        "Archived charges cannot be edited.",
      );
    }

    if (
      current.calculationType === "VARIABLE" &&
      data.amountMinor !== undefined &&
      data.amountMinor !== null
    ) {
      throw new AppError(
        "VARIABLE_CHARGE_DEFINITION_AMOUNT",
        422,
        "Variable charges must be finalised on individual obligations.",
      );
    }

    const updated = await tx.recurringChargeDefinition.update({
      where: {
        id: definitionId,
      },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.amountMinor !== undefined
          ? {
              amountMinor:
                data.amountMinor === null ? null : decimal(data.amountMinor),
            }
          : {}),
        ...(data.endDate !== undefined
          ? {
              endDate: data.endDate ? startOfUtcDay(data.endDate) : null,
            }
          : {}),
        ...(data.dueDay !== undefined ? { dueDay: data.dueDay } : {}),
        ...(data.notifyTenant !== undefined
          ? { notifyTenant: data.notifyTenant }
          : {}),
        ...(data.reminderDaysBefore !== undefined
          ? { reminderDaysBefore: data.reminderDaysBefore }
          : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    });

    await writeAudit(tx, {
      organisationId,
      actorUserId,
      action: "recurring_charge.updated",
      entityType: "recurring_charge_definition",
      entityId: definitionId,
      metadata: {
        changedFields: Object.keys(data),
      },
    });

    return updated;
  });
}

export async function archiveRecurringChargeDefinition(
  organisationId: string,
  actorUserId: string,
  definitionId: string,
) {
  return db.$transaction(async (tx) => {
    const current = await tx.recurringChargeDefinition.findFirst({
      where: {
        id: definitionId,
        organisationId,
      },
    });

    if (!current) {
      throw new AppError(
        "RECURRING_CHARGE_NOT_FOUND",
        404,
        "Recurring charge not found.",
      );
    }

    if (current.archivedAt) return current;

    const updated = await tx.recurringChargeDefinition.update({
      where: {
        id: definitionId,
      },
      data: {
        archivedAt: new Date(),
        status: "ENDED",
      },
    });

    await writeAudit(tx, {
      organisationId,
      actorUserId,
      action: "recurring_charge.archived",
      entityType: "recurring_charge_definition",
      entityId: definitionId,
    });

    return updated;
  });
}

export async function listChargeObligations(
  organisationId: string,
  filters: {
    leaseId?: string;
    propertyId?: string;
    tenantOrganisationId?: string;
    definitionId?: string;
  } = {},
) {
  return db.chargeObligation.findMany({
    where: {
      organisationId,
      ...(filters.leaseId ? { leaseId: filters.leaseId } : {}),
      ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
      ...(filters.tenantOrganisationId
        ? { tenantOrganisationId: filters.tenantOrganisationId }
        : {}),
      ...(filters.definitionId
        ? { recurringChargeDefinitionId: filters.definitionId }
        : {}),
    },
    include: {
      recurringChargeDefinition: true,
      tenantOrganisation: {
        include: {
          tenant: true,
        },
      },
      property: {
        select: {
          id: true,
          name: true,
          referenceNumber: true,
        },
      },
      unit: {
        select: {
          id: true,
          name: true,
        },
      },
      allocations: {
        where: {
          reversedAt: null,
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });
}

export async function finaliseVariableChargeObligation(
  organisationId: string,
  actorUserId: string,
  obligationId: string,
  rawInput: unknown,
) {
  const data = finaliseVariableChargeSchema.parse(rawInput);

  return db.$transaction(async (tx) => {
    const obligation = await tx.chargeObligation.findFirst({
      where: {
        id: obligationId,
        organisationId,
      },
      include: {
        recurringChargeDefinition: true,
      },
    });

    if (!obligation) {
      throw new AppError(
        "CHARGE_OBLIGATION_NOT_FOUND",
        404,
        "Charge obligation not found.",
      );
    }

    if (obligation.recurringChargeDefinition.calculationType !== "VARIABLE") {
      throw new AppError(
        "CHARGE_NOT_VARIABLE",
        422,
        "Only variable charge obligations can be finalised manually.",
      );
    }

    if (obligation.finalisedAt) {
      throw new AppError(
        "CHARGE_ALREADY_FINALISED",
        409,
        "This variable charge has already been finalised.",
      );
    }

    const amountMinor = decimal(data.amountMinor);

    const updated = await tx.chargeObligation.update({
      where: {
        id: obligationId,
      },
      data: {
        amountMinor,
        finalisedAt: new Date(),
        status: "UPCOMING",
      },
    });

    await writeAudit(tx, {
      organisationId,
      actorUserId,
      action: "charge_obligation.finalised",
      entityType: "charge_obligation",
      entityId: obligationId,
      metadata: {
        amountMinor: amountMinor.toString(),
      },
    });

    return updated;
  });
}

export async function waiveChargeObligation(
  organisationId: string,
  actorUserId: string,
  obligationId: string,
  rawInput: unknown,
) {
  const data = waiveChargeSchema.parse(rawInput);

  return db.$transaction(async (tx) => {
    const obligation = await tx.chargeObligation.findFirst({
      where: {
        id: obligationId,
        organisationId,
      },
    });

    if (!obligation) {
      throw new AppError(
        "CHARGE_OBLIGATION_NOT_FOUND",
        404,
        "Charge obligation not found.",
      );
    }

    if (!obligation.amountMinor) {
      throw new AppError(
        "CHARGE_NOT_FINALISED",
        409,
        "The charge amount must be finalised before it can be waived.",
      );
    }

    const requestedWaiver = decimal(data.amountMinor);

    const outstanding = Prisma.Decimal.max(
      0,
      obligation.amountMinor
        .minus(obligation.collectedAmountMinor)
        .minus(obligation.waivedAmountMinor),
    );

    if (requestedWaiver.greaterThan(outstanding)) {
      throw new AppError(
        "WAIVER_EXCEEDS_OUTSTANDING",
        422,
        "Waiver cannot exceed the outstanding charge balance.",
      );
    }

    const waivedAmountMinor =
      obligation.waivedAmountMinor.plus(requestedWaiver);

    const settled = obligation.collectedAmountMinor
      .plus(waivedAmountMinor)
      .greaterThanOrEqualTo(obligation.amountMinor);

    const updated = await tx.chargeObligation.update({
      where: {
        id: obligationId,
      },
      data: {
        waivedAmountMinor,
        ...(settled
          ? {
              status: "WAIVED",
              collectionState: obligation.collectedAmountMinor.greaterThan(0)
                ? "PARTIALLY_PAID"
                : "UNPAID",
            }
          : {}),
      },
    });

    await writeAudit(tx, {
      organisationId,
      actorUserId,
      action: "charge_obligation.waived",
      entityType: "charge_obligation",
      entityId: obligationId,
      metadata: {
        amountMinor: requestedWaiver.toString(),
        reason: data.reason,
      },
    });

    return updated;
  });
}

export async function refreshChargeObligationStatuses(organisationId: string) {
  const today = startOfUtcDay(new Date());

  return db.$transaction(async (tx) => {
    const obligations = await tx.chargeObligation.findMany({
      where: {
        organisationId,
        amountMinor: {
          not: null,
        },
        status: {
          in: ["UPCOMING", "DUE", "OVERDUE"],
        },
      },
    });

    let updated = 0;

    for (const obligation of obligations) {
      if (!obligation.amountMinor) continue;

      const settledAmount = obligation.collectedAmountMinor.plus(
        obligation.waivedAmountMinor,
      );

      let status: "UPCOMING" | "DUE" | "OVERDUE" | "SATISFIED";

      if (settledAmount.greaterThanOrEqualTo(obligation.amountMinor)) {
        status = "SATISFIED";
      } else if (obligation.dueDate < today) {
        status = "OVERDUE";
      } else if (obligation.dueDate.getTime() === today.getTime()) {
        status = "DUE";
      } else {
        status = "UPCOMING";
      }

      const collectionState =
        obligation.collectedAmountMinor.greaterThanOrEqualTo(
          obligation.amountMinor,
        )
          ? "FULLY_PAID"
          : obligation.collectedAmountMinor.greaterThan(0)
            ? "PARTIALLY_PAID"
            : "UNPAID";

      if (
        status !== obligation.status ||
        collectionState !== obligation.collectionState
      ) {
        await tx.chargeObligation.update({
          where: {
            id: obligation.id,
          },
          data: {
            status,
            collectionState,
          },
        });

        updated += 1;
      }
    }

    return {
      inspected: obligations.length,
      updated,
    };
  });
}

import {
  calculateRecurringChargeDueDate,
  determineChargeObligationStatus,
  enumerateRecurringChargePeriods,
} from "./domain";

type ChargeGenerationResult = {
  definitionsConsidered: number;
  periodsConsidered: number;
  created: number;
  existing: number;
  skippedIncludedInRent: number;
  skippedNoTenant: number;
  skippedCustomFrequency: number;
};

function decimalToBigInt(value: Prisma.Decimal | null): bigint | null {
  if (value === null) {
    return null;
  }

  return BigInt(value.toFixed(0));
}

function obligationStatusForGeneration(input: {
  amountMinor: Prisma.Decimal | null;
  finalisedAt: Date | null;
  dueDate: Date;
  now: Date;
}) {
  return determineChargeObligationStatus({
    amountMinor: decimalToBigInt(input.amountMinor),
    finalisedAt: input.finalisedAt,
    dueDate: input.dueDate,
    now: input.now,
    collectedAmountMinor: BigInt("0"),
    waivedAmountMinor: BigInt("0"),
  });
}

async function tenantOrganisationIdsForLease(
  tx: Tx,
  leaseId: string,
): Promise<string[]> {
  const parties = await tx.leaseParty.findMany({
    where: {
      leaseId,
      role: "TENANT",
    },
    select: {
      tenantOrganisationId: true,
    },
  });

  return [
    ...new Set(
      parties
        .map((party) => party.tenantOrganisationId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

export async function generateRecurringChargeObligations(input: {
  organisationId: string;
  actorUserId?: string | null;
  throughDate?: Date;
  definitionId?: string;
}) {
  const throughDate = startOfUtcDay(input.throughDate ?? new Date());

  const result: ChargeGenerationResult = {
    definitionsConsidered: 0,
    periodsConsidered: 0,
    created: 0,
    existing: 0,
    skippedIncludedInRent: 0,
    skippedNoTenant: 0,
    skippedCustomFrequency: 0,
  };

  await db.$transaction(async (tx) => {
    const definitions = await tx.recurringChargeDefinition.findMany({
      where: {
        organisationId: input.organisationId,
        archivedAt: null,
        status: "ACTIVE",
        ...(input.definitionId ? { id: input.definitionId } : {}),
        startDate: {
          lte: throughDate,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    result.definitionsConsidered = definitions.length;

    for (const definition of definitions) {
      /*
       * INCLUDED_IN_RENT is intentionally non-collectible here.
       *
       * It may be displayed as part of the lease/rent composition later,
       * but generating a separate payable obligation would risk charging
       * the tenant twice.
       */
      if (definition.billingMode === "INCLUDED_IN_RENT") {
        result.skippedIncludedInRent += 1;
        continue;
      }

      /*
       * CUSTOM describes a charge that does not yet have a machine-readable
       * recurrence rule. It must not silently invent dates.
       */
      if (definition.frequency === "CUSTOM") {
        result.skippedCustomFrequency += 1;
        continue;
      }

      const tenantOrganisationIds = await tenantOrganisationIdsForLease(
        tx,
        definition.leaseId,
      );

      if (tenantOrganisationIds.length === 0) {
        result.skippedNoTenant += 1;
        continue;
      }

      const periods = enumerateRecurringChargePeriods({
        frequency: definition.frequency,
        startDate: definition.startDate,
        endDate: definition.endDate,
        throughDate,
      });

      for (const period of periods) {
        /*
         * A definition can start inside a calendar period.
         * Do not create a period whose end precedes the configured start.
         *
         * The current foundation intentionally does not prorate charges.
         * Proration, if introduced, must be an explicit financial policy.
         */
        if (period.periodEnd.getTime() < definition.startDate.getTime()) {
          continue;
        }

        result.periodsConsidered += 1;

        const dueDate = calculateRecurringChargeDueDate({
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          dueDay: definition.dueDay,
        });

        const amountMinor =
          definition.calculationType === "FIXED"
            ? definition.amountMinor
            : null;

        const finalisedAt =
          definition.calculationType === "FIXED" ? new Date() : null;

        const status = obligationStatusForGeneration({
          amountMinor,
          finalisedAt,
          dueDate,
          now: throughDate,
        });

        for (const tenantOrganisationId of tenantOrganisationIds) {
          const existing = await tx.chargeObligation.findUnique({
            where: {
              recurringChargeDefinitionId_tenantOrganisationId_periodStart_periodEnd:
                {
                  recurringChargeDefinitionId: definition.id,
                  tenantOrganisationId,
                  periodStart: period.periodStart,
                  periodEnd: period.periodEnd,
                },
            },
            select: {
              id: true,
            },
          });

          if (existing) {
            result.existing += 1;
            continue;
          }

          try {
            await tx.chargeObligation.create({
              data: {
                organisationId: definition.organisationId,
                recurringChargeDefinitionId: definition.id,
                tenantOrganisationId,

                leaseId: definition.leaseId,
                propertyId: definition.propertyId,
                unitId: definition.unitId,

                dueDate,
                periodStart: period.periodStart,
                periodEnd: period.periodEnd,

                amountMinor,
                currencyCode: definition.currencyCode,

                typeSnapshot: definition.type,
                nameSnapshot: definition.name,
                descriptionSnapshot: definition.description,
                billingModeSnapshot: definition.billingMode,

                status,
                collectionState: "UNPAID",

                collectedAmountMinor: decimal(0),
                waivedAmountMinor: decimal(0),

                finalisedAt,
              },
            });

            result.created += 1;
          } catch (error) {
            /*
             * The compound unique constraint is the final concurrency guard.
             * If two workers race, one may win and the other safely treats
             * the P2002 as an already-created obligation.
             */
            if (
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === "P2002"
            ) {
              result.existing += 1;
              continue;
            }

            throw error;
          }
        }
      }
    }

    await writeAudit(tx, {
      organisationId: input.organisationId,
      actorUserId: input.actorUserId ?? null,
      action: "charge_obligations.generated",
      entityType: "charge_obligation_batch",
      entityId: input.definitionId ?? input.organisationId,
      metadata: {
        definitionId: input.definitionId ?? null,
        throughDate: throughDate.toISOString(),
        definitionsConsidered: result.definitionsConsidered,
        periodsConsidered: result.periodsConsidered,
        created: result.created,
        existing: result.existing,
        skippedIncludedInRent: result.skippedIncludedInRent,
        skippedNoTenant: result.skippedNoTenant,
        skippedCustomFrequency: result.skippedCustomFrequency,
      },
    });
  });

  return result;
}
