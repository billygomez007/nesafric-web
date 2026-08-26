import { z } from "zod";

export const changePlanSchema = z.object({
  planKey: z.string().trim().min(1).max(80),
  billingCycle: z.enum(["MONTHLY", "ANNUAL"]).optional(),
}).strict();

export const cancelSubscriptionSchema = z.object({
  immediate: z.boolean().optional().default(false),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict();

export const createPlanSchema = z.object({
  key: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  isActive: z.boolean().optional().default(true),
  isPublic: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0),
  prices: z.array(z.object({
    currencyCode: z.string().length(3).toUpperCase(),
    billingCycle: z.enum(["MONTHLY", "ANNUAL"]),
    amountMinor: z.string().regex(/^\d+$/, "amountMinor must be a non-negative integer string"),
  })).default([]),
  entitlements: z.array(z.object({
    featureKey: z.string().trim().min(1),
    kind: z.enum(["BOOLEAN", "LIMIT"]),
    booleanValue: z.boolean().optional(),
    limitValue: z.number().int().nonnegative().optional(),
    isUnlimited: z.boolean().optional().default(false),
  })).default([]),
}).strict();

export const updatePlanSchema = createPlanSchema.partial().extend({ key: z.string().trim().min(1).max(80).optional() }).strict();

export const createEntitlementOverrideSchema = z.object({
  featureKey: z.string().trim().min(1),
  kind: z.enum(["BOOLEAN", "LIMIT"]),
  booleanValue: z.boolean().optional(),
  limitValue: z.number().int().nonnegative().optional(),
  isUnlimited: z.boolean().optional().default(false),
  reason: z.string().trim().min(1).max(500),
  expiresAt: z.string().datetime().optional(),
}).strict();

export const platformSuspendSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
export const platformForcePlanSchema = z.object({ planKey: z.string().trim().min(1).max(80), reason: z.string().trim().min(1).max(500) }).strict();

export const createSupportSessionSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  durationMinutes: z.number().int().min(5).max(24 * 60).optional().default(60),
}).strict();
