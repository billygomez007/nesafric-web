import { z } from "zod";

const unitSchema = z.object({ name: z.string().trim().min(1).max(80), unitType: z.string().max(80).optional(), floor: z.string().max(30).optional(), bedrooms: z.number().int().min(0).max(99).optional(), bathrooms: z.number().int().min(0).max(99).optional() });
export const createPortfolioSchema = z.object({ name: z.string().trim().min(2).max(160), description: z.string().trim().max(1000).optional() });
export const createPropertySchema = z.object({
  name: z.string().trim().min(2).max(200), referenceNumber: z.string().trim().min(2).max(80), category: z.string().trim().min(2).max(80),
  portfolioId: z.string().uuid().optional(), countryCode: z.string().length(2).toUpperCase(), currencyCode: z.string().length(3).toUpperCase(),
  city: z.string().trim().max(100).optional(), addressLine1: z.string().trim().max(250).optional(),
  building: z.object({ name: z.string().trim().min(1).max(120), units: z.array(unitSchema).max(500).default([]) }).optional(),
  units: z.array(unitSchema).max(500).default([]),
});

export const updatePropertySchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  category: z.string().trim().min(2).max(80).optional(),
  city: z.string().trim().max(100).nullable().optional(),
  addressLine1: z.string().trim().max(250).nullable().optional(),
}).refine((input) => Object.keys(input).length > 0, "At least one property field must be provided.");
