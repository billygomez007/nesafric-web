import { z } from "zod";

const moneyMinor = z
  .string()
  .regex(/^\d+$/, "Amount must be a non-negative integer in minor currency units.");

const currencyCode = z.string().length(3).transform((value) => value.toUpperCase());

export const recurringChargeTypes = [
  "SERVICE_CHARGE",
  "WASTE_COLLECTION",
  "ELECTRICITY",
  "WATER",
  "GAS",
  "SECURITY",
  "CLEANING",
  "PARKING",
  "INTERNET",
  "GENERATOR_FUEL",
  "MAINTENANCE_LEVY",
  "COMMON_AREA",
  "ASSOCIATION_FEE",
  "OTHER",
] as const;

export const recurringChargeFrequencies = [
  "ONE_TIME",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "SEMI_ANNUALLY",
  "ANNUALLY",
  "CUSTOM",
] as const;

export const createRecurringChargeSchema = z
  .object({
    leaseId: z.string().uuid(),
    propertyId: z.string().uuid(),
    unitId: z.string().uuid().nullable().optional(),

    type: z.enum(recurringChargeTypes),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).nullable().optional(),

    calculationType: z.enum(["FIXED", "VARIABLE"]).default("FIXED"),
    amountMinor: moneyMinor.nullable().optional(),
    currencyCode,

    frequency: z.enum(recurringChargeFrequencies),
    customFrequency: z.string().trim().max(200).nullable().optional(),

    billingMode: z.enum(["SEPARATE", "INCLUDED_IN_RENT"]).default("SEPARATE"),

    startDate: z.coerce.date(),
    endDate: z.coerce.date().nullable().optional(),

    dueDay: z.number().int().min(1).max(31).nullable().optional(),

    notifyTenant: z.boolean().default(true),
    reminderDaysBefore: z.number().int().min(0).max(90).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.calculationType === "FIXED" && !data.amountMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amountMinor"],
        message: "Fixed charges require an amount.",
      });
    }

    if (data.calculationType === "VARIABLE" && data.amountMinor !== null && data.amountMinor !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amountMinor"],
        message: "Variable charges are finalised on the obligation and must not define a fixed amount.",
      });
    }

    if (data.frequency === "CUSTOM" && !data.customFrequency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customFrequency"],
        message: "Custom frequency requires a description.",
      });
    }

    if (data.frequency !== "CUSTOM" && data.customFrequency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customFrequency"],
        message: "customFrequency is only valid for CUSTOM frequency.",
      });
    }

    if (data.endDate && data.endDate < data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "End date cannot be before start date.",
      });
    }
  });

export const updateRecurringChargeSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),

    amountMinor: moneyMinor.nullable().optional(),

    endDate: z.coerce.date().nullable().optional(),
    dueDay: z.number().int().min(1).max(31).nullable().optional(),

    notifyTenant: z.boolean().optional(),
    reminderDaysBefore: z.number().int().min(0).max(90).nullable().optional(),

    status: z.enum(["ACTIVE", "PAUSED", "ENDED"]).optional(),
  })
  .strict();

export const finaliseVariableChargeSchema = z.object({
  amountMinor: moneyMinor.refine((value) => BigInt(value) > BigInt(0), {
    message: "Final amount must be greater than zero.",
  }),
});

export const waiveChargeSchema = z.object({
  amountMinor: moneyMinor,
  reason: z.string().trim().min(2).max(500),
});

export type CreateRecurringChargeInput = z.infer<typeof createRecurringChargeSchema>;
export type UpdateRecurringChargeInput = z.infer<typeof updateRecurringChargeSchema>;
