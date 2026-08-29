import { z } from "zod";

const id = z.string().uuid();
const base64 = z.string().min(1).max(40_000_000).regex(/^[A-Za-z0-9+/]+=*$/, "File data must be base64-encoded.");

/** Every domain a controlled upload can attach to (item 2: "listings, maintenance, move-in/out inspections, applications, and provider verification"). */
export const uploadTargetTypeSchema = z.enum([
  "LISTING_MEDIA",
  "MAINTENANCE_ATTACHMENT",
  "MOVE_IN_INSPECTION_MEDIA",
  "MOVE_OUT_INSPECTION_MEDIA",
  "APPLICATION_DOCUMENT",
  "PROVIDER_EVIDENCE",
  "CAMPAIGN_CREATIVE",
]);
export type UploadTargetType = z.infer<typeof uploadTargetTypeSchema>;

export const uploadDocumentSchema = z.object({
  targetType: uploadTargetTypeSchema,
  targetId: id,
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(200),
  dataBase64: base64,
  /** Only honoured for LISTING_MEDIA; every other target is always stored PRIVATE regardless of this field. Omit to default to PRIVATE. */
  classification: z.enum(["PRIVATE", "PUBLIC"]).default("PRIVATE"),
  mediaType: z.enum(["PHOTO", "VIDEO", "FLOOR_PLAN"]).optional(),
  title: z.string().trim().max(160).optional(),
  altText: z.string().trim().max(500).optional(),
  documentType: z.enum(["ID", "INCOME", "EMPLOYMENT", "REFERENCE", "OTHER"]).optional(),
  evidenceType: z.enum([
    "IDENTITY", "GHANA_CARD_FRONT", "GHANA_CARD_BACK", "BUSINESS_REGISTRATION",
    "PROFESSIONAL_LICENSE", "TRADE_CERTIFICATE", "SAFETY_CERTIFICATION", "INSURANCE", "ADDRESS",
    "PORTFOLIO_EVIDENCE", "REFERENCE_EVIDENCE", "TRAINING_CERTIFICATE", "OTHER",
  ]).optional(),
  evidenceExpiresAt: z.coerce.date().optional(),
  areaId: id.optional(),
  mediaSlot: z.enum(["desktop", "mobile"]).optional(),
}).strict().superRefine((value, context) => {
  if (value.targetType === "LISTING_MEDIA" && !value.mediaType) {
    context.addIssue({ code: "custom", path: ["mediaType"], message: "mediaType is required for listing media uploads." });
  }
  if (value.targetType === "APPLICATION_DOCUMENT" && !value.documentType) {
    context.addIssue({ code: "custom", path: ["documentType"], message: "documentType is required for application document uploads." });
  }
  if (value.targetType === "PROVIDER_EVIDENCE" && !value.evidenceType) {
    context.addIssue({ code: "custom", path: ["evidenceType"], message: "evidenceType is required for provider evidence uploads." });
  }
  if (value.targetType === "CAMPAIGN_CREATIVE" && !value.mediaSlot) {
    context.addIssue({ code: "custom", path: ["mediaSlot"], message: "mediaSlot ('desktop' or 'mobile') is required for campaign creative uploads." });
  }
  if (value.targetType === "MOVE_IN_INSPECTION_MEDIA" && !value.areaId) {
    context.addIssue({ code: "custom", path: ["areaId"], message: "areaId is required for move-in inspection media uploads." });
  }
});

export const listingMediaOrderSchema = z.object({
  order: z.array(z.object({ mediaId: id, sortOrder: z.number().int().min(0).max(10_000) }).strict()).min(1).max(200),
  coverMediaId: id.nullable().optional(),
}).strict();

export const archiveStorageObjectSchema = z.object({
  reason: z.string().trim().min(1).max(1_000).optional(),
}).strict();

const documentCenterTypeSchema = z.enum([
  "LISTING_MEDIA",
  "MAINTENANCE_ATTACHMENT",
  "MOVE_IN_INSPECTION_MEDIA",
  "MOVE_OUT_INSPECTION_MEDIA",
  "APPLICATION_DOCUMENT",
  "PROVIDER_EVIDENCE",
  "RECEIPT",
  "TENANT_STATEMENT",
  "MOVE_OUT_STATEMENT",
  "LEASE_AGREEMENT",
]);

export const documentCenterQuerySchema = z.object({
  propertyId: id.optional(),
  unitId: id.optional(),
  tenantOrganisationId: id.optional(),
  leaseId: id.optional(),
  paymentId: id.optional(),
  maintenanceRequestId: id.optional(),
  applicationId: id.optional(),
  inspectionId: id.optional(),
  type: documentCenterTypeSchema.optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
