import { z } from "zod";

const id = z.string().uuid();
const jsonObject = z.record(z.string(), z.unknown());

export const marketplaceAIEmployeeSchema = z.object({
  name: z.string().trim().min(2).max(100),
  role: z.enum(["AI_SALES_RECEPTIONIST", "AI_SALES_AGENT", "AI_LEAD_MANAGER", "AI_LISTING_ASSISTANT"]),
  description: z.string().trim().max(1_000).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  instructions: jsonObject.default({}),
  escalationConfiguration: jsonObject.default({}),
  timezone: z.string().trim().min(1).max(100).default("UTC"),
}).strict();

export const marketplaceAIEmployeeUpdateSchema = marketplaceAIEmployeeSchema.partial().extend({
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
}).strict();

export const listingAvailabilityQuerySchema = z.object({
  listingId: id.optional(),
  query: z.string().trim().min(1).max(500).optional(),
}).strict().refine((value) => value.listingId || value.query, "Either a listing id or a free-text query is required.");

export const inventorySearchSchema = z.object({
  purpose: z.enum(["RENT", "SALE"]).optional(),
  minPriceMinor: z.string().regex(/^\d+$/).optional(),
  maxPriceMinor: z.string().regex(/^\d+$/).optional(),
  bedrooms: z.number().int().min(0).max(20).optional(),
  bathrooms: z.number().min(0).max(20).optional(),
  city: z.string().trim().max(150).optional(),
  region: z.string().trim().max(150).optional(),
  developmentId: id.optional(),
  amenities: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  category: z.string().trim().max(100).optional(),
}).strict();

export const qualifyLeadSchema = z.object({
  leadId: id,
  requirements: z.string().trim().min(1).max(2_000).optional(),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "VIEWING_SCHEDULED", "VIEWING_COMPLETED", "APPLICATION_STARTED", "CLOSED", "LOST"]).optional(),
}).strict();

export const scheduleViewingSchema = z.object({
  leadId: id,
  listingId: id,
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  timezone: z.string().trim().min(1).max(100).default("UTC"),
  requesterNote: z.string().trim().max(2_000).optional(),
}).strict();

export const escalateLeadSchema = z.object({
  leadId: id.optional(),
  reason: z.string().trim().min(3).max(1_000),
  urgency: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  contextSummary: z.string().trim().min(3).max(2_000),
}).strict();
