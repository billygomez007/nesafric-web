import { z } from "zod";

const id = z.string().uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
const money = z.string().regex(/^(0|[1-9]\d*)$/, "Amount must be an integer in minor units.");
const currency = z.string().trim().length(3).transform((value) => value.toUpperCase());

export const serviceAreaSchema = z.object({
  areaType: text(100),
  name: text(200),
  reference: text(300).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const providerEvidenceSchema = z.object({
  type: z.enum(["IDENTITY", "BUSINESS_REGISTRATION", "PROFESSIONAL_LICENSE", "INSURANCE", "ADDRESS", "OTHER"]),
  reference: text(500),
  expiresAt: z.coerce.date().optional(),
});

export const createServiceCategorySchema = z.object({
  key: z.string().trim().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: text(200),
  description: z.string().trim().max(2000).optional(),
});

export const updateServiceCategorySchema = z.object({
  name: text(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const createProviderSchema = z.object({
  type: z.enum(["INDIVIDUAL", "COMPANY"]),
  companyOrganisationId: id.optional(),
  displayName: text(200),
  legalName: text(300).optional(),
  contactEmail: z.string().trim().email().max(320).optional(),
  contactPhone: text(50).optional(),
  biography: z.string().trim().max(5000).optional(),
  categoryIds: z.array(id).max(50).default([]),
  serviceAreas: z.array(serviceAreaSchema).max(100).default([]),
}).superRefine((value, context) => {
  if (value.type === "COMPANY" && !value.companyOrganisationId) {
    context.addIssue({ code: "custom", path: ["companyOrganisationId"], message: "A company organisation is required." });
  }
  if (value.type === "INDIVIDUAL" && value.companyOrganisationId) {
    context.addIssue({ code: "custom", path: ["companyOrganisationId"], message: "An individual provider cannot specify a company organisation." });
  }
});

export const updateProviderSchema = z.object({
  displayName: text(200).optional(),
  legalName: text(300).nullable().optional(),
  contactEmail: z.string().trim().email().max(320).nullable().optional(),
  contactPhone: text(50).nullable().optional(),
  biography: z.string().trim().max(5000).nullable().optional(),
  availabilityStatus: z.enum(["AVAILABLE", "LIMITED", "UNAVAILABLE"]).optional(),
  acceptingWork: z.boolean().optional(),
  categoryIds: z.array(id).max(50).optional(),
  serviceAreas: z.array(serviceAreaSchema).max(100).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const providerListSchema = z.object({
  categoryId: id.optional(),
  verificationStatus: z.enum(["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED", "SUSPENDED"]).optional(),
  availabilityStatus: z.enum(["AVAILABLE", "LIMITED", "UNAVAILABLE"]).optional(),
  status: z.enum(["ACTIVE", "BLOCKED", "ARCHIVED"]).optional(),
});

export const addProviderToDirectorySchema = z.object({
  providerId: id,
  internalNotes: z.string().trim().max(5000).optional(),
});

export const updateProviderDirectorySchema = z.object({
  status: z.enum(["ACTIVE", "BLOCKED", "ARCHIVED"]).optional(),
  internalNotes: z.string().trim().max(5000).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const submitVerificationSchema = z.object({
  evidence: z.array(providerEvidenceSchema).min(1).max(50),
});

export const reviewVerificationSchema = z.object({
  status: z.enum(["VERIFIED", "REJECTED", "SUSPENDED"]),
  reason: z.string().trim().min(1).max(2000).optional(),
}).superRefine((value, context) => {
  if (value.status !== "VERIFIED" && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "A reason is required." });
  }
});

export const createQuotationRequestSchema = z.object({
  providerId: id,
  maintenanceRequestId: id,
  scope: text(10_000),
  responseDueAt: z.coerce.date().optional(),
});

export const quotationListSchema = z.object({
  providerId: id.optional(),
  maintenanceRequestId: id.optional(),
  status: z.enum(["OPEN", "SUBMITTED", "CLOSED", "CANCELLED", "EXPIRED"]).optional(),
});

export const submitQuotationSchema = z.object({
  labourAmountMinor: money,
  materialsAmountMinor: money,
  totalAmountMinor: money,
  currencyCode: currency,
  validUntil: z.coerce.date(),
  etaDays: z.number().int().min(1).max(3650),
  notes: z.string().trim().max(5000).optional(),
}).superRefine((value, context) => {
  if (BigInt(value.labourAmountMinor) + BigInt(value.materialsAmountMinor) !== BigInt(value.totalAmountMinor)) {
    context.addIssue({ code: "custom", path: ["totalAmountMinor"], message: "Total must equal labour plus materials." });
  }
});

export const reviewQuotationSchema = z.object({
  reason: z.string().trim().min(1).max(2000).optional(),
});

export const assignProviderSchema = z.object({
  providerId: id,
  quotationId: id.optional(),
  expectedStartAt: z.coerce.date().optional(),
  expectedCompletionAt: z.coerce.date().optional(),
}).refine(
  (value) => !value.expectedStartAt || !value.expectedCompletionAt || value.expectedCompletionAt >= value.expectedStartAt,
  { path: ["expectedCompletionAt"], message: "Expected completion cannot precede expected start." },
);

export const respondAssignmentSchema = z.object({
  response: z.enum(["ACCEPTED", "DECLINED"]),
  declineReason: z.string().trim().min(1).max(2000).optional(),
  expectedStartAt: z.coerce.date().optional(),
  expectedCompletionAt: z.coerce.date().optional(),
}).superRefine((value, context) => {
  if (value.response === "DECLINED" && !value.declineReason) {
    context.addIssue({ code: "custom", path: ["declineReason"], message: "A decline reason is required." });
  }
  if (value.expectedStartAt && value.expectedCompletionAt && value.expectedCompletionAt < value.expectedStartAt) {
    context.addIssue({ code: "custom", path: ["expectedCompletionAt"], message: "Expected completion cannot precede expected start." });
  }
});

export const rateProviderSchema = z.object({
  score: z.number().int().min(1).max(5),
  qualityScore: z.number().int().min(1).max(5).optional(),
  timelinessScore: z.number().int().min(1).max(5).optional(),
  communicationScore: z.number().int().min(1).max(5).optional(),
  comment: z.string().trim().max(5000).optional(),
});
