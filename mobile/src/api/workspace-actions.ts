import { isBookableCategory } from "@/marketplace/listing-categories";
import type { ApiClient } from "./client";

/**
 * Workspace write actions for the native app. Every call reuses the website's own API — the same
 * validation, permission checks, listing review rules and audit events — so the app never decides
 * what a user may do: a button only sends the request, and the server accepts or refuses it.
 *
 * Property management calls carry the workspace in `x-organisation-id` (the server checks
 * membership and role permission); professional calls carry it in the path (the server checks
 * membership and that the listing belongs to that professional).
 */

// ---------------------------------------------------------------------------------------------
// Real estate professional listings (`/api/marketplace-professionals/:id/listings…`)
// ---------------------------------------------------------------------------------------------

export type ListingAuthority = "OWNER_SELF" | "PROPERTY_MANAGER" | "MANAGING_AGENT" | "BROKERAGE_AUTHORIZED" | "DEVELOPER" | "THIRD_PARTY_AUTHORIZED";

export type ListingPhoto = { id: string; publicUrl: string; isCover: boolean };

/** The fields the app's listing form reads back when editing. */
export type EditableListing = {
  id: string;
  status: string;
  verificationStatus: string;
  listingType: "RENT" | "SALE";
  category: string;
  title: string;
  publicDescription: string;
  priceMinor: string | null;
  currencyCode: string;
  frequency: string | null;
  availableFrom: string;
  bedrooms: number | null;
  maxGuests?: number | null;
  minimumNights?: number | null;
  bathrooms: number | null;
  sizeSqm: number | null;
  landSizeSqm: number | null;
  furnishing: string | null;
  negotiable: boolean;
  region: string | null;
  city: string | null;
  district: string | null;
  locality: string | null;
  listingAuthority: ListingAuthority | null;
  amenities: string[];
  photos: ListingPhoto[];
  /** Latest reviewer note when NesAfric returned or rejected the listing. */
  reviewNote: string | null;
};

type RawListing = {
  id: string;
  status: string;
  verificationStatus: string;
  listingType: "RENT" | "SALE";
  category: string;
  title: string;
  publicDescription: string;
  askingAmountMinor: string | null;
  rentAmountMinor: string | null;
  currencyCode: string;
  frequency: string | null;
  maxGuests?: number | null;
  minimumNights?: number | null;
  availableFrom: string;
  bedrooms: number | null;
  bathrooms: string | number | null;
  sizeSqm: string | number | null;
  landSizeSqm: string | number | null;
  furnishing: string | null;
  negotiable: boolean;
  region: string | null;
  city: string | null;
  district: string | null;
  locality: string | null;
  listingAuthority: ListingAuthority | null;
  amenities?: { label: string }[];
  media?: { id: string; type: string; publicUrl: string; isCover?: boolean }[];
  statusHistory?: { toStatus: string; note: string | null }[];
};

const numberOrNull = (value: string | number | null | undefined) => (value === null || value === undefined || value === "" ? null : Number(value));

export function toEditableListing(raw: RawListing): EditableListing {
  const lastReturn = [...(raw.statusHistory ?? [])].reverse().find((entry) => entry.toStatus === "REJECTED" || entry.toStatus === "DRAFT");
  return {
    id: raw.id,
    status: raw.status,
    verificationStatus: raw.verificationStatus,
    listingType: raw.listingType,
    category: raw.category,
    title: raw.title,
    publicDescription: raw.publicDescription,
    priceMinor: (raw.listingType === "SALE" ? raw.askingAmountMinor : raw.rentAmountMinor) ?? null,
    currencyCode: raw.currencyCode,
    frequency: raw.frequency ?? null,
    availableFrom: raw.availableFrom,
    bedrooms: raw.bedrooms ?? null,
    maxGuests: raw.maxGuests ?? null,
    minimumNights: raw.minimumNights ?? null,
    bathrooms: numberOrNull(raw.bathrooms),
    sizeSqm: numberOrNull(raw.sizeSqm),
    landSizeSqm: numberOrNull(raw.landSizeSqm),
    furnishing: raw.furnishing ?? null,
    negotiable: Boolean(raw.negotiable),
    region: raw.region ?? null,
    city: raw.city ?? null,
    district: raw.district ?? null,
    locality: raw.locality ?? null,
    listingAuthority: raw.listingAuthority ?? null,
    amenities: (raw.amenities ?? []).map((amenity) => amenity.label),
    photos: (raw.media ?? []).filter((media) => media.type === "PHOTO").map((media) => ({ id: media.id, publicUrl: media.publicUrl, isCover: Boolean(media.isCover) })),
    reviewNote: raw.status === "REJECTED" ? lastReturn?.note ?? null : null,
  };
}

