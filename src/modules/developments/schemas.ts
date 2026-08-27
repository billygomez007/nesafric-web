import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);

export const createDevelopmentSchema = z.object({
  name: text(200),
  description: z.string().trim().max(5000).optional(),
  countryCode: z.string().length(2).toUpperCase(),
  region: text(120).optional(),
  city: text(120).optional(),
  district: text(120).optional(),
  addressLine1: text(250).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  amenities: z.array(text(80)).max(50).default([]),
  mediaUrls: z.array(z.string().trim().url().max(2000)).max(50).default([]),
});

export const updateDevelopmentSchema = z.object({
  name: text(200).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  status: z.enum(["PLANNING", "UNDER_CONSTRUCTION", "COMPLETED", "HANDED_OVER", "ARCHIVED"]).optional(),
  amenities: z.array(text(80)).max(50).optional(),
  mediaUrls: z.array(z.string().trim().url().max(2000)).max(50).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const createDevelopmentUnitSchema = z.object({
  name: text(120),
  unitType: text(80).optional(),
  bedrooms: z.number().int().min(0).max(99).optional(),
  bathrooms: z.number().min(0).max(99).optional(),
  sizeSqm: z.number().positive().max(1_000_000).optional(),
  priceMinor: z.string().regex(/^\d+$/).optional(),
  currencyCode: z.string().length(3).toUpperCase().optional(),
});

export const updateDevelopmentUnitSchema = z.object({
  name: text(120).optional(),
  unitType: text(80).nullable().optional(),
  status: z.enum(["AVAILABLE", "RESERVED", "SOLD", "RENTED", "UNAVAILABLE"]).optional(),
  bedrooms: z.number().int().min(0).max(99).nullable().optional(),
  bathrooms: z.number().min(0).max(99).nullable().optional(),
  sizeSqm: z.number().positive().max(1_000_000).nullable().optional(),
  priceMinor: z.string().regex(/^\d+$/).nullable().optional(),
  currencyCode: z.string().length(3).toUpperCase().nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required.");
