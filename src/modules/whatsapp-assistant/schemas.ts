import { z } from "zod";

export const propertyFiltersSchema = z.object({
  listingType: z.enum(["RENT", "SALE"]).optional(),
  category: z.enum(["APARTMENT", "HOUSE", "TOWNHOUSE", "VILLA", "LAND", "OFFICE", "SHOP", "WAREHOUSE", "COMMERCIAL", "GUEST_HOUSE", "HOTEL", "SHORT_STAY"]).optional(),
  location: z.string().trim().min(2).max(150).optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).optional(),
  maxPriceMinor: z.string().regex(/^\d{1,16}$/).optional(),
  bedroomsMin: z.number().int().min(0).max(100).optional(),
  bedroomsMax: z.number().int().min(0).max(100).optional(),
  frequency: z.enum(["MONTHLY", "YEARLY", "WEEKLY", "PER_NIGHT"]).optional(),
}).strict();
export const serviceFiltersSchema = z.object({
  q: z.string().trim().min(2).max(200).optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  city: z.string().trim().min(2).max(150).optional(),
}).strict();
export const interpretationSchema = z.object({
  intent: z.enum(["property_search", "service_search", "registration", "listing", "status", "support", "unknown"]),
  property: propertyFiltersSchema.optional(),
  service: serviceFiltersSchema.optional(),
}).strict();
export type Interpretation = z.infer<typeof interpretationSchema>;

export const assistantStateSchema = z.object({
  version: z.literal(1).default(1),
  workflow: z.enum(["idle", "property_search", "service_search", "inquiry", "viewing", "link"]).default("idle"),
  step: z.enum(["search", "name", "message", "time", "confirm", "link_method", "link_code"]).default("search"),
  paused: z.boolean().default(false),
  property: propertyFiltersSchema.default({}),
  service: serviceFiltersSchema.default({}),
  page: z.number().int().min(1).max(10_000).default(1),
  hasMore: z.boolean().default(false),
  results: z.array(z.string().uuid()).max(3).default([]),
  selectedListingId: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(160).optional(),
  message: z.string().trim().max(5_000).optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  lastRequest: z.object({ listingId: z.string().uuid(), leadId: z.string().uuid(), viewingId: z.string().uuid().optional() }).optional(),
  /** Account linking in progress. Holds the challenge reference only, never the code. */
  link: z.object({
    channel: z.enum(["sms", "email"]),
    identifier: z.string().max(254),
    challengeId: z.string().uuid(),
    failures: z.number().int().min(0).max(10).default(0),
  }).optional(),
}).strict();
export type AssistantState = z.infer<typeof assistantStateSchema>;
export const initialState = () => assistantStateSchema.parse({});

export const assistantChannelConfigSchema = z.object({
  phoneNumberId: z.string().regex(/^\d+$/),
  businessAccountId: z.string().regex(/^\d+$/).optional(),
  marketplaceAssistantEnabled: z.boolean().default(false),
  defaultCountry: z.string().regex(/^[A-Z]{2}$/).default("GH"),
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/).default("GHS"),
});
