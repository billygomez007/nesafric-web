import { z } from "zod";

const id = z.string().uuid();
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const minorUnits = z.string().regex(/^(0|[1-9]\d*)$/, "Amount must be an integer in minor units.");
const currency = z.string().trim().length(3).transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z]{3}$/.test(value), "Currency must be a three-letter code.");
const country = z.string().trim().length(2).transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z]{2}$/.test(value), "Country must be a two-letter code.");
const amenityKey = z.string().trim().min(1).max(80).transform((value) => value.toLowerCase())
  .refine((value) => /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(value), "Amenity keys must be URL-safe.");

export const listingIdSchema = id;
export const leadIdSchema = id;
export const viewingRequestIdSchema = id;

export const listingAmenitySchema = z.object({
  key: amenityKey,
  label: z.string().trim().min(1).max(120),
  category: optionalText(80),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const listingMediaSchema = z.object({
  type: z.enum(["PHOTO", "VIDEO", "FLOOR_PLAN"]),
  publicUrl: z.string().url().max(2_000),
  storageKey: optionalText(500),
  mimeType: optionalText(120),
  title: optionalText(160),
  altText: optionalText(500),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  width: z.number().int().positive().max(100_000).optional(),
  height: z.number().int().positive().max(100_000).optional(),
  durationSeconds: z.number().int().positive().max(604_800).optional(),
  fileSizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  checksum: optionalText(256),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict().superRefine((media, context) => {
  if (media.type === "PHOTO" && media.durationSeconds !== undefined) {
    context.addIssue({ code: "custom", path: ["durationSeconds"], message: "Photos cannot have a duration." });
  }
});

const listingFields = {
  propertyId: id.nullable().optional(),
  marketplaceAssetId: id.nullable().optional(),
  unitId: id.nullable().optional(),
  listingType: z.enum(["RENT", "SALE"]),
  category: z.string().trim().min(1).max(100),
  title: z.string().trim().min(3).max(200),
  publicDescription: z.string().trim().min(20).max(10_000),
  askingAmountMinor: minorUnits.nullable().optional(),
  rentAmountMinor: minorUnits.nullable().optional(),
  currencyCode: currency,
  frequency: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL", "CUSTOM"]).nullable().optional(),
  availableFrom: z.coerce.date(),
  bedrooms: z.number().int().min(0).max(100).nullable().optional(),
  bathrooms: z.number().min(0).max(100).multipleOf(0.5).nullable().optional(),
  sizeSqm: z.number().positive().max(100_000_000).nullable().optional(),
  countryCode: country,
  region: optionalText(150),
  city: optionalText(150),
  district: optionalText(150),
  locality: optionalText(150),
  publicLocationLabel: optionalText(250),
  mapLatitude: z.number().min(-90).max(90).nullable().optional(),
  mapLongitude: z.number().min(-180).max(180).nullable().optional(),
  mapPrecision: z.enum(["APPROXIMATE", "DISTRICT", "CITY", "REGION"]).nullable().optional(),
  contactName: optionalText(160),
  contactEmail: z.string().trim().email().max(320).nullable().optional(),
  contactPhone: optionalText(50),
  showContactEmail: z.boolean().default(false),
  showContactPhone: z.boolean().default(false),
  enquiryEnabled: z.boolean().default(true),
  privateNotes: optionalText(10_000),
  amenities: z.array(listingAmenitySchema).max(200).default([]),
  media: z.array(listingMediaSchema).max(100).default([]),
  /// Phase 21A item 5 — optional marketplace-professional attribution. Every existing caller
  /// that omits these behaves byte-identical to before this phase.
  listingAuthority: z.enum(["OWNER_SELF", "PROPERTY_MANAGER", "MANAGING_AGENT", "BROKERAGE_AUTHORIZED", "DEVELOPER", "THIRD_PARTY_AUTHORIZED"]).nullable().optional(),
  marketplaceProfessionalId: id.nullable().optional(),
  listingRepresentativeUserId: id.nullable().optional(),
  developmentId: id.nullable().optional(),
  developmentUnitId: id.nullable().optional(),
};

function validateListing(
  listing: {
    propertyId?: string | null;
    marketplaceAssetId?: string | null;
    unitId?: string | null;
    listingType?: "RENT" | "SALE";
    askingAmountMinor?: string | null;
    rentAmountMinor?: string | null;
    frequency?: "MONTHLY" | "QUARTERLY" | "ANNUAL" | "CUSTOM" | null;
    mapLatitude?: number | null;
    mapLongitude?: number | null;
    mapPrecision?: "APPROXIMATE" | "DISTRICT" | "CITY" | "REGION" | null;
    showContactEmail?: boolean;
    showContactPhone?: boolean;
    contactEmail?: string | null;
    contactPhone?: string | null;
    amenities?: Array<{ key: string }>;
  },
  context: z.RefinementCtx,
) {
  if (Boolean(listing.propertyId) === Boolean(listing.marketplaceAssetId)) {
    context.addIssue({ code: "custom", path: ["propertyId"], message: "Exactly one managed property or marketplace asset source is required." });
  }
  if (listing.unitId && !listing.propertyId) {
    context.addIssue({ code: "custom", path: ["unitId"], message: "A PropertyOS unit requires a managed property source." });
  }
  if (listing.listingType === "RENT") {
    if (!listing.rentAmountMinor) context.addIssue({ code: "custom", path: ["rentAmountMinor"], message: "Rent amount is required for rental listings." });
    if (!listing.frequency) context.addIssue({ code: "custom", path: ["frequency"], message: "Frequency is required for rental listings." });
    if (listing.askingAmountMinor != null) context.addIssue({ code: "custom", path: ["askingAmountMinor"], message: "Asking amount is only valid for sale listings." });
  }
  if (listing.listingType === "SALE") {
    if (!listing.askingAmountMinor) context.addIssue({ code: "custom", path: ["askingAmountMinor"], message: "Asking amount is required for sale listings." });
    if (listing.rentAmountMinor != null) context.addIssue({ code: "custom", path: ["rentAmountMinor"], message: "Rent amount is only valid for rental listings." });
    if (listing.frequency != null) context.addIssue({ code: "custom", path: ["frequency"], message: "Frequency is only valid for rental listings." });
  }
  if ((listing.mapLatitude == null) !== (listing.mapLongitude == null)) {
    context.addIssue({ code: "custom", path: ["mapLatitude"], message: "Map latitude and longitude must be provided together." });
  }
  if (listing.mapLatitude != null && !listing.mapPrecision) {
    context.addIssue({ code: "custom", path: ["mapPrecision"], message: "Map precision is required with coordinates." });
  }
  if (listing.showContactEmail && !listing.contactEmail) {
    context.addIssue({ code: "custom", path: ["contactEmail"], message: "A contact email is required before it can be published." });
  }
  if (listing.showContactPhone && !listing.contactPhone) {
    context.addIssue({ code: "custom", path: ["contactPhone"], message: "A contact phone is required before it can be published." });
  }
  const keys = listing.amenities?.map(({ key }) => key) ?? [];
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", path: ["amenities"], message: "Amenity keys must be unique." });
  }
}

export const createListingSchema = z.object(listingFields).strict().superRefine(validateListing);

export const createMarketplaceAssetSchema = z.object({
  developmentUnitId: id.nullable().optional(),
  name: z.string().trim().min(3).max(200),
  category: z.string().trim().min(1).max(100),
  subtype: optionalText(100),
  purpose: z.enum(["RENT", "SALE"]),
  bedrooms: z.number().int().min(0).max(100).nullable().optional(),
  bathrooms: z.number().min(0).max(100).multipleOf(0.5).nullable().optional(),
  sizeSqm: z.number().positive().max(100_000_000).nullable().optional(),
  currencyCode: currency,
  priceMinor: minorUnits,
  countryCode: country,
  region: optionalText(150), city: optionalText(150), district: optionalText(150), locality: optionalText(150),
  publicLocationLabel: optionalText(250),
  mapLatitude: z.number().min(-90).max(90).nullable().optional(),
  mapLongitude: z.number().min(-180).max(180).nullable().optional(),
  amenities: z.array(z.string().trim().min(1).max(120)).max(200).default([]),
  furnishing: optionalText(100),
  mediaUrls: z.array(z.string().url().max(2_000)).max(100).default([]),
  availableFrom: z.coerce.date(),
  authorityEvidenceReady: z.boolean().default(false),
}).strict().superRefine((asset, context) => {
  if ((asset.mapLatitude == null) !== (asset.mapLongitude == null)) context.addIssue({ code: "custom", path: ["mapLatitude"], message: "Map latitude and longitude must be provided together." });
});

export const createMarketplaceNativeListingSchema = z.object({
  asset: createMarketplaceAssetSchema,
  listing: z.object({ ...listingFields, propertyId: z.never().optional(), marketplaceAssetId: z.never().optional(), unitId: z.never().optional(), marketplaceProfessionalId: z.never().optional(), developmentId: z.never().optional(), developmentUnitId: z.never().optional() }).strict(),
  listingRepresentativeUserId: id.nullable().optional(),
  listingAuthority: z.enum(["OWNER_SELF", "PROPERTY_MANAGER", "MANAGING_AGENT", "BROKERAGE_AUTHORIZED", "DEVELOPER", "THIRD_PARTY_AUTHORIZED"]),
}).strict();

export const updateListingAttributionSchema = z.object({
  listingRepresentativeUserId: id.nullable().optional(),
  listingAuthority: z.enum(["OWNER_SELF", "PROPERTY_MANAGER", "MANAGING_AGENT", "BROKERAGE_AUTHORIZED", "DEVELOPER", "THIRD_PARTY_AUTHORIZED"]).optional(),
  marketplaceProfessionalId: id.optional(),
  reason: z.string().trim().min(3).max(2_000),
}).strict().refine((value) => value.listingRepresentativeUserId !== undefined || value.listingAuthority !== undefined || value.marketplaceProfessionalId !== undefined, "An attribution change is required.");

const updateListingFields = {
  ...listingFields,
  showContactEmail: z.boolean(),
  showContactPhone: z.boolean(),
  enquiryEnabled: z.boolean(),
  amenities: z.array(listingAmenitySchema).max(200),
  media: z.array(listingMediaSchema).max(100),
};

export const updateListingSchema = z.object({
  ...Object.fromEntries(Object.entries(updateListingFields).map(([key, schema]) => [key, schema.optional()])),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const listingTransitionSchema = z.object({
  status: z.enum(["PENDING_REVIEW", "PUBLISHED", "PAUSED", "RESERVED", "RENTED", "ARCHIVED", "REJECTED", "DRAFT"]),
  note: z.string().trim().min(1).max(2_000).optional(),
}).strict();

export const listingVerificationSchema = z.object({
  status: z.enum(["PENDING", "VERIFIED", "REJECTED", "SUSPENDED"]),
  note: z.string().trim().min(1).max(2_000).optional(),
  evidence: z.array(z.object({
    type: z.string().trim().min(1).max(100),
    privateReference: z.string().trim().min(1).max(1_000),
    metadata: z.record(z.string(), z.unknown()).optional(),
    expiresAt: z.coerce.date().optional(),
  }).strict()).max(50).optional(),
}).strict();

const commaSeparated = (schema: z.ZodType<string>) => z.preprocess(
  (value) => typeof value === "string" ? value.split(",").map((part) => part.trim()).filter(Boolean) : value,
  z.array(schema).max(50),
);

export const publicListingSearchSchema = z.object({
  q: z.string().trim().min(2).max(100).optional(),
  listingType: z.enum(["RENT", "SALE"]).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  scope: z.enum(["PROPERTY", "UNIT"]).optional(),
  minPriceMinor: minorUnits.optional(),
  maxPriceMinor: minorUnits.optional(),
  currencyCode: currency.optional(),
  frequency: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL", "CUSTOM"]).optional(),
  availableOn: z.coerce.date().optional(),
  bedroomsMin: z.coerce.number().int().min(0).max(100).optional(),
  bedroomsMax: z.coerce.number().int().min(0).max(100).optional(),
  bathroomsMin: z.coerce.number().min(0).max(100).optional(),
  bathroomsMax: z.coerce.number().min(0).max(100).optional(),
  sizeMinSqm: z.coerce.number().positive().optional(),
  sizeMaxSqm: z.coerce.number().positive().optional(),
  country: country.optional(),
  region: z.string().trim().min(1).max(150).optional(),
  state: z.string().trim().min(1).max(150).optional(),
  city: z.string().trim().min(1).max(150).optional(),
  district: z.string().trim().min(1).max(150).optional(),
  amenities: commaSeparated(amenityKey).optional(),
  mediaTypes: commaSeparated(z.enum(["PHOTO", "VIDEO", "FLOOR_PLAN"])).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict().superRefine((filters, context) => {
  if (filters.region && filters.state) context.addIssue({ code: "custom", path: ["state"], message: "Use either region or state, not both." });
  if ((filters.region || filters.state || filters.city || filters.district) && !filters.country) {
    context.addIssue({ code: "custom", path: ["country"], message: "Country is required for narrower location filters." });
  }
  if (filters.minPriceMinor && filters.maxPriceMinor && BigInt(filters.minPriceMinor) > BigInt(filters.maxPriceMinor)) {
    context.addIssue({ code: "custom", path: ["maxPriceMinor"], message: "Maximum price must be at least the minimum price." });
  }
  if (filters.bedroomsMin !== undefined && filters.bedroomsMax !== undefined && filters.bedroomsMin > filters.bedroomsMax) {
    context.addIssue({ code: "custom", path: ["bedroomsMax"], message: "Maximum bedrooms must be at least the minimum." });
  }
  if (filters.bathroomsMin !== undefined && filters.bathroomsMax !== undefined && filters.bathroomsMin > filters.bathroomsMax) {
    context.addIssue({ code: "custom", path: ["bathroomsMax"], message: "Maximum bathrooms must be at least the minimum." });
  }
  if (filters.sizeMinSqm !== undefined && filters.sizeMaxSqm !== undefined && filters.sizeMinSqm > filters.sizeMaxSqm) {
    context.addIssue({ code: "custom", path: ["sizeMaxSqm"], message: "Maximum size must be at least the minimum." });
  }
});

export const listingManagementListSchema = z.object({
  propertyId: id.optional(),
  unitId: id.optional(),
  status: z.enum(["DRAFT", "PENDING_REVIEW", "PUBLISHED", "PAUSED", "RESERVED", "RENTED", "ARCHIVED", "REJECTED"]).optional(),
  listingType: z.enum(["RENT", "SALE"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const createMarketplaceLeadSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(320).optional(),
  phone: z.string().trim().min(5).max(50).optional(),
  message: z.string().trim().max(5_000).optional(),
  marketingConsent: z.boolean().default(false),
  source: z.string().trim().min(1).max(100).optional(),
}).strict().refine((lead) => lead.email || lead.phone, {
  path: ["email"],
  message: "An email address or phone number is required.",
});

export const marketplaceLeadListSchema = z.object({
  listingId: id.optional(),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "VIEWING_SCHEDULED", "VIEWING_COMPLETED", "APPLICATION_STARTED", "APPLICATION_SUBMITTED", "CLOSED", "LOST"]).optional(),
  assigneeMemberId: id.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const updateMarketplaceLeadSchema = z.object({
  status: z.enum(["CONTACTED", "QUALIFIED", "VIEWING_SCHEDULED", "VIEWING_COMPLETED", "APPLICATION_STARTED", "APPLICATION_SUBMITTED", "CLOSED", "LOST"]).optional(),
  assigneeMemberId: id.nullable().optional(),
  privateNotes: optionalText(10_000),
  note: z.string().trim().min(1).max(2_000).optional(),
}).strict().refine((value) => value.status !== undefined || value.privateNotes !== undefined || value.assigneeMemberId !== undefined, "A status, assignee, or private note is required.");

const preferredTimeSchema = z.object({
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  timezone: z.string().trim().min(1).max(100),
}).strict().refine((time) => time.endsAt > time.startsAt, {
  path: ["endsAt"],
  message: "Preferred time must end after it starts.",
});

export const createViewingRequestSchema = z.object({
  leadId: id,
  preferredTimes: z.array(preferredTimeSchema).min(1).max(5),
  requesterNote: z.string().trim().max(2_000).optional(),
}).strict();

export const viewingRequestListSchema = z.object({
  listingId: id.optional(),
  leadId: id.optional(),
  status: z.enum(["REQUESTED", "CONFIRMED", "RESCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(),
  assigneeMemberId: id.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const updateViewingRequestSchema = z.object({
  status: z.enum(["CONFIRMED", "RESCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(),
  assigneeMemberId: id.nullable().optional(),
  privateNotes: optionalText(10_000),
  outcome: optionalText(2_000),
  confirmedStartsAt: z.coerce.date().nullable().optional(),
  confirmedEndsAt: z.coerce.date().nullable().optional(),
  note: z.string().trim().min(1).max(2_000).optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "note"), "At least one viewing field is required.")
  .superRefine((value, context) => {
    if ((value.confirmedStartsAt == null) !== (value.confirmedEndsAt == null)) {
      context.addIssue({ code: "custom", path: ["confirmedStartsAt"], message: "Confirmed start and end must be provided together." });
    }
    if (value.confirmedStartsAt && value.confirmedEndsAt && value.confirmedEndsAt <= value.confirmedStartsAt) {
      context.addIssue({ code: "custom", path: ["confirmedEndsAt"], message: "Confirmed end must be after the start." });
    }
  });
