import { z } from "zod";

const id = z.string().uuid();
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const jsonObject = z.record(z.string(), z.unknown());
const money = z.string().regex(/^(0|[1-9]\d*)$/, "Amount must be an integer in minor units.");
const currency = z.string().trim().length(3).transform((value) => value.toUpperCase());

const applicantFields = {
  legalName: z.string().trim().min(2).max(200),
  preferredName: optionalText(200),
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()).nullable().optional(),
  phone: optionalText(50),
  addressLine1: optionalText(300),
  city: optionalText(150),
  countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()).nullable().optional(),
  applicantNotes: optionalText(5_000),
  internalNotes: optionalText(10_000),
};

export const applicantIdSchema = id;
export const applicationIdSchema = id;

export const createApplicantSchema = z.object(applicantFields).strict().refine(
  ({ email, phone }) => Boolean(email || phone),
  { path: ["email"], message: "An applicant email address or phone number is required." },
);

export const updateApplicantSchema = z.object(
  Object.fromEntries(Object.entries(applicantFields).map(([key, schema]) => [key, schema.optional()])),
).strict().refine((value) => Object.keys(value).length > 0, "At least one applicant field is required.");

export const applicantListSchema = z.object({
  q: z.string().trim().min(2).max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const applicationDocumentSchema = z.object({
  type: z.enum(["ID", "INCOME", "EMPLOYMENT", "REFERENCE", "OTHER"]),
  storageKey: z.string().trim().min(1).max(1_000),
  fileName: z.string().trim().min(1).max(255),
  contentType: optionalText(120),
  sizeBytes: z.number().int().positive().max(2_147_483_647).optional(),
  checksum: optionalText(256),
  metadata: jsonObject.optional(),
}).strict();

export const applicationConsentSchema = z.object({
  type: z.string().trim().min(1).max(100),
  textVersion: z.string().trim().min(1).max(100),
  granted: z.boolean(),
  grantedAt: z.coerce.date().optional(),
  revokedAt: z.coerce.date().optional(),
  metadata: jsonObject.optional(),
}).strict().superRefine((consent, context) => {
  if (consent.granted && consent.revokedAt) {
    context.addIssue({ code: "custom", path: ["revokedAt"], message: "A granted consent cannot also be revoked." });
  }
});

const readinessFields = {
  employmentDetails: jsonObject.nullable().optional(),
  incomeAmountMinor: money.nullable().optional(),
  incomeCurrencyCode: currency.nullable().optional(),
  incomeFrequency: optionalText(50),
  previousTenancy: jsonObject.nullable().optional(),
  references: z.array(jsonObject).max(20).nullable().optional(),
  emergencyContact: jsonObject.nullable().optional(),
  household: z.array(jsonObject).max(30).nullable().optional(),
  coApplicants: z.array(jsonObject).max(20).nullable().optional(),
  applicantNotes: optionalText(10_000),
};

function validateIncome(
  value: { incomeAmountMinor?: string | null; incomeCurrencyCode?: string | null; incomeFrequency?: string | null },
  context: z.RefinementCtx,
) {
  const supplied = [value.incomeAmountMinor, value.incomeCurrencyCode, value.incomeFrequency].filter((item) => item != null).length;
  if (supplied !== 0 && supplied !== 3) {
    context.addIssue({ code: "custom", path: ["incomeAmountMinor"], message: "Income amount, currency, and frequency must be provided together." });
  }
}

export const createRentalApplicationSchema = z.object({
  listingId: id,
  leadId: id,
  applicantId: id,
  assigneeMemberId: id.nullable().optional(),
  ...readinessFields,
  staffReviewNotes: optionalText(10_000),
  documents: z.array(applicationDocumentSchema).max(50).default([]),
  consents: z.array(applicationConsentSchema).max(30).default([]),
}).strict().superRefine(validateIncome);

export const updateRentalApplicationSchema = z.object({
  assigneeMemberId: id.nullable().optional(),
  ...readinessFields,
  staffReviewNotes: optionalText(10_000),
  documents: z.array(applicationDocumentSchema).max(50).optional(),
  consents: z.array(applicationConsentSchema).max(30).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one application field is required.")
  .superRefine(validateIncome);

export const applicationListSchema = z.object({
  listingId: id.optional(),
  leadId: id.optional(),
  applicantId: id.optional(),
  status: z.enum(["DRAFT", "SUBMITTED", "UNDER_REVIEW", "MORE_INFORMATION_REQUIRED", "APPROVED", "REJECTED", "WITHDRAWN", "EXPIRED"]).optional(),
  assigneeMemberId: id.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const applicationTransitionSchema = z.object({
  status: z.enum(["SUBMITTED", "UNDER_REVIEW", "MORE_INFORMATION_REQUIRED", "APPROVED", "REJECTED", "WITHDRAWN", "EXPIRED"]),
  note: z.string().trim().min(1).max(2_000).optional(),
  decisionCategory: optionalText(100),
  decisionReason: optionalText(2_000),
  staffReviewNotes: optionalText(10_000),
}).strict().superRefine((value, context) => {
  if (value.status === "REJECTED" && (!value.decisionCategory || !value.decisionReason)) {
    context.addIssue({ code: "custom", path: ["decisionReason"], message: "Rejected applications require a decision category and reason." });
  }
  if (!["APPROVED", "REJECTED"].includes(value.status) && (value.decisionCategory !== undefined || value.decisionReason !== undefined)) {
    context.addIssue({ code: "custom", path: ["decisionReason"], message: "Decision details are only valid for approval or rejection." });
  }
});

export const createApplicationLeaseSchema = z.object({
  referenceNumber: z.string().trim().min(2).max(80),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  rentAmountMinor: money.optional(),
  currencyCode: currency.optional(),
  rentFrequency: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL", "CUSTOM"]).optional(),
  customFrequency: optionalText(200),
  depositAmountMinor: money.optional(),
  notes: optionalText(4_000),
}).strict().refine((value) => value.endDate >= value.startDate, {
  path: ["endDate"],
  message: "Lease end date cannot precede start date.",
});
