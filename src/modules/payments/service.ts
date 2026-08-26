import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { membershipHasPermission } from "@/platform/authorization/policy";
import { AppError, forbidden, notFound } from "@/platform/errors";
import {
  depositCheckoutSchema,
  depositSchema,
  manualPaymentSchema,
  paymentIntentSchema,
  paymentListQuerySchema,
  reconciliationListQuerySchema,
  reversePaymentSchema,
  tenantCheckoutSchema,
  tenantDepositCheckoutSchema,
} from "./schemas";
import { PaymentProviderRegistry, paymentProviders, type NormalizedProviderEvent } from "./providers";
import { enqueueNotificationDelivery } from "@/modules/notifications/service";
// Side-effect import: registers the Ghana mobile-money/card/bank gateway adapters onto the
// shared `paymentProviders` registry the first time the payments service is loaded.
import "./gateways";

type Tx = Prisma.TransactionClient;
type AllocationInput = { rentObligationId: string; amountMinor: string };

const money = (value: string | Prisma.Decimal) => new Prisma.Decimal(value);
const reference = (prefix: string) => `${prefix}-${randomUUID()}`;
const transactionOptions = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;
const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
const isTransactionConflict = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";

async function hasPermission(userId: string, organisationId: string, permission: string) {
  const membership = await db.organisationMember.findFirst({
    where: { userId, organisationId, status: "ACTIVE", archivedAt: null },
    include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
  });
  return membership ? membershipHasPermission(membership.roles, permission) : false;
}

/** A tenant may act on their own behalf (self-service checkout, own history) without organisation-membership permissions. */
async function requireTenantSelf(userId: string, organisationId: string, tenantOrganisationId: string) {
  const tenant = await db.tenantOrganisation.findFirst({
    where: { id: tenantOrganisationId, organisationId, userId, archivedAt: null },
  });
  if (!tenant) throw forbidden();
  return tenant;
}

async function isTenantUser(userId: string, organisationId: string, tenantOrganisationId: string) {
  return db.tenantOrganisation.findFirst({ where: { id: tenantOrganisationId, organisationId, userId, archivedAt: null } });
}

/**
 * Creates (or reuses) an IN_APP notification for a payment outcome, respecting the tenant's
 * communication preference, and returns its id so the caller can enqueue delivery once the
 * enclosing transaction has committed (background-job enqueueing is not transactional).
 */
async function notifyPaymentOutcome(
  tx: Tx,
  payment: { id: string; organisationId: string; leaseId: string; tenantOrganisationId: string },
  eventType: "PAYMENT_RECEIVED" | "PAYMENT_FAILED",
) {
  const tenant = await tx.tenantOrganisation.findUnique({ where: { id: payment.tenantOrganisationId }, select: { communicationInAppAllowed: true } });
  if (!tenant?.communicationInAppAllowed) return null;
  const existing = await tx.notification.findFirst({
    where: { leaseId: payment.leaseId, tenantOrganisationId: payment.tenantOrganisationId, eventType, dedupeReference: payment.id, channel: "IN_APP" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const notification = await tx.notification.create({
    data: {
      organisationId: payment.organisationId,
      leaseId: payment.leaseId,
      tenantOrganisationId: payment.tenantOrganisationId,
      eventType,
      dedupeReference: payment.id,
      channel: "IN_APP",
      scheduledAt: new Date(),
    },
  });
  return notification.id;
}

async function serializableTransaction<T>(callback: (tx: Tx) => Promise<T>) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await db.$transaction(callback, transactionOptions);
    } catch (error) {
      if (!isTransactionConflict(error) || attempt === 3) throw error;
    }
  }
  throw new Error("Transaction retry limit reached.");
}

async function scopedLease(tx: Tx, organisationId: string, leaseId: string, tenantOrganisationId: string) {
  const lease = await tx.lease.findFirst({
    where: {
      id: leaseId,
      organisationId,
      archivedAt: null,
      parties: { some: { tenantOrganisationId, role: "TENANT" } },
    },
  });
  if (!lease) throw new AppError("INVALID_PAYMENT_RELATIONSHIP", 422, "The tenant and lease do not belong to this organisation.");
  return lease;
}

function paymentInclude() {
  return {
    tenantOrganisation: { include: { tenant: true } },
    lease: { select: { id: true, referenceNumber: true } },
    property: { select: { id: true, name: true } },
    unit: { select: { id: true, name: true } },
    allocations: { include: { rentObligation: true }, orderBy: { allocatedAt: "asc" as const } },
    receipt: true,
    ledgerEntries: { orderBy: { createdAt: "asc" as const } },
  };
}

function depositInclude() {
  return {
    tenantOrganisation: { include: { tenant: true } },
    lease: { select: { id: true, referenceNumber: true } },
    property: { select: { id: true, name: true } },
    unit: { select: { id: true, name: true } },
    ledgerEntries: { orderBy: { createdAt: "asc" as const } },
  };
}

async function ledgerEntry(
  tx: Tx,
  input: Prisma.FinancialLedgerEntryUncheckedCreateInput,
) {
  const entry = await tx.financialLedgerEntry.create({ data: input });
  await tx.domainEvent.create({
    data: {
      organisationId: input.organisationId,
      name: "ledger.entry_created",
      aggregateType: "financial_ledger_entry",
      aggregateId: entry.id,
      payload: { type: entry.type, direction: entry.direction, amountMinor: entry.amountMinor.toString(), reference: entry.reference },
    },
  });
  return entry;
}

