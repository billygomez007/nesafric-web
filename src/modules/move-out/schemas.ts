import { z } from "zod";

const id = z.string().uuid();
const positiveMoney = z.string().regex(/^[1-9]\d*$/, "Money must be a positive integer in minor units.");
const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();
const metadata = z.record(z.string(), z.unknown());

export const noticeSchema = z.object({
  noticeDate: z.coerce.date(),
  intendedMoveOutDate: z.coerce.date(),
  source: z.enum(["TENANT", "LANDLORD", "PROPERTY_MANAGER"]),
  tenantOrganisationId: id.optional(),
  reason: optionalText(500),
  notes: optionalText(5_000),
}).strict().refine(({ noticeDate, intendedMoveOutDate }) => intendedMoveOutDate >= noticeDate, {
  path: ["intendedMoveOutDate"],
  message: "The intended move-out date cannot precede the notice date.",
});

export const noticeTransitionSchema = z.object({
  status: z.enum(["ACKNOWLEDGED", "WITHDRAWN"]),
  note: optionalText(2_000),
}).strict();

export const scheduleMoveOutSchema = z.object({
  scheduledDate: z.coerce.date(),
  responsibleMemberId: id.optional(),
  notes: optionalText(5_000),
  closureRequirements: z.object({
    inspectionRequired: z.literal(true).default(true),
    keyReturnRequired: z.literal(true).default(true),
    settlementRequired: z.literal(true).default(true),
  }).strict().optional(),
}).strict();

export const moveOutInspectionSchema = z.object({
  inspectorMemberId: id,
  inspectedAt: z.coerce.date(),
  overallCondition: optionalText(200),
  cleaningCondition: optionalText(200),
  notes: optionalText(10_000),
  tenantAcknowledged: z.boolean().default(false),
  areas: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    condition: z.string().trim().min(1).max(100),
    notes: optionalText(2_000),
    damage: z.array(metadata).max(50).optional(),
    media: z.array(z.object({
      storageKey: z.string().trim().min(1).max(1_000),
      fileName: z.string().trim().min(1).max(255),
      contentType: optionalText(120),
    }).strict()).max(50).optional(),
  }).strict()).min(1).max(100),
  meterReadings: z.array(z.object({
    type: z.string().trim().min(1).max(100),
    identifier: optionalText(200),
    value: z.coerce.string().regex(/^-?\d+(\.\d{1,4})?$/),
    unit: z.string().trim().min(1).max(50),
    readAt: z.coerce.date(),
    notes: optionalText(1_000),
  }).strict()).max(100).default([]),
  inventory: z.array(z.object({
    category: z.string().trim().min(1).max(100),
    item: z.string().trim().min(1).max(200),
    quantity: z.number().int().positive().max(10_000).default(1),
    condition: z.string().trim().min(1).max(100),
    missing: z.boolean().default(false),
    notes: optionalText(2_000),
    metadata: metadata.optional(),
  }).strict()).max(500).default([]),
}).strict();

export const keyReturnSchema = z.object({
  keyHandoverId: id,
  returnedQuantity: z.number().int().nonnegative(),
  missingQuantity: z.number().int().nonnegative(),
  returnedAt: z.coerce.date(),
  notes: optionalText(2_000),
}).strict();

export const deductionSchema = z.object({
  category: z.enum(["PROPERTY_DAMAGE", "MISSING_INVENTORY", "CLEANING", "UNPAID_RENT", "UNPAID_APPROVED_CHARGES", "KEY_REPLACEMENT", "OTHER"]),
  amountMinor: positiveMoney,
  currencyCode: z.string().length(3).toUpperCase(),
  explanation: z.string().trim().min(3).max(2_000),
  evidenceReference: optionalText(1_000),
  maintenanceRequestId: id.optional(),
}).strict();

export const deductionDecisionSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().min(3).max(2_000),
}).strict();

export const deductionReversalSchema = z.object({
  reason: z.string().trim().min(3).max(2_000),
}).strict();

export const settlementApprovalSchema = z.object({
  reason: z.string().trim().min(3).max(2_000),
}).strict();

export const refundSchema = z.object({
  amountMinor: positiveMoney,
  reference: z.string().trim().min(2).max(500),
  idempotencyKey: z.string().trim().min(8).max(200),
  evidenceReference: optionalText(1_000),
  recordedAt: z.coerce.date().optional(),
}).strict();

export const inspectionAcknowledgementSchema = z.object({
  acknowledged: z.literal(true),
}).strict();

export const turnoverTransitionSchema = z.object({
  status: z.enum(["REPAIRS_REQUIRED", "CLEANING_REQUIRED", "READY_FOR_MARKETING", "READY_FOR_OCCUPANCY", "COMPLETED"]),
  note: optionalText(2_000),
}).strict();

export const turnoverTaskSchema = z.object({
  key: z.string().trim().min(1).max(100),
  label: z.string().trim().min(2).max(200),
  required: z.boolean().default(true),
  maintenanceRequestId: id.optional(),
  notes: optionalText(2_000),
}).strict();

export const turnoverTaskUpdateSchema = z.object({
  taskId: id,
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
  notes: optionalText(2_000),
}).strict();

export const closeLeaseSchema = z.object({
  actualMoveOutDate: z.coerce.date(),
  note: optionalText(2_000),
}).strict();