/** What the app's listing form collects. Prices are in major units as typed ("1200" or "1200.50"). */
export type ListingDraft = {
  listingType: "RENT" | "SALE";
  category: string;
  title: string;
  description: string;
  price: string;
  /** Price unit; "" on a sale means a total price. */
  priceUnit: string;
  availableFrom: string;
  bedrooms: string;
  bathrooms: string;
  sizeSqm: string;
  landSizeSqm: string;
  furnishing: string;
  negotiable: boolean;
  region: string;
  city: string;
  district: string;
  locality: string;
  amenities: string[];
  listingAuthority: ListingAuthority;
  /** Hotels and short stays only. */
  maxGuests?: string;
  minimumNights?: string;
};

const RESIDENTIAL = new Set(["APARTMENT", "HOUSE", "TOWNHOUSE", "VILLA", "GUEST_HOUSE", "HOTEL", "SHORT_STAY"]);

/** "1,200.5" → "120050" minor units; null when not a valid non-negative amount. */
export function toMinorUnits(price: string): string | null {
  const cleaned = price.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return `${whole}${(fraction + "00").slice(0, 2)}`.replace(/^0+(?=\d)/, "");
}

const trimmed = (value: string) => value.trim() || null;
const numeric = (value: string) => (value.trim() === "" ? null : Number(value));

/**
 * The same payload the website's listing form sends (`createMarketplaceNativeListingSchema`): a
 * professional-owned asset plus its listing. Validation happens on the server; this only shapes.
 */
export function listingPayload(draft: ListingDraft) {
  const priceMinor = toMinorUnits(draft.price) ?? "";
  const residential = RESIDENTIAL.has(draft.category);
  const land = draft.category === "LAND";
  // Hotels and short stays are nightly rentals (the server insists on it too).
  const stay = isBookableCategory(draft.category);
  const listingType = stay ? "RENT" : draft.listingType;
  const amenities = draft.amenities.map((label) => ({ key: label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), label }));
  const location = { region: trimmed(draft.region), city: trimmed(draft.city), district: trimmed(draft.district), locality: trimmed(draft.locality) };
  const listing = {
    listingType,
    category: draft.category,
    title: draft.title.trim(),
    publicDescription: draft.description.trim(),
    currencyCode: "GHS",
    askingAmountMinor: listingType === "SALE" ? priceMinor : null,
    rentAmountMinor: listingType === "RENT" ? priceMinor : null,
    frequency: stay ? "PER_NIGHT" : draft.priceUnit || null,
    maxGuests: stay ? numeric(draft.maxGuests ?? "") : null,
    minimumNights: stay ? numeric(draft.minimumNights ?? "") : null,
    availableFrom: draft.availableFrom,
    bedrooms: residential ? numeric(draft.bedrooms) : null,
    bathrooms: residential ? numeric(draft.bathrooms) : null,
    sizeSqm: land ? null : numeric(draft.sizeSqm),
    landSizeSqm: numeric(draft.landSizeSqm),
    furnishing: residential ? draft.furnishing || null : null,
    negotiable: draft.negotiable,
    countryCode: "GH",
    ...location,
    enquiryEnabled: true,
    amenities,
    media: [],
  };
  return {
    asset: {
      name: listing.title,
      category: draft.category,
      purpose: listingType,
      currencyCode: "GHS",
      priceMinor,
      countryCode: "GH",
      ...location,
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      sizeSqm: listing.sizeSqm,
      amenities: draft.amenities,
      furnishing: listing.furnishing,
      mediaUrls: [],
      availableFrom: draft.availableFrom,
      authorityEvidenceReady: false,
    },
    listing,
    listingAuthority: draft.listingAuthority,
  };
}

