import { z } from "zod";

const id = z.string().uuid();
const money = z.string().regex(/^[1-9]\d*$/, "Amount must be a positive integer in minor units.");
const currency = z.string().trim().length(3).transform((value) => value.toUpperCase());
const date = z.coerce.date();
const manualMethod = z.enum(["CASH", "BANK_TRANSFER", "MOBILE_MONEY"]);

export const allocationSchema = z.object({
  rentObligationId: id,
  amountMinor: money,
});

export const manualPaymentSchema = z.object({
  tenantOrganisationId: id,
  leaseId: id,
  amountMinor: money,
  currencyCode: currency,
  paidAt: date,
  method: manualMethod,
  externalReference: z.string().trim().min(1).max(200),
  evidenceReference: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().trim().min(1).max(200),
  allocations: z.array(allocationSchema).optional(),
});

export const paymentIntentSchema = z.object({
  tenantOrganisationId: id,
  leaseId: id,
  amountMinor: money,
  currencyCode: currency,
  method: z.enum(["BANK_TRANSFER", "MOBILE_MONEY", "CARD"]),
  providerKey: z.string().trim().min(1).max(100),
  idempotencyKey: z.string().trim().min(1).max(200),
  returnUrl: z.string().url().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const reversePaymentSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const depositSchema = z.object({
  tenantOrganisationId: id,
  leaseId: id,
  amountMinor: money,
  currencyCode: currency,
  receivedAt: date,
  method: manualMethod,
  externalReference: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().trim().min(1).max(200),
  evidenceReference: z.string().trim().min(1).max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const paymentListQuerySchema = z.object({
  leaseId: id.optional(),
  tenantOrganisationId: id.optional(),
  status: z.enum(["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "CANCELLED", "REVERSED"]).optional(),
});

/** Tenant self-service checkout: identical to `paymentIntentSchema` minus `tenantOrganisationId`, which the route derives from the authenticated tenant instead of accepting it from the request body. */
export const tenantCheckoutSchema = paymentIntentSchema.omit({ tenantOrganisationId: true });

/**
 * Security-deposit checkout shares the exact same request shape as a rent `paymentIntentSchema`
 * (lease, tenant, amount, currency, provider, idempotency key). The two are never distinguished
 * by a client-supplied field — the calling service function alone decides the intent's
 * `purpose` (RENT vs DEPOSIT), so a client can never relabel a rent checkout as a deposit or
 * vice versa.
 */
export const depositCheckoutSchema = paymentIntentSchema;
export const tenantDepositCheckoutSchema = tenantCheckoutSchema;

export const reconciliationListQuerySchema = z.object({
  status: z.enum(["UNMATCHED", "PENDING", "MATCHED", "MISMATCHED", "DUPLICATE"]).optional(),
  providerKey: z.string().trim().min(1).max(100).optional(),
});
