import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const id = z.string().uuid();

export const createMarketplaceProfessionalSchema = z.object({
  type: z.enum(["INDIVIDUAL_AGENT", "BROKER", "BROKERAGE", "REAL_ESTATE_COMPANY", "DEVELOPER", "PROPERTY_MARKETING_COMPANY", "OTHER"]),
  displayName: text(200),
  legalName: text(300).optional(),
  logoUrl: z.string().trim().url().max(2000).optional(),
  description: z.string().trim().max(5000).optional(),
  websiteUrl: z.string().trim().url().max(2000).optional(),
  contactEmail: z.string().trim().email().max(320).optional(),
  contactPhone: text(50).optional(),
  countryCode: z.string().length(2).toUpperCase(),
  specialities: z.array(text(80)).max(50).default([]),
  servicesOffered: z.array(text(80)).max(50).default([]),
  serviceAreas: z.array(text(120)).max(50).default([]),
});

export const updateMarketplaceProfessionalSchema = z.object({
  displayName: text(200).optional(),
  legalName: text(300).nullable().optional(),
  logoUrl: z.string().trim().url().max(2000).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  websiteUrl: z.string().trim().url().max(2000).nullable().optional(),
  contactEmail: z.string().trim().email().max(320).nullable().optional(),
  contactPhone: text(50).nullable().optional(),
  specialities: z.array(text(80)).max(50).optional(),
  servicesOffered: z.array(text(80)).max(50).optional(),
  serviceAreas: z.array(text(120)).max(50).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const addMarketplaceMemberSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["ADMIN", "AGENT"]),
});

export const updateMarketplaceMemberSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "AGENT"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "REMOVED"]).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const submitMarketplaceVerificationSchema = z.object({
  evidenceReferences: z.array(text(500)).min(1).max(20),
});

export const reviewMarketplaceVerificationSchema = z.object({
  status: z.enum(["VERIFIED", "REJECTED", "SUSPENDED"]),
  reason: z.string().trim().max(2000).optional(),
});

export const changeMarketplacePlanSchema = z.object({
  planKey: text(80),
});

export const directorySearchSchema = z.object({
  type: z.enum(["INDIVIDUAL_AGENT", "BROKER", "BROKERAGE", "REAL_ESTATE_COMPANY", "DEVELOPER", "PROPERTY_MARKETING_COMPANY", "OTHER"]).optional(),
  countryCode: z.string().length(2).toUpperCase().optional(),
  serviceArea: text(120).optional(),
  speciality: text(80).optional(),
  verifiedOnly: z.coerce.boolean().optional(),
  query: text(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export { id, text };
