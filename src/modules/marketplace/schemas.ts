import { z } from "zod";

const id = z.string().uuid();
export const marketplaceProviderIdSchema = id;
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalLocation = z.string().trim().min(1).max(200).optional();
const nullableLocation = z.string().trim().min(1).max(200).nullable().optional();
const money = z.string().regex(/^(0|[1-9]\d*)$/, "Amount must be an integer in minor units.");
const currency = z.string().trim().length(3).transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z]{3}$/.test(value), "Currency must be an ISO-style three-letter code.");
const country = z.string().trim().length(2).transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z]{2}$/.test(value), "Country must be an ISO-style two-letter code.");

export const marketplaceServiceAreaSchema = z.object({
  countryCode: country,
  region: optionalLocation,
  city: optionalLocation,
  district: optionalLocation,
  label: optionalLocation,
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radiusKm: z.number().positive().max(50_000).optional(),
}).strict().superRefine((area, context) => {
  if ((area.latitude === undefined) !== (area.longitude === undefined)) {
    context.addIssue({ code: "custom", path: ["latitude"], message: "Latitude and longitude must be provided together." });
  }
  if (area.radiusKm !== undefined && area.latitude === undefined) {
    context.addIssue({ code: "custom", path: ["radiusKm"], message: "A radius requires coordinates." });
  }
});

export const updateMarketplaceProfileSchema = z.object({
  listed: z.boolean().optional(),
  publicDescription: z.string().trim().max(5_000).nullable().optional(),
  showContactEmail: z.boolean().optional(),
  showContactPhone: z.boolean().optional(),
  startingRateMinor: money.nullable().optional(),
  currencyCode: currency.nullable().optional(),
  responseTimeHours: z.number().int().min(1).max(8_760).nullable().optional(),
  categoryIds: z.array(id).max(50).optional(),
  serviceAreas: z.array(marketplaceServiceAreaSchema).max(100).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const publicMarketplaceDiscoverySchema = z.object({
  // Underscore is a real, existing part of several seeded category keys (e.g. "pest_control",
  // "facility_maintenance") — hyphen-only previously rejected a working "?category=" filter for
  // any of them.
  category: z.string().trim().min(2).max(100).regex(/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/).optional(),
  categoryId: id.optional(),
  providerType: z.enum(["INDIVIDUAL", "COMPANY"]).optional(),
  country: country.optional(),
  region: optionalLocation,
  state: optionalLocation,
  city: optionalLocation,
  district: optionalLocation,
  availability: z.enum(["AVAILABLE", "LIMITED", "UNAVAILABLE"]).optional(),
  verification: z.enum(["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED", "SUSPENDED"]).optional(),
  minimumRating: z.coerce.number().min(0).max(5).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict().superRefine((value, context) => {
  if (value.category && value.categoryId) {
    context.addIssue({ code: "custom", path: ["categoryId"], message: "Use either category or categoryId, not both." });
  }
  if (value.region && value.state) {
    context.addIssue({ code: "custom", path: ["state"], message: "Use either region or state, not both." });
  }
  if ((value.region || value.state || value.city || value.district) && !value.country) {
    context.addIssue({ code: "custom", path: ["country"], message: "Country is required for narrower area filters." });
  }
});

export const createMarketplaceEnquirySchema = z.object({
  providerId: id,
  categoryId: id,
  propertyId: id.optional(),
  maintenanceRequestId: id.optional(),
  message: text(10_000),
}).strict();

export const marketplaceEnquiryListSchema = z.object({
  providerId: id.optional(),
  status: z.enum(["NEW", "VIEWED", "RESPONDED", "CLOSED", "CANCELLED"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export const updateMarketplaceEnquirySchema = z.object({
  status: z.enum(["VIEWED", "RESPONDED", "CLOSED", "CANCELLED"]),
  note: z.string().trim().min(1).max(2_000).optional(),
}).strict();

export const marketplaceQuoteRequestSchema = z.object({
  scope: text(10_000),
  responseDueAt: z.coerce.date().optional(),
}).strict();

export const nullableMarketplaceLocationSchema = z.object({
  region: nullableLocation,
  city: nullableLocation,
  district: nullableLocation,
});