const proPath = (professionalId: string, path = "") => `/api/marketplace-professionals/${encodeURIComponent(professionalId)}${path}`;
const listingPath = (professionalId: string, listingId: string, path = "") => proPath(professionalId, `/listings/${encodeURIComponent(listingId)}${path}`);

export async function getProListing(api: ApiClient, professionalId: string, listingId: string, signal?: AbortSignal) {
  return toEditableListing(await api.request<RawListing>(listingPath(professionalId, listingId), { auth: true, signal }));
}

/** Creates a draft listing; it stays private until submitted and approved by NesAfric review. */
export async function createProListing(api: ApiClient, professionalId: string, draft: ListingDraft) {
  return toEditableListing(await api.request<RawListing>(proPath(professionalId, "/listings"), { method: "POST", auth: true, body: listingPayload(draft) }));
}

/** Saves the details of an editable (draft, returned or paused) listing. Photos are unchanged. */
export async function updateProListing(api: ApiClient, professionalId: string, listingId: string, draft: ListingDraft) {
  return toEditableListing(await api.request<RawListing>(listingPath(professionalId, listingId, "/details"), { method: "PUT", auth: true, body: listingPayload(draft) }));
}

export type PhotoUpload = { fileName: string; contentType: string; dataBase64: string };

export async function uploadListingPhoto(api: ApiClient, professionalId: string, listingId: string, photo: PhotoUpload) {
  // Only the upload fields: the endpoint's schema is strict. Uploads are larger than other calls,
  // so they get longer on slow mobile networks.
  const { fileName, contentType, dataBase64 } = photo;
  return api.request<unknown>(listingPath(professionalId, listingId, "/media"), { method: "POST", auth: true, body: { fileName, contentType, dataBase64, mediaType: "PHOTO" }, timeoutMs: 90_000 });
}

export async function removeListingPhoto(api: ApiClient, professionalId: string, listingId: string, mediaId: string) {
  return api.request<unknown>(listingPath(professionalId, listingId, `/media/${encodeURIComponent(mediaId)}`), { method: "DELETE", auth: true });
}

export async function setListingCover(api: ApiClient, professionalId: string, listingId: string, mediaId: string) {
  return api.request<unknown>(listingPath(professionalId, listingId, `/media/${encodeURIComponent(mediaId)}/cover`), { method: "POST", auth: true });
}

export type ListingEvidence = { type: "owner_mandate" | "listing_authority" | "developer_authority" | "ownership_reference"; reference: string };

/** Sends the listing to NesAfric review (it is never published directly from the app). */
export async function submitProListing(api: ApiClient, professionalId: string, listingId: string, evidence?: ListingEvidence) {
  return api.request<unknown>(listingPath(professionalId, listingId, "/submit"), { method: "POST", auth: true, body: evidence ? { evidence } : {} });
}

// ---------------------------------------------------------------------------------------------
// Property management (`x-organisation-id`)
// ---------------------------------------------------------------------------------------------

export type PmUnit = { id: string; name: string; unitType: string | null; floor: string | null; bedrooms: number | null; bathrooms: number | null; status: string };
export type PmPropertyDetail = { id: string; name: string; referenceNumber: string; category: string; status: string; city: string | null; addressLine1: string | null; description: string | null; units: PmUnit[] };