async function allocatePayment(
  tx: Tx,
  payment: {
    id: string;
    organisationId: string;
    leaseId: string;
    amountMinor: Prisma.Decimal;
    currencyCode: string;
  },
  requested?: AllocationInput[],
) {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "RentObligation"
    WHERE "organisationId" = ${payment.organisationId}::uuid AND "leaseId" = ${payment.leaseId}::uuid
    ORDER BY "dueDate", "id" FOR UPDATE
  `);
  const obligations = await tx.rentObligation.findMany({
    where: { organisationId: payment.organisationId, leaseId: payment.leaseId, status: { not: "CANCELLED" } },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
  });
  const byId = new Map(obligations.map((obligation) => [obligation.id, obligation]));
  if (requested && new Set(requested.map(({ rentObligationId }) => rentObligationId)).size !== requested.length) {
    throw new AppError("DUPLICATE_ALLOCATION", 409, "A payment can only be allocated once to an obligation.");
  }

  let remaining = payment.amountMinor;
  const plan: Array<{ obligation: (typeof obligations)[number]; amount: Prisma.Decimal }> = [];
  if (requested) {
    for (const item of requested) {
      const obligation = byId.get(item.rentObligationId);
      if (!obligation || obligation.currencyCode !== payment.currencyCode) {
        throw new AppError("INVALID_ALLOCATION", 422, "Every allocation must target an obligation for the same lease and currency.");
      }
      const amount = money(item.amountMinor);
      const outstanding = obligation.amountMinor.minus(obligation.collectedAmountMinor);
      if (amount.greaterThan(outstanding)) throw new AppError("OVER_ALLOCATION", 422, "An allocation cannot exceed the obligation balance.");
      if (amount.greaterThan(remaining)) throw new AppError("PAYMENT_OVER_ALLOCATED", 422, "Allocations cannot exceed the payment amount.");
      plan.push({ obligation, amount });
      remaining = remaining.minus(amount);
    }
  } else {
    for (const obligation of obligations) {
      if (remaining.isZero()) break;
      const outstanding = obligation.amountMinor.minus(obligation.collectedAmountMinor);
      if (outstanding.lessThanOrEqualTo(0) || obligation.currencyCode !== payment.currencyCode) continue;
      const amount = Prisma.Decimal.min(outstanding, remaining);
      plan.push({ obligation, amount });
      remaining = remaining.minus(amount);
    }
  }

  for (const { obligation, amount } of plan) {
    const collectedAmountMinor = obligation.collectedAmountMinor.plus(amount);
    const collectionState = collectedAmountMinor.greaterThanOrEqualTo(obligation.amountMinor) ? "FULLY_PAID" : "PARTIALLY_PAID";
    await tx.paymentAllocation.create({
      data: { paymentId: payment.id, rentObligationId: obligation.id, amountMinor: amount },
    });
    await tx.rentObligation.update({
      where: { id: obligation.id },
      data: { collectedAmountMinor, collectionState, ...(collectionState === "FULLY_PAID" ? { status: "SATISFIED" as const } : {}) },
    });
    await tx.domainEvent.create({
      data: {
        organisationId: payment.organisationId,
        name: collectionState === "FULLY_PAID" ? "rent_obligation.satisfied" : "rent_obligation.partially_paid",
        aggregateType: "rent_obligation",
        aggregateId: obligation.id,
        payload: { paymentId: payment.id, allocatedAmountMinor: amount.toString(), collectedAmountMinor: collectedAmountMinor.toString() },
      },
    });
  }
  if (plan.length) {
    await tx.domainEvent.create({
      data: {
        organisationId: payment.organisationId,
        name: "payment.allocated",
        aggregateType: "payment",
        aggregateId: payment.id,
        payload: { allocationCount: plan.length, allocatedAmountMinor: payment.amountMinor.minus(remaining).toString(), unallocatedAmountMinor: remaining.toString() },
      },
    });
  }
  return remaining;
}

async function completeSuccessfulPayment(
  tx: Tx,
  payment: {
    id: string;
    organisationId: string;
    tenantOrganisationId: string;
    leaseId: string;
    propertyId: string;
    unitId: string | null;
    amountMinor: Prisma.Decimal;
    currencyCode: string;
    method: "CASH" | "BANK_TRANSFER" | "MOBILE_MONEY" | "CARD";
    paidAt: Date;
    internalReference: string;
    createdByUserId: string | null;
  },
  allocations?: AllocationInput[],
) {
  await allocatePayment(tx, payment, allocations);
  await ledgerEntry(tx, {
    organisationId: payment.organisationId,
    propertyId: payment.propertyId,
    unitId: payment.unitId,
    leaseId: payment.leaseId,
    paymentId: payment.id,
    type: "RENT_PAYMENT",
    direction: "CREDIT",
    amountMinor: payment.amountMinor,
    currencyCode: payment.currencyCode,
    effectiveAt: payment.paidAt,
    reference: payment.internalReference,
    createdByUserId: payment.createdByUserId,
  });
  const receipt = await tx.receipt.create({
    data: {
      organisationId: payment.organisationId,
      paymentId: payment.id,
      tenantOrganisationId: payment.tenantOrganisationId,
      leaseId: payment.leaseId,
      propertyId: payment.propertyId,
      unitId: payment.unitId,
      receiptNumber: reference("RCP"),
      amountMinor: payment.amountMinor,
      currencyCode: payment.currencyCode,
      method: payment.method,
      paidAt: payment.paidAt,
    },
  });
  await tx.domainEvent.createMany({
    data: [
      { organisationId: payment.organisationId, name: "payment.succeeded", aggregateType: "payment", aggregateId: payment.id, payload: { receiptId: receipt.id } },
      { organisationId: payment.organisationId, name: "receipt.issued", aggregateType: "receipt", aggregateId: receipt.id, payload: { paymentId: payment.id, receiptNumber: receipt.receiptNumber } },
    ],
  });
  const notificationId = await notifyPaymentOutcome(tx, payment, "PAYMENT_RECEIVED");
  return { notificationId };
}

export async function createManualPayment(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.paymentRecord);
  const data = manualPaymentSchema.parse(input);
  if (data.idempotencyKey) {
    const existing = await db.payment.findUnique({
      where: { organisationId_idempotencyKey: { organisationId, idempotencyKey: data.idempotencyKey } },
      include: paymentInclude(),
    });
    if (existing) {
      if (
        !existing.amountMinor.equals(money(data.amountMinor))
        || existing.currencyCode !== data.currencyCode
        || existing.leaseId !== data.leaseId
        || existing.tenantOrganisationId !== data.tenantOrganisationId
      ) throw new AppError("IDEMPOTENCY_CONFLICT", 409, "The idempotency key was already used for a different payment.");
      return existing;
    }
  }
  try {
    const result = await serializableTransaction(async (tx) => {
      const lease = await scopedLease(tx, organisationId, data.leaseId, data.tenantOrganisationId);
      if (lease.currencyCode !== data.currencyCode) throw new AppError("CURRENCY_MISMATCH", 422, "Payment currency must match the lease.");
      const payment = await tx.payment.create({
        data: {
          organisationId,
          tenantOrganisationId: data.tenantOrganisationId,
          leaseId: lease.id,
          propertyId: lease.propertyId,
          unitId: lease.unitId,
          internalReference: reference("PAY"),
          amountMinor: data.amountMinor,
          currencyCode: data.currencyCode,
          method: data.method,
          source: "MANUAL",
          status: "SUCCEEDED",
          paidAt: data.paidAt,
          externalReference: data.externalReference,
          evidenceReference: data.evidenceReference,
          idempotencyKey: data.idempotencyKey,
          reconciliationStatus: "UNMATCHED",
          createdByUserId: userId,
          confirmedAt: new Date(),
        },
      });
      await tx.domainEvent.create({
        data: { organisationId, name: "payment.created", aggregateType: "payment", aggregateId: payment.id, payload: { source: "MANUAL", method: payment.method } },
      });
      const { notificationId } = await completeSuccessfulPayment(tx, payment, data.allocations);
      await tx.auditEvent.create({
        data: { organisationId, actorUserId: userId, action: "payment.manual_recorded", entityType: "payment", entityId: payment.id, metadata: { externalReference: payment.externalReference } },
      });
      return { payment: await tx.payment.findUniqueOrThrow({ where: { id: payment.id }, include: paymentInclude() }), notificationId };
    });
    if (result.notificationId) await enqueueNotificationDelivery({ id: result.notificationId, organisationId });
    return result.payment;
  } catch (error) {
    if (data.idempotencyKey && isUniqueViolation(error)) {
      const existing = await db.payment.findUnique({
        where: { organisationId_idempotencyKey: { organisationId, idempotencyKey: data.idempotencyKey } },
        include: paymentInclude(),
      });
      if (existing) {
        if (
          !existing.amountMinor.equals(money(data.amountMinor))
          || existing.currencyCode !== data.currencyCode
          || existing.leaseId !== data.leaseId
          || existing.tenantOrganisationId !== data.tenantOrganisationId
        ) throw new AppError("IDEMPOTENCY_CONFLICT", 409, "The idempotency key was already used for a different payment.");
        return existing;
      }
    }
    throw error;
  }
}

export async function createPaymentIntent(
  userId: string,
  organisationId: string,
  input: unknown,
  registry: PaymentProviderRegistry = paymentProviders,
) {
  await requirePermission(userId, organisationId, PERMISSIONS.paymentRecord);
  const data = paymentIntentSchema.parse(input);
  return performCreatePaymentIntent(userId, organisationId, data, registry, "RENT");
}

/**
 * Tenant self-service checkout: a `TenantOrganisation.userId` owner may initiate a payment
 * intent for their own lease without organisation-membership permissions, mirroring the
 * tenant self-service pattern already established for maintenance requests. Staff recording a
 * payment on a tenant's behalf continue to use `createPaymentIntent`.
 */
export async function createTenantPaymentCheckout(
  userId: string,
  organisationId: string,
  tenantOrganisationId: string,
  input: unknown,
  registry: PaymentProviderRegistry = paymentProviders,
) {
  await requireTenantSelf(userId, organisationId, tenantOrganisationId);
  const data = tenantCheckoutSchema.parse(input);
  return performCreatePaymentIntent(userId, organisationId, { ...data, tenantOrganisationId }, registry, "RENT");
}

/**
 * Manager-initiated security-deposit checkout. Reuses the exact same provider-checkout plumbing
 * as `createPaymentIntent` (same schema, same provider adapters), but the intent is created with
 * `purpose: "DEPOSIT"` so `reconcileProviderEvent` routes a verified success into a
 * `SecurityDeposit` instead of a `Payment`/rent allocation.
 */
export async function createDepositCheckout(
  userId: string,
  organisationId: string,
  input: unknown,
  registry: PaymentProviderRegistry = paymentProviders,
) {
  await requirePermission(userId, organisationId, PERMISSIONS.depositRecord);
  const data = depositCheckoutSchema.parse(input);
  return performCreatePaymentIntent(userId, organisationId, data, registry, "DEPOSIT");
}

/** Tenant self-service equivalent of `createDepositCheckout`, mirroring `createTenantPaymentCheckout`. */
export async function createTenantDepositCheckout(
  userId: string,
  organisationId: string,
  tenantOrganisationId: string,
  input: unknown,
  registry: PaymentProviderRegistry = paymentProviders,
) {
  await requireTenantSelf(userId, organisationId, tenantOrganisationId);
  const data = tenantDepositCheckoutSchema.parse(input);
  return performCreatePaymentIntent(userId, organisationId, { ...data, tenantOrganisationId }, registry, "DEPOSIT");
}

type PaymentIntentInput = ReturnType<typeof paymentIntentSchema.parse>;
type PaymentIntentPurpose = "RENT" | "DEPOSIT";

async function performCreatePaymentIntent(
  userId: string,
  organisationId: string,
  data: PaymentIntentInput,
  registry: PaymentProviderRegistry,
  purpose: PaymentIntentPurpose,
) {
  const adapter = registry.get(data.providerKey);
  if (!adapter.supportedMethods.includes(data.method)) throw new AppError("PAYMENT_METHOD_UNSUPPORTED", 422, "The adapter does not support this payment method.");
  const existing = await db.paymentIntent.findUnique({
    where: { organisationId_idempotencyKey: { organisationId, idempotencyKey: data.idempotencyKey } },
  });
  let intent = existing;
  if (existing) {
    if (
      !existing.amountMinor.equals(money(data.amountMinor))
      || existing.currencyCode !== data.currencyCode
      || existing.leaseId !== data.leaseId
      || existing.tenantOrganisationId !== data.tenantOrganisationId
      || existing.method !== data.method
      || existing.providerKey !== data.providerKey
      || existing.purpose !== purpose
    ) throw new AppError("IDEMPOTENCY_CONFLICT", 409, "The idempotency key was already used for a different payment request.");
    if (existing.providerIntentRef) return existing;
  }
  if (!intent) {
    const lease = await scopedLease(db, organisationId, data.leaseId, data.tenantOrganisationId);
    if (lease.currencyCode !== data.currencyCode) throw new AppError("CURRENCY_MISMATCH", 422, "Payment currency must match the lease.");
    try {
      intent = await db.paymentIntent.create({
        data: {
          organisationId,
          tenantOrganisationId: data.tenantOrganisationId,
          leaseId: lease.id,
          propertyId: lease.propertyId,
          unitId: lease.unitId,
          internalReference: reference("PI"),
          amountMinor: data.amountMinor,
          currencyCode: data.currencyCode,
          method: data.method,
          purpose,
          status: "PROCESSING",
          providerKey: adapter.key,
          idempotencyKey: data.idempotencyKey,
          createdByUserId: userId,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await db.paymentIntent.findUnique({
          where: { organisationId_idempotencyKey: { organisationId, idempotencyKey: data.idempotencyKey } },
        });
        if (raced) {
          if (
            !raced.amountMinor.equals(money(data.amountMinor))
            || raced.currencyCode !== data.currencyCode
            || raced.leaseId !== data.leaseId
            || raced.tenantOrganisationId !== data.tenantOrganisationId
            || raced.method !== data.method
            || raced.providerKey !== data.providerKey
            || raced.purpose !== purpose
          ) throw new AppError("IDEMPOTENCY_CONFLICT", 409, "The idempotency key was already used for a different payment request.");
          return raced;
        }
      }
      throw error;
    }
  }
  const internalReference = intent.internalReference;
  try {
    const result = await adapter.createIntent({
      internalReference,
      amountMinor: data.amountMinor,
      currencyCode: data.currencyCode,
      method: data.method,
      returnUrl: data.returnUrl,
      metadata: data.metadata,
    });
    return await serializableTransaction(async (tx) => {
      const updated = await tx.paymentIntent.update({
        where: { id: intent.id },
        data: {
          providerIntentRef: result.providerIntentReference,
          status: result.status,
          expiresAt: result.expiresAt,
          providerPayload: result.providerPayload as Prisma.InputJsonValue | undefined,
        },
      });
      await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "payment_intent.created", entityType: "payment_intent", entityId: intent.id } });
      await tx.domainEvent.create({ data: { organisationId, name: "payment.created", aggregateType: "payment_intent", aggregateId: intent.id, payload: { providerKey: adapter.key, method: data.method } } });
      return updated;
    });
  } catch (error) {
    await db.$transaction(async (tx) => {
      await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "FAILED" } });
      await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "payment_intent.failed", entityType: "payment_intent", entityId: intent.id } });
      await tx.domainEvent.create({ data: { organisationId, name: "payment.failed", aggregateType: "payment_intent", aggregateId: intent.id, payload: { providerKey: adapter.key } } });
    });
    // Never mask a provider-unavailable or other classified failure behind a generic 502: the
    // caller (checkout UI) needs the distinct status/code to explain why checkout failed.
    if (error instanceof AppError) throw error;
    throw new AppError("PAYMENT_PROVIDER_ERROR", 502, error instanceof Error ? error.message : "The payment provider could not create the request.");
  }
}

export async function getPaymentIntent(userId: string, organisationId: string, intentId: string) {
  const intent = await db.paymentIntent.findFirst({ where: { id: intentId, organisationId } });
  if (!intent) throw notFound();
  const internal = await hasPermission(userId, organisationId, PERMISSIONS.paymentRead);
  if (!internal && !await isTenantUser(userId, organisationId, intent.tenantOrganisationId)) throw forbidden();
  return intent;
}

/** Lists the registered payment provider adapters and whether each has the environment configuration it needs, without exposing secrets. */
export function listAvailablePaymentProviders(registry: PaymentProviderRegistry = paymentProviders) {
  return registry.list().map((adapter) => ({
    key: adapter.key,
    displayName: adapter.displayName ?? adapter.key,
    supportedMethods: adapter.supportedMethods,
    available: adapter.isConfigured ? adapter.isConfigured() : true,
  }));
}

function reconciliationEventInclude() {
  return { payment: { include: paymentInclude() }, securityDeposit: { include: depositInclude() } };
}

/**
 * Creates the `SecurityDeposit` for a verified successful DEPOSIT-purpose webhook. Deposits stay
 * financially separate from rent: no `RentObligation` allocation, no `Payment`, no `Receipt` —
 * only the deposit record itself plus an immutable `DEPOSIT_RECEIPT` ledger entry, tagged
 * `source = PROVIDER` so it is distinguishable from a staff-recorded manual deposit.
 */
async function completeSuccessfulDeposit(
  tx: Tx,
  intent: {
    id: string;
    organisationId: string;
    tenantOrganisationId: string;
    leaseId: string;
    propertyId: string;
    unitId: string | null;
    amountMinor: Prisma.Decimal;
    currencyCode: string;
    method: "CASH" | "BANK_TRANSFER" | "MOBILE_MONEY" | "CARD";
    createdByUserId: string;
  },
  providerKey: string,
  event: NormalizedProviderEvent,
) {
  const deposit = await tx.securityDeposit.create({
    data: {
      organisationId: intent.organisationId,
      tenantOrganisationId: intent.tenantOrganisationId,
      leaseId: intent.leaseId,
      propertyId: intent.propertyId,
      unitId: intent.unitId,
      paymentIntentId: intent.id,
      internalReference: reference("DEP"),
      amountMinor: intent.amountMinor,
      currencyCode: intent.currencyCode,
      receivedAt: event.occurredAt,
      method: intent.method,
      source: "PROVIDER",
      externalReference: event.providerTransactionReference,
      providerKey,
      providerTransactionRef: event.providerTransactionReference,
      idempotencyKey: `provider:${providerKey}:${event.eventKey}`,
      recordedByUserId: intent.createdByUserId,
    },
  });
  await ledgerEntry(tx, {
    organisationId: intent.organisationId,
    propertyId: intent.propertyId,
    unitId: intent.unitId,
    leaseId: intent.leaseId,
    securityDepositId: deposit.id,
    type: "DEPOSIT_RECEIPT",
    direction: "CREDIT",
    amountMinor: deposit.amountMinor,
    currencyCode: deposit.currencyCode,
    effectiveAt: deposit.receivedAt,
    reference: deposit.internalReference,
    createdByUserId: null,
  });
  await tx.domainEvent.create({
    data: { organisationId: intent.organisationId, name: "deposit.received", aggregateType: "security_deposit", aggregateId: deposit.id, payload: { source: "PROVIDER", providerKey, amountMinor: deposit.amountMinor.toString() } },
  });
  return deposit;
}

export async function reconcileProviderEvent(
  organisationId: string,
  providerKey: string,
  payload: unknown,
  registry: PaymentProviderRegistry = paymentProviders,
) {
  const adapter = registry.get(providerKey);
  const event = await adapter.parseEvent(payload);
  const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const duplicate = await db.paymentReconciliationEvent.findUnique({
    where: { providerKey_eventKey: { providerKey, eventKey: event.eventKey } },
    include: reconciliationEventInclude(),
  });
  if (duplicate) {
    if (duplicate.organisationId !== organisationId) {
      throw new AppError("RECONCILIATION_ORGANISATION_MISMATCH", 403, "The provider event belongs to another organisation.");
    }
    if (duplicate.payloadHash !== payloadHash) throw new AppError("IDEMPOTENCY_CONFLICT", 409, "The provider event key was reused with a different payload.");
    if (duplicate.status !== "UNMATCHED") return duplicate;
  }
  const existingTransaction = await db.payment.findUnique({
    where: { providerKey_providerTransactionRef: { providerKey, providerTransactionRef: event.providerTransactionReference } },
  });
  if (existingTransaction) {
    if (existingTransaction.organisationId !== organisationId) {
      throw new AppError("RECONCILIATION_ORGANISATION_MISMATCH", 403, "The provider transaction belongs to another organisation.");
    }
    const data = {
        organisationId,
        paymentId: existingTransaction.id,
        providerKey,
        eventKey: event.eventKey,
        payloadHash,
        transactionRef: event.providerTransactionReference,
        status: "DUPLICATE",
        processedAt: new Date(),
      } as const;
    return duplicate
      ? db.paymentReconciliationEvent.update({ where: { id: duplicate.id }, data, include: reconciliationEventInclude() })
      : db.paymentReconciliationEvent.create({ data, include: reconciliationEventInclude() });
  }
  // Deposit checkouts never produce a Payment row, so a replayed/duplicate deposit webhook is
  // detected against the SecurityDeposit's own (providerKey, providerTransactionRef) uniqueness.
  const existingDeposit = await db.securityDeposit.findUnique({
    where: { providerKey_providerTransactionRef: { providerKey, providerTransactionRef: event.providerTransactionReference } },
  });
  if (existingDeposit) {
    if (existingDeposit.organisationId !== organisationId) {
      throw new AppError("RECONCILIATION_ORGANISATION_MISMATCH", 403, "The provider transaction belongs to another organisation.");
    }
    const data = {
        organisationId,
        securityDepositId: existingDeposit.id,
        providerKey,
        eventKey: event.eventKey,
        payloadHash,
        transactionRef: event.providerTransactionReference,
        status: "DUPLICATE",
        processedAt: new Date(),
      } as const;
    return duplicate
      ? db.paymentReconciliationEvent.update({ where: { id: duplicate.id }, data, include: reconciliationEventInclude() })
      : db.paymentReconciliationEvent.create({ data, include: reconciliationEventInclude() });
  }
  try {
    let notificationId: string | null = null;
    const result = await serializableTransaction(async (tx) => {
    const intent = await tx.paymentIntent.findFirst({
      where: { organisationId, providerKey, providerIntentRef: event.providerIntentReference },
    });
    if (!intent) {
      if (duplicate) return duplicate;
      return tx.paymentReconciliationEvent.create({ data: { organisationId, providerKey, eventKey: event.eventKey, payloadHash, transactionRef: event.providerTransactionReference, status: "UNMATCHED", processedAt: new Date() } });
    }
    const amountMatches = intent.amountMinor.equals(money(event.amountMinor)) && intent.currencyCode === event.currencyCode.toUpperCase();
    if (!amountMatches) {
      const data = { organisationId, providerKey, eventKey: event.eventKey, payloadHash, transactionRef: event.providerTransactionReference, status: "MISMATCHED" as const, processedAt: new Date() };
      return duplicate
        ? tx.paymentReconciliationEvent.update({ where: { id: duplicate.id }, data })
        : tx.paymentReconciliationEvent.create({ data });
    }

    if (intent.purpose === "DEPOSIT") {
      // A DEPOSIT-purpose intent never creates a Payment/Receipt or touches rent allocation.
      // Only a verified SUCCEEDED event produces a SecurityDeposit; FAILED/CANCELLED events
      // update the intent's status and leave a MATCHED reconciliation trail with no deposit.
      await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: event.status } });
      const deposit = event.status === "SUCCEEDED" ? await completeSuccessfulDeposit(tx, intent, providerKey, event) : null;
      const reconciliationData = {
        organisationId,
        securityDepositId: deposit?.id,
        providerKey,
        eventKey: event.eventKey,
        payloadHash,
        transactionRef: event.providerTransactionReference,
        status: "MATCHED" as const,
        processedAt: new Date(),
      };
      const reconciliation = duplicate
        ? await tx.paymentReconciliationEvent.update({ where: { id: duplicate.id }, data: reconciliationData })
        : await tx.paymentReconciliationEvent.create({ data: reconciliationData });
      await tx.auditEvent.create({
        data: { organisationId, action: event.status === "SUCCEEDED" ? "deposit.provider_confirmed" : "deposit.provider_failed", entityType: "payment_intent", entityId: intent.id, metadata: { providerKey, eventKey: event.eventKey } },
      });
      if (event.status !== "SUCCEEDED") {
        await tx.domainEvent.create({
          data: { organisationId, name: event.status === "FAILED" ? "deposit.checkout_failed" : "deposit.checkout_cancelled", aggregateType: "payment_intent", aggregateId: intent.id, payload: { failureReason: event.failureReason ?? null } },
        });
      }
      return {
        ...reconciliation,
        payment: null,
        securityDeposit: deposit ? await tx.securityDeposit.findUniqueOrThrow({ where: { id: deposit.id }, include: depositInclude() }) : null,
      };
    }

    const payment = await tx.payment.create({
      data: {
        organisationId,
        paymentIntentId: intent.id,
        tenantOrganisationId: intent.tenantOrganisationId,
        leaseId: intent.leaseId,
        propertyId: intent.propertyId,
        unitId: intent.unitId,
        internalReference: reference("PAY"),
        amountMinor: intent.amountMinor,
        currencyCode: intent.currencyCode,
        method: intent.method,
        source: "PROVIDER",
        status: event.status,
        paidAt: event.occurredAt,
        externalReference: event.providerTransactionReference,
        providerKey,
        providerTransactionRef: event.providerTransactionReference,
        idempotencyKey: `provider:${providerKey}:${event.eventKey}`,
        reconciliationStatus: "MATCHED",
        failureReason: event.failureReason,
        confirmedAt: event.status === "SUCCEEDED" ? event.occurredAt : null,
      },
    });
    await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: event.status } });
    const reconciliationData = { organisationId, paymentId: payment.id, providerKey, eventKey: event.eventKey, payloadHash, transactionRef: event.providerTransactionReference, status: "MATCHED" as const, processedAt: new Date() };
    const reconciliation = duplicate
      ? await tx.paymentReconciliationEvent.update({ where: { id: duplicate.id }, data: reconciliationData })
      : await tx.paymentReconciliationEvent.create({ data: reconciliationData });
    await tx.domainEvent.create({
      data: { organisationId, name: "payment.created", aggregateType: "payment", aggregateId: payment.id, payload: { source: "PROVIDER", providerKey } },
    });
    await tx.auditEvent.create({
      data: { organisationId, action: event.status === "SUCCEEDED" ? "payment.provider_confirmed" : "payment.provider_failed", entityType: "payment", entityId: payment.id, metadata: { providerKey, eventKey: event.eventKey } },
    });
    if (event.status === "SUCCEEDED") {
      notificationId = (await completeSuccessfulPayment(tx, payment)).notificationId;
    } else {
      await tx.domainEvent.create({
        data: { organisationId, name: event.status === "FAILED" ? "payment.failed" : "payment.cancelled", aggregateType: "payment", aggregateId: payment.id, payload: { failureReason: event.failureReason ?? null } },
      });
      notificationId = await notifyPaymentOutcome(tx, payment, "PAYMENT_FAILED");
    }
    return { ...reconciliation, payment: await tx.payment.findUniqueOrThrow({ where: { id: payment.id }, include: paymentInclude() }), securityDeposit: null };
    });
    if (notificationId) await enqueueNotificationDelivery({ id: notificationId, organisationId });
    return result;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const racedEvent = await db.paymentReconciliationEvent.findUnique({
        where: { providerKey_eventKey: { providerKey, eventKey: event.eventKey } },
        include: reconciliationEventInclude(),
      });
      if (racedEvent) {
        if (racedEvent.organisationId !== organisationId) throw new AppError("RECONCILIATION_ORGANISATION_MISMATCH", 403, "The provider event belongs to another organisation.");
        if (racedEvent.payloadHash !== payloadHash) throw new AppError("IDEMPOTENCY_CONFLICT", 409, "The provider event key was reused with a different payload.");
        return racedEvent;
      }
    }
    throw error;
  }
}

export async function listPayments(userId: string, organisationId: string, input: unknown = {}) {
  await requirePermission(userId, organisationId, PERMISSIONS.paymentRead);
  const query = paymentListQuerySchema.parse(input);
  return db.payment.findMany({ where: { organisationId, ...query }, include: paymentInclude(), orderBy: [{ paidAt: "desc" }, { id: "desc" }] });
}

export async function getPayment(userId: string, organisationId: string, paymentId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.paymentRead);
  const payment = await db.payment.findFirst({ where: { id: paymentId, organisationId }, include: paymentInclude() });
  if (!payment) throw notFound();
  return payment;
}

/**
 * Manager financial view: every persisted provider webhook event (matched, mismatched,
 * unmatched, or duplicate), regardless of whether it produced a payment. Reuses the
 * `PaymentReconciliationEvent` ledger that `reconcileProviderEvent` already writes for every
 * webhook it processes.
 */
export async function listReconciliationEvents(userId: string, organisationId: string, input: unknown = {}) {
  await requirePermission(userId, organisationId, PERMISSIONS.paymentRead);
  const query = reconciliationListQuerySchema.parse(input);
  return db.paymentReconciliationEvent.findMany({
    where: { organisationId, ...query },
    include: { payment: { include: paymentInclude() } },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
  });
}

export async function reversePayment(userId: string, organisationId: string, paymentId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.paymentReverse);
  const data = reversePaymentSchema.parse(input);
  return serializableTransaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId}::uuid AND "organisationId" = ${organisationId}::uuid FOR UPDATE`);
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, organisationId },
      include: { allocations: { where: { reversedAt: null }, include: { rentObligation: true } }, receipt: true },
    });
    if (!payment) throw notFound();
    if (payment.status !== "SUCCEEDED") throw new AppError("PAYMENT_NOT_REVERSIBLE", 409, "Only a succeeded payment can be reversed.");
    const reversedAt = new Date();
    const obligationIds = payment.allocations.map(({ rentObligationId }) => rentObligationId);
    if (obligationIds.length) {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "RentObligation" WHERE "id" = ANY(ARRAY[${Prisma.join(obligationIds)}]::uuid[]) FOR UPDATE`);
    }
    for (const allocation of payment.allocations) {
      const collectedAmountMinor = Prisma.Decimal.max(0, allocation.rentObligation.collectedAmountMinor.minus(allocation.amountMinor));
      const collectionState = collectedAmountMinor.isZero()
        ? "UNPAID"
        : collectedAmountMinor.greaterThanOrEqualTo(allocation.rentObligation.amountMinor) ? "FULLY_PAID" : "PARTIALLY_PAID";
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const status = collectionState === "FULLY_PAID"
        ? "SATISFIED"
        : allocation.rentObligation.dueDate < today
          ? "OVERDUE"
          : allocation.rentObligation.dueDate.getTime() === today.getTime() ? "DUE" : "UPCOMING";
      await tx.paymentAllocation.update({ where: { id: allocation.id }, data: { reversedAt } });
      await tx.rentObligation.update({ where: { id: allocation.rentObligationId }, data: { collectedAmountMinor, collectionState, status } });
    }
    const reversed = await tx.payment.update({
      where: { id: payment.id },
      data: { status: "REVERSED", reversedAt, reversedByUserId: userId, reversalReason: data.reason },
    });
    if (payment.receipt) await tx.receipt.update({ where: { id: payment.receipt.id }, data: { status: "VOIDED", voidedAt: reversedAt } });
    await ledgerEntry(tx, {
      organisationId,
      propertyId: payment.propertyId,
      unitId: payment.unitId,
      leaseId: payment.leaseId,
      paymentId: payment.id,
      type: "PAYMENT_REVERSAL",
      direction: "DEBIT",
      amountMinor: payment.amountMinor,
      currencyCode: payment.currencyCode,
      effectiveAt: reversedAt,
      reference: payment.internalReference,
      description: data.reason,
      createdByUserId: userId,
    });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "payment.reversed", entityType: "payment", entityId: payment.id, metadata: { reason: data.reason } } });
    await tx.domainEvent.create({ data: { organisationId, name: "payment.reversed", aggregateType: "payment", aggregateId: payment.id, payload: { reason: data.reason } } });
    return reversed;
  });
}

export async function getReceipt(userId: string, organisationId: string, receiptId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.paymentRead);
  const receipt = await db.receipt.findFirst({
    where: { id: receiptId, organisationId },
    include: {
      tenantOrganisation: { include: { tenant: true } },
      lease: true,
      property: true,
      unit: true,
      payment: { include: { allocations: { include: { rentObligation: true } } } },
    },
  });
  if (!receipt) throw notFound();
  return receipt;
}

export async function createSecurityDeposit(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.depositRecord);
  const data = depositSchema.parse(input);
  const existing = await db.securityDeposit.findUnique({
    where: { organisationId_idempotencyKey: { organisationId, idempotencyKey: data.idempotencyKey } },
  });
  if (existing) {
    if (
      !existing.amountMinor.equals(money(data.amountMinor))
      || existing.currencyCode !== data.currencyCode
      || existing.leaseId !== data.leaseId
      || existing.tenantOrganisationId !== data.tenantOrganisationId
    ) throw new AppError("IDEMPOTENCY_CONFLICT", 409, "The idempotency key was already used for a different deposit.");
    return existing;
  }
  try {
    return await serializableTransaction(async (tx) => {
    const lease = await scopedLease(tx, organisationId, data.leaseId, data.tenantOrganisationId);
    if (lease.currencyCode !== data.currencyCode) throw new AppError("CURRENCY_MISMATCH", 422, "Deposit currency must match the lease.");
    const deposit = await tx.securityDeposit.create({
      data: {
        organisationId,
        tenantOrganisationId: data.tenantOrganisationId,
        leaseId: lease.id,
        propertyId: lease.propertyId,
        unitId: lease.unitId,
        internalReference: reference("DEP"),
        amountMinor: data.amountMinor,
        currencyCode: data.currencyCode,
        receivedAt: data.receivedAt,
        method: data.method,
        externalReference: data.externalReference,
        idempotencyKey: data.idempotencyKey,
        evidenceReference: data.evidenceReference,
        notes: data.notes,
        recordedByUserId: userId,
      },
    });
    await ledgerEntry(tx, {
      organisationId,
      propertyId: lease.propertyId,
      unitId: lease.unitId,
      leaseId: lease.id,
      securityDepositId: deposit.id,
      type: "DEPOSIT_RECEIVED",
      direction: "CREDIT",
      amountMinor: deposit.amountMinor,
      currencyCode: deposit.currencyCode,
      effectiveAt: deposit.receivedAt,
      reference: deposit.internalReference,
      createdByUserId: userId,
    });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "deposit.received", entityType: "security_deposit", entityId: deposit.id } });
    await tx.domainEvent.create({ data: { organisationId, name: "deposit.received", aggregateType: "security_deposit", aggregateId: deposit.id, payload: { amountMinor: deposit.amountMinor.toString() } } });
    return deposit;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await db.securityDeposit.findUnique({ where: { organisationId_idempotencyKey: { organisationId, idempotencyKey: data.idempotencyKey } } });
      if (raced) {
        if (
          !raced.amountMinor.equals(money(data.amountMinor))
          || raced.currencyCode !== data.currencyCode
          || raced.leaseId !== data.leaseId
          || raced.tenantOrganisationId !== data.tenantOrganisationId
        ) throw new AppError("IDEMPOTENCY_CONFLICT", 409, "The idempotency key was already used for a different deposit.");
        return raced;
      }
    }
    throw error;
  }
}

export async function listSecurityDeposits(userId: string, organisationId: string, leaseId?: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.depositRead);
  return db.securityDeposit.findMany({
    where: { organisationId, leaseId },
    include: { tenantOrganisation: { include: { tenant: true } }, lease: true, property: true, unit: true },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
  });
}

export async function getSecurityDeposit(userId: string, organisationId: string, depositId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.depositRead);
  const deposit = await db.securityDeposit.findFirst({
    where: { id: depositId, organisationId },
    include: { tenantOrganisation: { include: { tenant: true } }, lease: true, property: true, unit: true, ledgerEntries: true },
  });
  if (!deposit) throw notFound();
  return deposit;
}

export async function getRentCollectionMetrics(userId: string, organisationId: string, leaseId?: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.paymentRead);
  const obligations = await db.rentObligation.findMany({
    where: { organisationId, leaseId, status: { not: "CANCELLED" } },
    select: { amountMinor: true, collectedAmountMinor: true, collectionState: true, currencyCode: true },
  });
  const currencies = [...new Set(obligations.map(({ currencyCode }) => currencyCode))];
  if (currencies.length > 1) throw new AppError("MIXED_CURRENCIES", 422, "Collection metrics require a single currency scope.");
  const charged = obligations.reduce((total, row) => total.plus(row.amountMinor), money("0"));
  const collected = obligations.reduce((total, row) => total.plus(row.collectedAmountMinor), money("0"));
  return {
    currencyCode: currencies[0] ?? null,
    chargedAmountMinor: charged.toString(),
    collectedAmountMinor: collected.toString(),
    outstandingAmountMinor: charged.minus(collected).toString(),
    obligations: {
      total: obligations.length,
      unpaid: obligations.filter(({ collectionState }) => collectionState === "UNPAID").length,
      partiallyPaid: obligations.filter(({ collectionState }) => collectionState === "PARTIALLY_PAID").length,
      fullyPaid: obligations.filter(({ collectionState }) => collectionState === "FULLY_PAID").length,
    },
  };
}

export const getLeasePaymentHistory = (userId: string, organisationId: string, leaseId: string) =>
  listPayments(userId, organisationId, { leaseId });

/** Tenant self-service: a tenant may view their own payment history without organisation-membership permissions. */
export async function getTenantPaymentHistory(userId: string, organisationId: string, tenantOrganisationId: string) {
  const internal = await hasPermission(userId, organisationId, PERMISSIONS.paymentRead);
  if (!internal && !await isTenantUser(userId, organisationId, tenantOrganisationId)) throw forbidden();
  return db.payment.findMany({
    where: { organisationId, tenantOrganisationId },
    include: paymentInclude(),
    orderBy: [{ paidAt: "desc" }, { id: "desc" }],
  });
}

/** Tenant self-service: a tenant may view their own security deposits (manual and provider-verified) without organisation-membership permissions. */
export async function getTenantDepositHistory(userId: string, organisationId: string, tenantOrganisationId: string) {
  const internal = await hasPermission(userId, organisationId, PERMISSIONS.depositRead);
  if (!internal && !await isTenantUser(userId, organisationId, tenantOrganisationId)) throw forbidden();
  return db.securityDeposit.findMany({
    where: { organisationId, tenantOrganisationId },
    include: depositInclude(),
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
  });
}

export async function listLedgerEntries(userId: string, organisationId: string, propertyId?: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.ledgerRead);
  return db.financialLedgerEntry.findMany({
    where: { organisationId, propertyId },
    orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
  });
}
