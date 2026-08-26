import { z } from "zod";

const date = z.coerce.date();
const money = z.coerce.string().regex(/^\d+$/, "Money must be a non-negative integer in minor units.");
const documentSchema = z.object({ fileKey: z.string().min(1).max(500), fileName: z.string().min(1).max(255), contentType: z.string().max(120).optional(), sizeBytes: z.number().int().positive().optional() });

const leaseFields = {
  referenceNumber: z.string().trim().min(2).max(80),
  propertyId: z.string().uuid(),
  unitId: z.string().uuid().optional(),
  tenantOrganisationIds: z.array(z.string().uuid()).min(1).max(20),
  startDate: date,
  endDate: date.optional(),
  rentAmountMinor: money,
  currencyCode: z.string().length(3).toUpperCase(),
  rentFrequency: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL", "CUSTOM"]),
  customFrequency: z.string().trim().min(1).max(200).optional(),
  depositAmountMinor: money.optional(),
  status: z.enum(["DRAFT", "ACTIVE", "EXPIRING", "EXPIRED", "TERMINATED", "CANCELLED"]).default("DRAFT"),
  renewalStatus: z.enum(["NOT_RENEWED", "PENDING", "RENEWED", "NOT_APPLICABLE"]).default("NOT_RENEWED"),
  moveStatus: z.enum(["NOT_MOVED_IN", "MOVED_IN", "MOVED_OUT"]).default("NOT_MOVED_IN"),
  notes: z.string().trim().max(4000).optional(),
  documents: z.array(documentSchema).max(20).default([]),
};

export const createLeaseSchema = z.object(leaseFields).superRefine((input, context) => {
  if (input.endDate && input.endDate < input.startDate) context.addIssue({ code: "custom", path: ["endDate"], message: "Lease end date cannot precede start date." });
  if (input.rentFrequency === "CUSTOM" && !input.customFrequency) context.addIssue({ code: "custom", path: ["customFrequency"], message: "A custom rent frequency description is required." });
});

export const updateLeaseSchema = z.object(leaseFields).pick({
  startDate: true, endDate: true, rentAmountMinor: true, currencyCode: true, rentFrequency: true, customFrequency: true,
  depositAmountMinor: true, renewalStatus: true, moveStatus: true, notes: true,
}).partial().superRefine((input, context) => {
  if (input.endDate && input.startDate && input.endDate < input.startDate) context.addIssue({ code: "custom", path: ["endDate"], message: "Lease end date cannot precede start date." });
  if (input.rentFrequency === "CUSTOM" && !input.customFrequency) context.addIssue({ code: "custom", path: ["customFrequency"], message: "A custom rent frequency description is required." });
});

export const renewalTransitionSchema = z.object({
  status: z.enum(["REQUESTED", "UNDER_DISCUSSION", "APPROVED", "DECLINED", "COMPLETED"]),
});