type RawUnit = { id: string; name: string; unitType?: string | null; floor?: string | null; bedrooms?: number | null; bathrooms?: number | null; status: string; archivedAt?: string | null };
type RawPropertyDetail = { id: string; name: string; referenceNumber: string; category: string; status: string; city?: string | null; addressLine1?: string | null; description?: string | null; units?: RawUnit[]; buildings?: { units?: RawUnit[] }[] };

const toUnit = (unit: RawUnit): PmUnit => ({ id: unit.id, name: unit.name, unitType: unit.unitType ?? null, floor: unit.floor ?? null, bedrooms: unit.bedrooms ?? null, bathrooms: unit.bathrooms ?? null, status: unit.status });

export async function getPmProperty(api: ApiClient, organisationId: string, propertyId: string, signal?: AbortSignal): Promise<PmPropertyDetail> {
  const raw = await api.request<RawPropertyDetail>("/api/properties", { auth: true, organisationId, query: { id: propertyId }, signal });
  const units = new Map<string, PmUnit>();
  for (const unit of [...(raw.units ?? []), ...(raw.buildings ?? []).flatMap((building) => building.units ?? [])]) {
    if (!unit.archivedAt) units.set(unit.id, toUnit(unit));
  }
  return { id: raw.id, name: raw.name, referenceNumber: raw.referenceNumber, category: raw.category, status: raw.status, city: raw.city ?? null, addressLine1: raw.addressLine1 ?? null, description: raw.description ?? null, units: [...units.values()] };
}

export type PropertyInput = { name: string; referenceNumber: string; category: string; city: string; addressLine1: string };

export async function createPmProperty(api: ApiClient, organisationId: string, input: PropertyInput) {
  return api.request<{ id: string }>("/api/properties", {
    method: "POST",
    auth: true,
    organisationId,
    body: { name: input.name.trim(), referenceNumber: input.referenceNumber.trim(), category: input.category, countryCode: "GH", currencyCode: "GHS", city: trimmed(input.city) ?? undefined, addressLine1: trimmed(input.addressLine1) ?? undefined },
  });
}

/** Reference number, country and currency are fixed once a property exists. */
export async function updatePmProperty(api: ApiClient, organisationId: string, propertyId: string, input: Omit<PropertyInput, "referenceNumber">) {
  return api.request<{ id: string }>("/api/properties", {
    method: "PATCH",
    auth: true,
    organisationId,
    query: { id: propertyId },
    body: { name: input.name.trim(), category: input.category, city: trimmed(input.city), addressLine1: trimmed(input.addressLine1) },
  });
}

export type UnitInput = { name: string; unitType: string; floor: string; bedrooms: string; bathrooms: string; status: string };

/** Blank optional fields are omitted on create and cleared (null) on edit. */
function unitBody(input: UnitInput, blank: undefined | null) {
  const whole = (value: string) => (value.trim() === "" ? blank : Number(value));
  return { name: input.name.trim(), unitType: trimmed(input.unitType) ?? blank, floor: trimmed(input.floor) ?? blank, bedrooms: whole(input.bedrooms), bathrooms: whole(input.bathrooms), status: input.status };
}

export async function createPmUnit(api: ApiClient, organisationId: string, propertyId: string, input: UnitInput) {
  return api.request<{ id: string }>(`/api/properties/${encodeURIComponent(propertyId)}/units`, { method: "POST", auth: true, organisationId, body: unitBody(input, undefined) });
}

export async function updatePmUnit(api: ApiClient, organisationId: string, propertyId: string, unitId: string, input: UnitInput) {
  return api.request<{ id: string }>(`/api/properties/${encodeURIComponent(propertyId)}/units/${encodeURIComponent(unitId)}`, { method: "PATCH", auth: true, organisationId, body: unitBody(input, null) });
}

export type PmTenantDetail = {
  id: string;
  legalName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  tenancies: { leaseId: string; referenceNumber: string; status: string; property: string; unit: string | null }[];
};

