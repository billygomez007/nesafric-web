import { z } from "zod";

const id = z.string().uuid();
const money = z.string().regex(/^(0|[1-9]\d*)$/, "Amount must be an integer in minor units.");
const currency = z.string().trim().length(3).transform((value) => value.toUpperCase());
const note = z.string().trim().min(1).max(2000);
const metadata = z.record(z.string(), z.unknown()).optional();

export const maintenanceCategorySchema = z.enum([
  "plumbing",
  "electrical",
  "roofing",
  "air conditioning",
  "appliance",
  "carpentry",
  "painting",
  "structural",
  "security",
  "sanitation",
  "other",
]);

export const attachmentSchema = z.object({
  fileKey: z.string().trim().min(1).max(500),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(200).optional(),
  sizeBytes: z.number().int().nonnegative().max(2_147_483_647).optional(),
});

export const createMaintenanceRequestSchema = z.object({
  propertyId: id,
  unitId: id.optional(),
  tenantOrganisationId: id.optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3).max(10_000),
  category: maintenanceCategorySchema,
  priority: z.enum(["EMERGENCY", "URGENT", "NORMAL", "LOW"]).default("NORMAL"),
  attachments: z.array(attachmentSchema).max(20).default([]),
});

export const maintenanceListQuerySchema = z.object({
  propertyId: id.optional(),
  unitId: id.optional(),
  tenantOrganisationId: id.optional(),
  status: z.enum(["REPORTED", "TRIAGED", "AWAITING_APPROVAL", "APPROVED", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CLOSED", "REJECTED", "CANCELLED"]).optional(),
  priority: z.enum(["EMERGENCY", "URGENT", "NORMAL", "LOW"]).optional(),
});

export const transitionMaintenanceSchema = z.object({
  status: z.enum(["TRIAGED", "IN_PROGRESS", "COMPLETED", "CLOSED", "CANCELLED"]),
  note: note.optional(),
  metadata,
});

export const maintenanceNoteSchema = z.object({ note, metadata });

const futureReferences = {
  paymentReference: z.string().trim().min(1).max(255).nullable().optional(),
  financialLedgerReference: z.string().trim().min(1).max(255).nullable().optional(),
};

export const createWorkOrderSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(10_000).optional(),
  dueAt: z.coerce.date().optional(),
  assigneeMemberId: id.optional(),
  estimateAmountMinor: money.optional(),
  currencyCode: currency,
  ...futureReferences,
});

export const updateWorkOrderSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  ...futureReferences,
}).refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const assignWorkOrderSchema = z.object({
  assigneeMemberId: id,
  note: note.optional(),
});

export const recordWorkOrderCostSchema = z.object({
  type: z.enum(["ESTIMATE", "ACTUAL"]),
  amountMinor: money,
  currencyCode: currency,
  note: note.optional(),
  financialLedgerReference: z.string().trim().min(1).max(255).optional(),
});

export const requestMaintenanceApprovalSchema = z.object({
  requestedAmountMinor: money,
  currencyCode: currency,
  reason: note.optional(),
  thresholdReference: z.string().trim().min(1).max(255).optional(),
});

export const decideMaintenanceApprovalSchema = z.object({
  approvedAmountMinor: money.optional(),
  reason: note.optional(),
});
