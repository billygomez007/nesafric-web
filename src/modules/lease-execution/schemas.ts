import { z } from "zod";

const id = z.string().uuid();
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const jsonObject = z.record(z.string(), z.unknown());

export const leaseExecutionIdSchema = id;
export const createExecutionDocumentSchema = z.object({
  source: z.enum(["GENERATED", "UPLOADED"]),
  fileKey: z.string().trim().min(1).max(1_000),
  fileName: z.string().trim().min(1).max(255),
  contentType: optionalText(120),
  sizeBytes: z.number().int().positive().max(2_147_483_647).optional(),
  providerReference: optionalText(500),
}).strict();

export const signatureRequestSchema = z.object({
  documentId: id,
  providerKey: z.string().trim().min(1).max(50).default("INTERNAL"),
  signers: z.array(z.object({
    role: z.enum(["ORG_REPRESENTATIVE", "TENANT", "CO_TENANT", "OTHER"]),
    leasePartyId: id.optional(),
    organisationMemberId: id.optional(),
    signerName: z.string().trim().min(2).max(200).optional(),
    signerEmail: z.string().trim().email().max(320).optional(),
    required: z.boolean().default(true),
  }).strict()).min(1).max(20),
  activationRequirements: z.object({
    signaturesRequired: z.literal(true).default(true),
    depositRequired: z.boolean().optional(),
    initialRentRequired: z.boolean().default(false),
    moveInRequired: z.boolean().default(false),
    documentRequired: z.literal(true).default(true),
  }).strict().optional(),
}).strict().superRefine((input, context) => {
  if (!input.signers.some(({ required }) => required)) {
    context.addIssue({ code: "custom", path: ["signers"], message: "At least one required signer is needed." });
  }
});

export const signatureActionSchema = z.object({
  status: z.enum(["VIEWED", "SIGNED", "DECLINED", "CANCELLED"]),
  providerReference: optionalText(500),
}).strict();

export const scheduleMoveInSchema = z.object({
  scheduledDate: z.coerce.date(),
  responsibleMemberId: id.optional(),
  notes: optionalText(5_000),
  checklist: z.array(z.object({
    key: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(200),
    required: z.boolean().default(true),
  }).strict()).max(50).default([]),
}).strict();

export const checklistUpdateSchema = z.object({
  itemId: id,
  completed: z.boolean(),
  notes: optionalText(2_000),
}).strict();

const metadataRecord = z.record(z.string(), z.unknown());
export const inspectionSchema = z.object({
  inspectorMemberId: id,
  inspectedAt: z.coerce.date(),
  overallCondition: optionalText(200),
  notes: optionalText(10_000),
  tenantAcknowledged: z.boolean().default(false),
  completed: z.boolean().default(true),
  areas: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    condition: z.string().trim().min(1).max(100),
    notes: optionalText(2_000),
    defects: z.array(metadataRecord).max(50).optional(),
    media: z.array(z.object({
      storageKey: z.string().trim().min(1).max(1_000),
      fileName: z.string().trim().min(1).max(255),
      contentType: z.string().trim().max(120).optional(),
    }).strict()).max(50).optional(),
  }).strict()).min(1).max(100),
  meterReadings: z.array(z.object({
    type: z.string().trim().min(1).max(100),
    identifier: optionalText(200),
    value: z.coerce.string().regex(/^-?\d+(\.\d{1,4})?$/),
    unit: z.string().trim().min(1).max(50),
    readAt: z.coerce.date(),
    notes: optionalText(2_000),
  }).strict()).max(100).default([]),
  inventory: z.array(z.object({
    category: z.string().trim().min(1).max(100),
    item: z.string().trim().min(1).max(200),
    quantity: z.number().int().positive().max(10_000).default(1),
    condition: z.string().trim().min(1).max(100),
    notes: optionalText(2_000),
    metadata: jsonObject.optional(),
  }).strict()).max(500).default([]),
}).strict();

export const keyHandoverSchema = z.object({
  tenantOrganisationId: id,
  type: z.string().trim().min(1).max(100),
  quantity: z.number().int().positive().max(1_000),
  identifier: optionalText(200),
  issuedAt: z.coerce.date(),
  notes: optionalText(2_000),
}).strict();

export const completeMoveInSchema = z.object({
  actualDate: z.coerce.date(),
  note: optionalText(2_000),
}).strict();