type RawTenantDetail = {
  id: string;
  email?: string | null;
  phone?: string | null;
  tenant: { legalName: string; preferredName?: string | null };
  leaseParties?: { lease: { id: string; referenceNumber: string; status: string; property?: { name: string } | null; unit?: { name: string } | null } }[];
};

/** Tenant detail for the manage screen. Internal notes and address are not kept in the app. */
export async function getPmTenant(api: ApiClient, organisationId: string, tenantId: string, signal?: AbortSignal): Promise<PmTenantDetail> {
  const raw = await api.request<RawTenantDetail>(`/api/tenants/${encodeURIComponent(tenantId)}`, { auth: true, organisationId, signal });
  return {
    id: raw.id,
    legalName: raw.tenant.legalName,
    preferredName: raw.tenant.preferredName ?? null,
    email: raw.email ?? null,
    phone: raw.phone ?? null,
    tenancies: (raw.leaseParties ?? []).map(({ lease }) => ({ leaseId: lease.id, referenceNumber: lease.referenceNumber, status: lease.status, property: lease.property?.name ?? "", unit: lease.unit?.name ?? null })),
  };
}

export type TenantInput = { legalName: string; preferredName: string; email: string; phone: string };

function tenantBody(input: TenantInput) {
  return { legalName: input.legalName.trim(), preferredName: trimmed(input.preferredName) ?? undefined, email: trimmed(input.email) ?? undefined, phone: trimmed(input.phone) ?? undefined };
}

export async function createPmTenant(api: ApiClient, organisationId: string, input: TenantInput) {
  return api.request<{ relationship: { id: string } }>("/api/tenants", { method: "POST", auth: true, organisationId, body: tenantBody(input) });
}

export async function updatePmTenant(api: ApiClient, organisationId: string, tenantId: string, input: TenantInput) {
  return api.request<{ id: string }>(`/api/tenants/${encodeURIComponent(tenantId)}`, { method: "PATCH", auth: true, organisationId, body: tenantBody(input) });
}

export async function createPmTenantAccessInvitation(
  api: ApiClient,
  organisationId: string,
  tenantId: string,
  leaseId?: string,
) {
  return api.request<{
    invitation: {
      id: string;
      createdAt: string;
      expiresAt: string;
      status: string;
    };
    delivery: {
      email: "QUEUED" | "SKIPPED" | "FAILED";
      sms: "SENT" | "SKIPPED" | "FAILED";
    };
  }>(
    `/api/tenants/${encodeURIComponent(tenantId)}/access-invitations`,
    {
      method: "POST",
      auth: true,
      organisationId,
      ...(leaseId ? { body: { leaseId } } : {}),
    },
  );
}

export type TenancyInput = { propertyId: string; unitId: string | null; referenceNumber: string; startDate: string; endDate: string; rent: string; rentFrequency: "MONTHLY" | "QUARTERLY" | "ANNUAL" };

/**
 * Places a tenant in a property (and unit) by creating a DRAFT lease — the existing association
 * between tenants and property. The server checks the property, unit and tenant all belong to this
 * organisation; the lease stays a draft until it is executed on the website.
 */
export async function createDraftTenancy(api: ApiClient, organisationId: string, tenantId: string, input: TenancyInput) {
  return api.request<{ id: string }>("/api/leases", {
    method: "POST",
    auth: true,
    organisationId,
    body: {
      referenceNumber: input.referenceNumber.trim(),
      propertyId: input.propertyId,
      ...(input.unitId ? { unitId: input.unitId } : {}),
      tenantOrganisationIds: [tenantId],
      startDate: input.startDate,
      ...(input.endDate.trim() ? { endDate: input.endDate.trim() } : {}),
      rentAmountMinor: toMinorUnits(input.rent) ?? "",
      currencyCode: "GHS",
      rentFrequency: input.rentFrequency,
      status: "DRAFT",
    },
  });
}
