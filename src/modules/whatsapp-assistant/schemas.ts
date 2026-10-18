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
  workflow: z.enum(["idle", "property_search", "service_search", "inquiry", "viewing", "link", "onboarding", "network", "report", "rules"]).default("idle"),
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
  /** Provider-network management: what was last listed, and an action awaiting confirmation. */
  network: z.object({
    step: z.enum(["organisation", "details", "properties", "auto", "limit", "confirm_add", "confirm_action"]).optional(),
    organisationId: z.string().uuid().optional(),
    organisationChoices: z.array(z.string().uuid()).max(9).default([]),
    listed: z.array(z.object({ id: z.string().uuid(), organisationId: z.string().uuid(), name: z.string().max(200) })).max(30).default([]),
    propertyChoices: z.array(z.object({ id: z.string().uuid(), name: z.string().max(200) })).max(30).default([]),
    draft: z.object({
      displayName: z.string().max(160).optional(),
      phone: z.string().max(20).optional(),
      categories: z.array(z.string().max(40)).max(10).default([]),
      propertyIds: z.array(z.string().uuid()).max(30).default([]),
      autoDispatch: z.boolean().optional(),
      limitMinor: z.string().regex(/^\d+$/).optional(),
    }).default({ categories: [], propertyIds: [] }),
    action: z.object({
      kind: z.enum(["suspend", "resume", "remove", "reassign", "auto_on", "auto_off"]),
      id: z.string().uuid(),
      organisationId: z.string().uuid(),
      toId: z.string().uuid().optional(),
    }).optional(),
  }).optional(),
  /** Routing-rule management: what was last listed, a draft rule, or a change awaiting confirm. */
  rules: z.object({
    step: z.enum(["organisation", "category", "property", "primary", "backups", "mode", "cap", "timeout", "confirm_add", "confirm_action"]).optional(),
    organisationId: z.string().uuid().optional(),
    organisationChoices: z.array(z.string().uuid()).max(9).default([]),
    listed: z.array(z.object({ id: z.string().uuid(), organisationId: z.string().uuid(), name: z.string().max(200) })).max(30).default([]),
    propertyChoices: z.array(z.object({ id: z.string().uuid(), name: z.string().max(200) })).max(30).default([]),
    providerChoices: z.array(z.object({ id: z.string().uuid(), name: z.string().max(200) })).max(30).default([]),
    draft: z.object({
      category: z.string().max(40).optional(),
      propertyId: z.string().uuid().nullable().optional(),
      primary: z.string().uuid().optional(),
      backups: z.array(z.string().uuid()).max(5).default([]),
      mode: z.enum(["PRE_AUTHORIZED", "INSPECTION_ONLY", "QUOTE_REQUIRED", "APPROVAL_REQUIRED", "ESCALATE"]).optional(),
      capMinor: z.string().regex(/^\d+$/).optional(),
      timeoutMinutes: z.number().int().optional(),
    }).default({ backups: [] }),
    action: z.object({ kind: z.enum(["pause", "resume", "set_cap"]), ids: z.array(z.object({ id: z.string().uuid(), organisationId: z.string().uuid() })).min(1).max(30), capMinor: z.string().regex(/^\d+$/).optional() }).optional(),
  }).optional(),
  /** A tenant's maintenance report being put together. */
  report: z.object({
    step: z.enum(["tenancy", "describe", "photos", "duplicate", "confirm"]),
    choices: z.array(z.object({ tenantOrganisationId: z.string().uuid(), organisationId: z.string().uuid(), organisationName: z.string().max(200), propertyId: z.string().uuid(), propertyName: z.string().max(200), unitId: z.string().uuid().optional(), unitName: z.string().max(80).optional() })).max(9).default([]),
    selected: z.number().int().min(0).max(8).optional(),
    description: z.string().max(4000).optional(),
    media: z.array(z.object({ id: z.string().max(100), mimeType: z.string().max(100).optional() })).max(5).default([]),
    classification: z.object({ category: z.string().max(40), priority: z.enum(["EMERGENCY", "URGENT", "NORMAL", "LOW"]), safetyHazard: z.boolean(), title: z.string().max(120), source: z.enum(["model", "rules"]) }).optional(),
    duplicate: z.object({ id: z.string().uuid(), referenceNumber: z.string().max(40), title: z.string().max(200) }).optional(),
  }).optional(),
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
