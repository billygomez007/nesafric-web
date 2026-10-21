import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { absoluteUrl } from "@/platform/brand";
import { PERMISSIONS } from "@/platform/authorization/permissions";
import { membershipHasPermission } from "@/platform/authorization/policy";
import { MAX_LISTING_PHOTOS } from "@/lib/listing-media-rules";
import { amenityKey, COMMERCIAL_PROPERTY_TYPES, LISTING_AMENITIES, LISTING_PROPERTY_TYPES, RESIDENTIAL_PROPERTY_TYPES } from "@/lib/listing-options";
import { PRICE_UNIT_LABELS, priceUnitsFor } from "@/lib/price-units";
import { LISTING_AUTHORITY_EVIDENCE_TYPES } from "@/modules/listings/schemas";
import {
  createListing, createMarketplaceNativeListing, removeMarketplaceListingMedia, removeOrganisationListingMedia, setMarketplaceListingCoverMedia,
  setOrganisationListingCover, submitMarketplaceListingForReview, submitOrganisationListingForReview, updateListing, updateMarketplaceNativeListing,
} from "@/modules/listings/service";
import { assertMarketplaceOperational, assertWritableMarketplaceProfessional } from "@/modules/marketplace-professionals/entitlements";
import { MARKETPLACE_ENTITLEMENTS } from "@/modules/marketplace-professionals/catalog";
import { claimFlowDraftForSubmission, finishFlowDraft, getFlowDraft, startFlowDraft, type FlowDraft } from "./drafts";
import { advanceGuided, promptFor, type GuidedFlow, type Step } from "./guided";
import { amountMinor, buttons, command, formatMinor, isSkip, numbered, paragraph, pickNumbers, region, regionPrompt, text, type FlowInput, type FlowResult } from "./common";
import { addListingPhoto, type MediaDownloader } from "./media";
import { polishDescription } from "./polish";

/** Types listed over WhatsApp. Hotels and short stays (nightly prices, guests, house rules) use the website. */
const WHATSAPP_TYPES = LISTING_PROPERTY_TYPES.filter(([value]) => value !== "HOTEL" && value !== "SHORT_STAY");
const isResidential = (category?: string) => (RESIDENTIAL_PROPERTY_TYPES as readonly string[]).includes(category ?? "");
const isCommercial = (category?: string) => (COMMERCIAL_PROPERTY_TYPES as readonly string[]).includes(category ?? "");
const AUTHORITIES = [
  { value: "OWNER_SELF", label: "I own the property" },
  { value: "MANAGING_AGENT", label: "I am the owner's managing agent" },
  { value: "BROKERAGE_AUTHORIZED", label: "Our brokerage is authorised to market it" },
  { value: "PROPERTY_MANAGER", label: "We manage the property" },
  { value: "DEVELOPER", label: "We are the developer" },
  { value: "THIRD_PARTY_AUTHORIZED", label: "Another party authorised us in writing" },
] as const;
const EVIDENCE_LABELS: Record<(typeof LISTING_AUTHORITY_EVIDENCE_TYPES)[number], string> = {
  owner_mandate: "Owner's mandate or agreement",
  listing_authority: "Letter of authority to list",
  developer_authority: "Developer's authorisation",
  ownership_reference: "Ownership document reference",
};
const FURNISHING = [["FURNISHED", "Furnished"], ["SEMI_FURNISHED", "Semi-furnished"], ["UNFURNISHED", "Unfurnished"]] as const;

const dataSchema = z.object({
  businesses: z.array(z.object({ kind: z.enum(["PRO", "ORG"]), id: z.string().uuid(), organisationId: z.string().uuid(), name: z.string().max(200) })).max(9).default([]),
  business: z.number().int().min(0).max(8).optional(),
  properties: z.array(z.object({ id: z.string().uuid(), name: z.string().max(200), units: z.array(z.object({ id: z.string().uuid(), name: z.string().max(120) })).max(9) })).max(9).default([]),
  propertyId: z.string().uuid().optional(),
  unitId: z.string().uuid().nullable().optional(),
  propertyName: z.string().max(240).optional(),
  purpose: z.enum(["RENT", "SALE"]).optional(),
  category: z.string().max(40).optional(),
  title: z.string().max(200).optional(),
  region: z.string().max(100).optional(),
  city: z.string().max(150).optional(),
  locality: z.string().max(150).nullable().optional(),
  priceMinor: z.string().regex(/^\d{1,16}$/).optional(),
  priceUnit: z.string().max(20).nullable().optional(),
  bedrooms: z.number().int().min(0).max(100).nullable().optional(),
  bathrooms: z.number().min(0).max(100).nullable().optional(),
  furnishing: z.enum(["FURNISHED", "SEMI_FURNISHED", "UNFURNISHED"]).nullable().optional(),
  sizeSqm: z.number().positive().max(100_000_000).nullable().optional(),
  landSizeSqm: z.number().positive().max(1_000_000_000).nullable().optional(),
  amenities: z.array(z.string().max(60)).max(30).default([]),
  description: z.string().max(10_000).optional(),
  polishCandidate: z.string().max(1200).nullable().optional(),
  authority: z.enum(["OWNER_SELF", "PROPERTY_MANAGER", "MANAGING_AGENT", "BROKERAGE_AUTHORIZED", "DEVELOPER", "THIRD_PARTY_AUTHORIZED"]).optional(),
  evidenceType: z.enum(LISTING_AUTHORITY_EVIDENCE_TYPES).optional(),
  evidenceReference: z.string().max(1000).optional(),
  listingId: z.string().uuid().optional(),
  /** Hash of the fields last written to the listing, and the listing revision after that write. */
  syncedHash: z.string().max(64).optional(),
  syncedRevision: z.number().int().optional(),
  /** The listing revision the person reviewed; submission requires it to be current. */
  reviewedRevision: z.number().int().optional(),
  _photosDone: z.boolean().optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
type Data = z.infer<typeof dataSchema>;

const selected = (data: Data) => data.businesses[data.business ?? 0];
const isPro = (data: Data) => selected(data)?.kind === "PRO";
const priceUnits = (data: Data) => priceUnitsFor(data.purpose ?? "RENT", data.category).filter((unit) => unit !== "CUSTOM" && unit !== "PER_KM");
const categoryLabel = (value?: string) => LISTING_PROPERTY_TYPES.find(([key]) => key === value)?.[1] ?? value ?? "-";
const editLink = (data: Data) => !data.listingId ? null : isPro(data) ? absoluteUrl(`/pro/${selected(data).id}/listings/${data.listingId}/edit`) : absoluteUrl(`/listings/${data.listingId}/edit`);
const number = (body: string, max: number, decimals = false) => { const value = command(body).replace(/(sqm|m2|m²|square metres?|bedrooms?|bathrooms?|beds?|baths?)$/, "").trim(); return (decimals ? /^\d{1,9}(\.\d)?$/ : /^\d{1,9}$/).test(value) && Number(value) <= max ? Number(value) : null; };

const steps: Step<Data>[] = [
  {
    id: "business", label: "Business", editable: false, when: (data) => data.businesses.length > 1,
    prompt: (data) => ({ text: `Which business is this listing for? Reply with its number:\n${numbered(data.businesses.map((business) => `${business.name}${business.kind === "ORG" ? " (your properties)" : ""}`))}` }),
    answer: (body, data) => { const pick = pickNumbers(body, data.businesses.length, 1); return pick ? { data: { ...data, business: pick[0], properties: [] } } : { error: "Please reply with one of the numbers." }; },
    summary: (data) => `Listed by: ${selected(data)?.name ?? "-"}`,
  },
  {
    id: "property", label: "Property", editable: false, when: (data) => !isPro(data),
    prompt: async (data) => { const properties = data.properties.length ? data.properties : await organisationProperties(selected(data).organisationId); return { text: properties.length ? `Which of your properties is this listing for? Reply with its number:\n${numbered(properties.flatMap((property) => property.units.length ? property.units.map((unit) => `${property.name}, ${unit.name}`) : [property.name]))}` : "This business has no properties yet. Add them first (reply register), or list on the website." }; },
    answer: async (body, data) => {
      const properties = data.properties.length ? data.properties : await organisationProperties(selected(data).organisationId);
      const options: Array<{ propertyId: string; unitId: string | null; name: string }> = properties.flatMap((property) => property.units.length ? property.units.map((unit) => ({ propertyId: property.id, unitId: unit.id as string | null, name: `${property.name}, ${unit.name}` })) : [{ propertyId: property.id, unitId: null as string | null, name: property.name }]);
      const pick = pickNumbers(body, options.length, 1);
      return pick ? { data: { ...data, properties, propertyId: options[pick[0]].propertyId, unitId: options[pick[0]].unitId, propertyName: options[pick[0]].name } } : { error: "Please reply with one of the numbers." };
    },
    summary: (data) => data.propertyName ? `Property: ${data.propertyName}` : null,
  },
  {
    id: "purpose", label: "For sale or rent",
    prompt: () => ({ text: "Is it for rent or for sale? Reply 1 for rent or 2 for sale.", interactive: buttons("Is it for rent or for sale?", [{ id: "1", title: "For rent" }, { id: "2", title: "For sale" }]) }),
    answer: (body, data) => { const said = command(body); const purpose = ["1", "rent", "for rent"].includes(said) ? "RENT" : ["2", "sale", "for sale", "sell"].includes(said) ? "SALE" : null; return purpose ? { data: { ...data, purpose, priceUnit: undefined } } : { error: "Please reply 1 for rent or 2 for sale." }; },
    summary: (data) => `For: ${data.purpose === "SALE" ? "sale" : "rent"}`,
  },
  {
    id: "category", label: "Property type",
    prompt: () => ({ text: `What type of property is it? Reply with a number:\n${numbered(WHATSAPP_TYPES.map(([, label]) => label))}\n(Hotels and short stays are listed on the website.)` }),
    answer: (body, data) => { const pick = pickNumbers(body, WHATSAPP_TYPES.length, 1); return pick ? { data: { ...data, category: WHATSAPP_TYPES[pick[0]][0], priceUnit: undefined } } : { error: "Please reply with one of the numbers." }; },
    summary: (data) => `Type: ${categoryLabel(data.category)}`,
  },
  {
    id: "title", label: "Title",
    prompt: () => ({ text: "Give the listing a short title, for example: 3-bedroom apartment in East Legon." }),
    answer: (body, data) => { const value = text(body, 3, 120); return value ? { data: { ...data, title: value } } : { error: "Please send a title of 3 to 120 characters." }; },
    summary: (data) => `Title: ${data.title ?? "-"}`,
  },
  {
    id: "region", label: "Region",
    prompt: () => ({ text: regionPrompt("is the property in") }),
    answer: (body, data) => { const value = region(body); return value ? { data: { ...data, region: value } } : { error: "Please reply with a region number or name." }; },
    summary: (data) => `Location: ${[data.locality, data.city, data.region].filter(Boolean).join(", ")}`,
  },
  {
    id: "city", label: "Town or district",
    prompt: (data) => ({ text: `Which town or district in ${data.region}? For example: Accra, Tema, Kumasi.` }),
    answer: (body, data) => { const value = text(body, 2, 150); return value ? { data: { ...data, city: value } } : { error: "Please send the town or district." }; },
    summary: () => null,
  },
  {
    id: "locality", label: "Neighbourhood",
    prompt: () => ({ text: "Which neighbourhood? For example: East Legon. Reply skip to leave it out. Don't send the exact address; it isn't shown publicly." }),
    answer: (body, data) => { if (isSkip(body)) return { data: { ...data, locality: null } }; const value = text(body, 2, 150); return value ? { data: { ...data, locality: value } } : { error: "Please send the neighbourhood, or skip." }; },
    summary: () => null,
  },
  {
    id: "price", label: "Price",
    prompt: (data) => ({ text: data.purpose === "SALE" ? "What is the asking price in GHS? For example: 850000 or 1.2m." : "What is the rent in GHS? For example: 4500." }),
    answer: (body, data) => { const value = amountMinor(body); return value ? { data: { ...data, priceMinor: value } } : { error: "Please send the amount as a number, for example 4500." }; },
    summary: (data) => data.priceMinor ? `Price: ${formatMinor(data.priceMinor)}${data.priceUnit ? ` ${PRICE_UNIT_LABELS[data.priceUnit as keyof typeof PRICE_UNIT_LABELS]?.toLowerCase() ?? ""}` : ""}` : null,
  },
  {
    id: "price_unit", label: "Rent period or price unit", when: (data) => data.purpose === "RENT" || data.category === "LAND",
    prompt: (data) => { const units = priceUnits(data); return { text: data.purpose === "RENT" ? `Is that rent ${units.map((unit, index) => `${index + 1} ${PRICE_UNIT_LABELS[unit].toLowerCase()}`).join(", ")}? Reply with the number.` : "Is that the total price (reply 1) or a price per square metre (reply 2)?" }; },
    answer: (body, data) => {
      if (data.purpose === "SALE") { const said = command(body); return said === "1" ? { data: { ...data, priceUnit: null } } : said === "2" ? { data: { ...data, priceUnit: "PER_SQM" } } : { error: "Please reply 1 or 2." }; }
      const units = priceUnits(data);
      const pick = pickNumbers(body, units.length, 1);
      return pick ? { data: { ...data, priceUnit: units[pick[0]] } } : { error: "Please reply with one of the numbers." };
    },
    summary: () => null,
  },
  {
    id: "bedrooms", label: "Bedrooms", when: (data) => isResidential(data.category),
    prompt: () => ({ text: "How many bedrooms? Reply 0 for a studio." }),
    answer: (body, data) => { const value = number(body, 50); return value !== null ? { data: { ...data, bedrooms: value } } : { error: "Please send a whole number, for example 3." }; },
    summary: (data) => isResidential(data.category) ? `Bedrooms: ${data.bedrooms ?? "-"}, bathrooms: ${data.bathrooms ?? "-"}` : null,
  },
  {
    id: "bathrooms", label: "Bathrooms", when: (data) => isResidential(data.category),
    prompt: () => ({ text: "How many bathrooms? For example 2, or 2.5." }),
    answer: (body, data) => { const value = number(body, 50, true); return value !== null && (value * 2) % 1 === 0 ? { data: { ...data, bathrooms: value } } : { error: "Please send a number like 2 or 2.5." }; },
    summary: () => null,
  },
  {
    id: "furnishing", label: "Furnishing", when: (data) => isResidential(data.category),
    prompt: () => ({ text: `Is it ${FURNISHING.map(([, label], index) => `${index + 1} ${label.toLowerCase()}`).join(", ")}? Reply with the number, or skip.` }),
    answer: (body, data) => { if (isSkip(body)) return { data: { ...data, furnishing: null } }; const pick = pickNumbers(body, FURNISHING.length, 1); return pick ? { data: { ...data, furnishing: FURNISHING[pick[0]][0] } } : { error: "Please reply 1, 2 or 3, or skip." }; },
    summary: (data) => data.furnishing ? `Furnishing: ${FURNISHING.find(([key]) => key === data.furnishing)?.[1]}` : null,
  },
  {
    id: "size", label: "Floor area", when: (data) => isCommercial(data.category),
    prompt: () => ({ text: "What is the floor area in square metres? For example: 120. Reply skip if you don't know." }),
    answer: (body, data) => { if (isSkip(body)) return { data: { ...data, sizeSqm: null } }; const value = number(body, 100_000_000, true); return value ? { data: { ...data, sizeSqm: value } } : { error: "Please send the area in square metres, or skip." }; },
    summary: (data) => data.sizeSqm ? `Floor area: ${data.sizeSqm} m²` : null,
  },
  {
    id: "land_size", label: "Land size", when: (data) => data.category === "LAND",
    prompt: () => ({ text: "What is the land size in square metres? For example: 600 (a standard plot is about 600 m²)." }),
    answer: (body, data) => { const value = number(body, 1_000_000_000, true); return value ? { data: { ...data, landSizeSqm: value } } : { error: "Please send the size in square metres." }; },
    summary: (data) => data.landSizeSqm ? `Land size: ${data.landSizeSqm} m²` : null,
  },
  {
    id: "amenities", label: "Amenities", when: (data) => data.category !== "LAND",
    prompt: () => ({ text: `Which amenities does it have? Reply with numbers separated by commas, or skip:\n${numbered([...LISTING_AMENITIES])}` }),
    answer: (body, data) => { if (isSkip(body)) return { data: { ...data, amenities: [] } }; const picks = pickNumbers(body, LISTING_AMENITIES.length, LISTING_AMENITIES.length); return picks ? { data: { ...data, amenities: picks.map((pick) => LISTING_AMENITIES[pick]) } } : { error: "Please reply with numbers from the list, or skip." }; },
    summary: (data) => data.amenities.length ? `Amenities: ${data.amenities.join(", ")}` : null,
  },
  {
    id: "description", label: "Description",
    prompt: (data) => ({ text: data.polishCandidate
      ? `Here is a clearer version of your description:\n\n${data.polishCandidate}\n\nReply use to use it, or keep to keep your own.`
      : data.description ? `Your description is saved. Reply polish to get a tidier version, next to continue, or send a new description.` : "Describe the property in a few sentences: layout, condition, what's nearby. At least 20 characters." }),
    answer: async (body, data) => {
      const said = command(body);
      if (data.polishCandidate && said === "use") return { data: { ...data, description: data.polishCandidate, polishCandidate: null } };
      if (data.polishCandidate && said === "keep") return { data: { ...data, polishCandidate: null } };
      if (said === "next" && data.description) return { data };
      if (said === "polish") {
        if (!data.description) return { error: "Send your description first, then reply polish." };
        const polished = await polishDescription({ description: data.description, title: data.title ?? "", location: [data.locality, data.city, data.region].filter(Boolean).join(", ") });
        return polished ? { data: { ...data, polishCandidate: polished }, stay: "Here's a suggestion. Nothing changes unless you reply use." } : { error: "I couldn't polish it right now. Reply next to keep yours." };
      }
      const value = paragraph(body, 20, 4000);
      return value ? { data: { ...data, description: value, polishCandidate: null }, stay: "Description saved. Reply polish for a tidier version, or next to continue." } : { error: "Please send at least 20 characters." };
    },
    summary: (data) => data.description ? `Description: ${data.description.slice(0, 160)}${data.description.length > 160 ? "…" : ""}` : null,
  },
  {
    id: "authority", label: "Your authority to list",
    prompt: () => ({ text: `How are you authorised to market this property? Reply with a number:\n${numbered(AUTHORITIES.map((item) => item.label))}` }),
    answer: (body, data) => { const pick = pickNumbers(body, AUTHORITIES.length, 1); return pick ? { data: { ...data, authority: AUTHORITIES[pick[0]].value } } : { error: "Please reply with one of the numbers." }; },
    summary: (data) => data.authority ? `Authority: ${AUTHORITIES.find((item) => item.value === data.authority)?.label}` : null,
  },
  {
    id: "evidence_type", label: "Authority document",
    prompt: () => ({ text: `Which document shows your authority? Reply with a number:\n${numbered(LISTING_AUTHORITY_EVIDENCE_TYPES.map((type) => EVIDENCE_LABELS[type]))}` }),
    answer: (body, data) => { const pick = pickNumbers(body, LISTING_AUTHORITY_EVIDENCE_TYPES.length, 1); return pick ? { data: { ...data, evidenceType: LISTING_AUTHORITY_EVIDENCE_TYPES[pick[0]] } } : { error: "Please reply with one of the numbers." }; },
    summary: (data) => data.evidenceType ? `Document: ${EVIDENCE_LABELS[data.evidenceType]}` : null,
  },
  {
    id: "evidence_reference", label: "Document reference",
    prompt: () => ({ text: "Send a reference NesAfric can check for that document, for example its number or date and who signed it. Don't send the document itself here." }),
    answer: (body, data) => { const value = text(body, 3, 500); return value ? { data: { ...data, evidenceReference: value } } : { error: "Please send a reference of 3 to 500 characters." }; },
    summary: (data) => data.evidenceReference ? `Reference: ${data.evidenceReference}` : null,
  },
];

const listingFields = (data: Data) => ({
  listingType: data.purpose!, category: data.category!, title: data.title!, publicDescription: data.description!,
  ...(data.purpose === "SALE" ? { askingAmountMinor: data.priceMinor!, rentAmountMinor: null } : { rentAmountMinor: data.priceMinor!, askingAmountMinor: null }),
  frequency: (data.priceUnit ?? null) as never, currencyCode: "GHS", countryCode: "GH", availableFrom: new Date().toISOString().slice(0, 10),
  bedrooms: data.bedrooms ?? null, bathrooms: data.bathrooms ?? null, sizeSqm: data.sizeSqm ?? null, landSizeSqm: data.landSizeSqm ?? null, furnishing: data.furnishing ?? null,
  region: data.region!, city: data.city!, locality: data.locality ?? null,
  amenities: data.amenities.map((label) => ({ key: amenityKey(label), label })),
  listingAuthority: data.authority ?? null,
});
const fieldsHash = (data: Data) => createHash("sha256").update(JSON.stringify({ ...listingFields(data), availableFrom: null, authority: data.authority ?? null })).digest("hex");

function nativeInput(data: Data) {
  // The professional's authority is set on the listing by `listingAuthority` below.
  const { listingAuthority: _authority, ...fields } = listingFields(data);
  return {
    asset: {
      name: data.title!, category: data.category!, purpose: data.purpose!, bedrooms: fields.bedrooms, bathrooms: fields.bathrooms, sizeSqm: fields.sizeSqm,
      currencyCode: "GHS", priceMinor: data.priceMinor!, countryCode: "GH", region: data.region!, city: data.city!, locality: data.locality ?? null,
      amenities: data.amenities, availableFrom: fields.availableFrom,
    },
    listing: fields,
    listingAuthority: data.authority!,
  };
}

/** Creates the canonical DRAFT listing (or writes the draft's answers to it) before photos. */
async function syncListing(data: Data, input: FlowInput): Promise<{ data: Data } | { error: string }> {
  const business = selected(data);
  const hash = fieldsHash(data);
  try {
    if (!data.listingId) {
      const listing = business.kind === "PRO"
        ? await createMarketplaceNativeListing(input.userId, business.id, nativeInput(data)) as { id: string }
        : await createListing(input.userId, business.organisationId, { ...listingFields(data), propertyId: data.propertyId, unitId: data.unitId ?? null, media: [] }) as { id: string };
      return { data: { ...data, listingId: listing.id, syncedHash: hash, syncedRevision: await currentRevision(listing.id) } };
    }
    const current = await db.listing.findUnique({ where: { id: data.listingId }, select: { revision: true, status: true } });
    if (!current) return { error: "This listing no longer exists. Reply cancel to discard the draft." };
    // A change made elsewhere (for example on the website) since the last write here is never
    // overwritten, and never reviewed unseen: the person reloads it first.
    if (current.revision !== data.syncedRevision) return { error: changedElsewhere(data) };
    if (data.syncedHash === hash) return { data };
    if (business.kind === "PRO") await updateMarketplaceNativeListing(input.userId, business.id, data.listingId, nativeInput(data));
    else await updateListing(input.userId, business.organisationId, data.listingId, listingFields(data));
    // Read back: child rows (amenities) bump the revision again after the update returns.
    return { data: { ...data, syncedHash: hash, syncedRevision: await currentRevision(data.listingId) } };
  } catch (error) {
    if (error instanceof AppError && error.status < 500) return { error: `${error.message} Change the answer (reply edit) or continue on the website.` };
    throw error;
  }
}

const currentRevision = async (listingId: string) => (await db.listing.findUniqueOrThrow({ where: { id: listingId }, select: { revision: true } })).revision;

const changedElsewhere = (data: Data) => `This listing was changed somewhere else (for example on the website) after your last answer here, so I didn't overwrite it. Reply reload to load the latest version here${editLink(data) ? `, or continue on the website: ${editLink(data)}` : "."}`;

/** Loads the listing's current details into the draft (after a change made elsewhere). */
async function reload(data: Data): Promise<Data> {
  const listing = await db.listing.findUniqueOrThrow({ where: { id: data.listingId! }, include: { amenities: true } });
  const next: Data = {
    ...data,
    purpose: listing.listingType, category: listing.category, title: listing.title, description: listing.publicDescription,
    priceMinor: String(listing.listingType === "SALE" ? listing.askingAmountMinor ?? 0 : listing.rentAmountMinor ?? 0), priceUnit: listing.frequency,
    bedrooms: listing.bedrooms, bathrooms: listing.bathrooms === null ? null : Number(listing.bathrooms), sizeSqm: listing.sizeSqm === null ? null : Number(listing.sizeSqm),
    landSizeSqm: listing.landSizeSqm === null ? null : Number(listing.landSizeSqm), furnishing: listing.furnishing as Data["furnishing"],
    region: listing.region ?? data.region, city: listing.city ?? data.city, locality: listing.locality,
    amenities: listing.amenities.map((amenity) => amenity.label).slice(0, 30),
  };
  return { ...next, syncedHash: fieldsHash(next), syncedRevision: listing.revision };
}

async function photoList(listingId: string) {
  return db.listingMedia.findMany({ where: { listingId, type: "PHOTO" }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, isCover: true } });
}

function photosStep(download?: MediaDownloader): Step<Data> {
  return {
    id: "photos", label: "Photos", editable: true,
    enter: (data, _draft, input) => syncListing(data, input),
    prompt: async (data) => {
      const count = data.listingId ? (await photoList(data.listingId)).length : 0;
      return { text: count
        ? `${count} of ${MAX_LISTING_PHOTOS} photos added. Send more, or reply done. You can also reply photos to see them, remove 2 to delete photo 2, or cover 3 to make photo 3 the cover.`
        : `Now send photos of the property, one at a time or several together: up to ${MAX_LISTING_PHOTOS}, JPEG, PNG or WebP, at least 200 × 200 pixels. The first photo is the cover unless you choose another. Reply done when finished.` };
    },
    media: async (mediaId, data, input) => {
      const business = selected(data);
      const outcome = await addListingPhoto({ userId: input.userId, listingId: data.listingId!, mediaId, marketplaceProfessionalId: business.kind === "PRO" ? business.id : null, organisationId: business.organisationId }, download);
      const revision = (await db.listing.findUniqueOrThrow({ where: { id: data.listingId! }, select: { revision: true } })).revision;
      const next = { ...data, syncedRevision: revision, _photosDone: false };
      if (outcome.status === "added") return { data: next, reply: `Photo ${outcome.count} of ${MAX_LISTING_PHOTOS} added.${outcome.count >= MAX_LISTING_PHOTOS ? " That's the maximum. Reply done, or remove one to add another." : ""}` };
      if (outcome.status === "duplicate") return { data: next, reply: `That photo is already added (${outcome.count} of ${MAX_LISTING_PHOTOS}).` };
      if (outcome.status === "limit") return { data: next, reply: `This listing already has ${MAX_LISTING_PHOTOS} photos, so that one wasn't added. Reply photos to see them, then remove 2 (for example) to make room.` };
      return { data: next, reply: `That photo wasn't added: ${"message" in outcome ? outcome.message : ""} You can send it again.` };
    },
    answer: async (body, data, input) => {
      const said = command(body);
      const business = selected(data);
      const photos = await photoList(data.listingId!);
      const refresh = async () => ({ ...data, syncedRevision: (await db.listing.findUniqueOrThrow({ where: { id: data.listingId! }, select: { revision: true } })).revision });
      if (/^(done|next|finished|continue)$/.test(said)) return photos.length ? { data: { ...data, _photosDone: true } } : { error: "Add at least one photo first: send it here as a photo." };
      if (/^(photos|review photos|show photos)$/.test(said)) return { data, stay: photos.length ? `Photos: ${photos.map((photo, index) => `${index + 1}${photo.isCover ? " (cover)" : ""}`).join(", ")}. Open the website to see them: ${editLink(data)}` : "No photos yet." };
      const remove = said.match(/^(?:remove|delete) (\d{1,2})$/);
      const cover = said.match(/^(?:cover|make cover|choose cover) (\d{1,2})$/);
      if (remove || cover) {
        const photo = photos[Number((remove ?? cover)![1]) - 1];
        if (!photo) return { error: `There is no photo ${(remove ?? cover)![1]}. Reply photos to see the numbers.` };
        try {
          if (remove) await (business.kind === "PRO" ? removeMarketplaceListingMedia(input.userId, business.id, data.listingId!, photo.id) : removeOrganisationListingMedia(input.userId, business.organisationId, data.listingId!, photo.id));
          else await (business.kind === "PRO" ? setMarketplaceListingCoverMedia(input.userId, business.id, data.listingId!, photo.id) : setOrganisationListingCover(input.userId, business.organisationId, data.listingId!, photo.id));
        } catch (error) {
          if (error instanceof AppError && error.status < 500) return { error: error.message };
          throw error;
        }
        return { data: await refresh(), stay: remove ? `Photo ${remove[1]} removed. ${photos.length - 1} of ${MAX_LISTING_PHOTOS} left.` : `Photo ${cover![1]} is now the cover.` };
      }
      if (said === "reload" && data.listingId) return { data: await reload(data), stay: "Loaded the latest version of the listing." };
      return { error: "Send a photo, or reply done, photos, remove 2 or cover 3." };
    },
    summary: () => null,
  };
}

export function listingFlow(download?: MediaDownloader): GuidedFlow<Data> {
  return {
    what: "property listing",
    steps: [...steps, photosStep(download)],
    read: (raw) => dataSchema.parse(raw),
    reviewNote: async (data) => {
      if (!data.listingId) return null;
      const photos = await photoList(data.listingId);
      return `Photos: ${photos.length} of ${MAX_LISTING_PHOTOS}, cover: photo ${Math.max(1, photos.findIndex((photo) => photo.isCover) + 1)}.\nOn confirm, the listing goes to NesAfric for review; it is not published until NesAfric approves it.`;
    },
    onReview: async (data, _draft, input) => {
      const synced = await syncListing(data, input);
      if ("error" in synced) return synced;
      const revision = (await db.listing.findUniqueOrThrow({ where: { id: synced.data.listingId! }, select: { revision: true } })).revision;
      return { data: { ...synced.data, syncedRevision: revision, reviewedRevision: revision } };
    },
    submit: (draft, input, revision) => submitListing(draft, input, revision),
  };
}

/** Businesses this account may list for: approved-or-pending professionals it is an agent of,
 * and PropertyOS organisations where it holds `listing.create` (landlords and managers). */
export async function listingBusinesses(userId: string) {
  const [members, memberships] = await Promise.all([
    db.marketplaceProfessionalMember.findMany({ where: { userId, status: "ACTIVE", marketplaceProfessional: { archivedAt: null, status: "ACTIVE" } }, select: { marketplaceProfessional: { select: { id: true, displayName: true, backingOrganisationId: true } } } }),
    db.organisationMember.findMany({ where: { userId, status: "ACTIVE", archivedAt: null, organisation: { archivedAt: null, marketplaceProfessional: { is: null } } }, include: { organisation: { select: { id: true, name: true } }, roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } }),
  ]);
  return [
    ...members.map(({ marketplaceProfessional: professional }) => ({ kind: "PRO" as const, id: professional.id, organisationId: professional.backingOrganisationId, name: professional.displayName })),
    ...memberships.filter((membership) => membershipHasPermission(membership.roles, PERMISSIONS.listingCreate)).map((membership) => ({ kind: "ORG" as const, id: membership.organisation.id, organisationId: membership.organisation.id, name: membership.organisation.name })),
  ].slice(0, 9);
}

async function organisationProperties(organisationId: string) {
  const properties = await db.property.findMany({ where: { organisationId, archivedAt: null }, orderBy: { name: "asc" }, take: 9, select: { id: true, name: true, units: { where: { archivedAt: null }, orderBy: { name: "asc" }, take: 9, select: { id: true, name: true } } } });
  return properties.map((property) => ({ id: property.id, name: property.name, units: property.units }));
}

export async function startListing(input: FlowInput): Promise<FlowResult> {
  const businesses = await listingBusinesses(input.userId);
  if (!businesses.length) return { reply: "To list a property, register first: reply register agency, register agent, or register (landlords). Service providers: reply list my services.", exit: true };
  const { draft, created } = await startFlowDraft({ address: input.address, userId: input.userId, kind: "PROPERTY_LISTING", step: businesses.length > 1 ? "business" : businesses[0].kind === "ORG" ? "property" : "purpose", data: { businesses, business: 0, amenities: [], properties: [] }, messageId: input.messageId });
  const prompt = await promptFor(listingFlow(), draft);
  const intro = created ? `Let's create your property listing${businesses.length === 1 ? ` for ${businesses[0].name}` : ""}. I'll ask one question at a time; reply help at any time.` : "Continuing your property listing.";
  return { ...prompt, reply: `${intro}\n\n${prompt.reply}` };
}

export async function continueListing(draft: FlowDraft, input: FlowInput, download?: MediaDownloader) {
  return advanceGuided(listingFlow(download), draft, input);
}

/**
 * Submits the reviewed listing for NesAfric review. Rechecked now, not at the start: membership
 * and role, the professional's approval and suspension, the subscription and listing quota, and
 * that neither the draft nor the listing (details, photos, amenities) changed since the review.
 */
async function submitListing(draft: FlowDraft, input: FlowInput, revision: number): Promise<FlowResult> {
  const data = dataSchema.parse(draft.data);
  if (!await claimFlowDraftForSubmission(draft.id, input.userId, "review", revision, input.messageId)) {
    const latest = await getFlowDraft(draft.id, input.userId);
    if (latest?.status === "SUBMITTED") return { reply: "This listing was already submitted. Reply my listings to see its status.", exit: true };
    if (latest?.status === "OPEN" && latest.step === "review") {
      const prompt = await promptFor(listingFlow(), latest);
      return { ...prompt, reply: `Your listing changed after you reviewed it, so nothing was submitted. Please check it again.\n\n${prompt.reply}` };
    }
    return latest ? promptFor(listingFlow(), latest) : { reply: "This listing draft is no longer open. Reply menu to start again.", exit: true };
  }
  const business = selected(data);
  const back = async (reason: string, step = "review") => {
    await finishFlowDraft(draft.id, { status: "OPEN", step });
    return { reply: reason, draftId: draft.id };
  };
  try {
    if (business.kind === "PRO") {
      const professional = await db.marketplaceProfessional.findUnique({ where: { id: business.id }, select: { status: true, verificationStatus: true, archivedAt: true } });
      if (!professional || professional.archivedAt || professional.status !== "ACTIVE") return back("This business is suspended or closed, so the listing can't be submitted. Your draft is saved.");
      if (professional.verificationStatus !== "VERIFIED") return back(`${business.name} isn't approved by NesAfric yet (${professional.verificationStatus === "PENDING" ? "submitted for review" : professional.verificationStatus.toLowerCase()}). Your listing is saved as a draft and can be submitted once the business is approved. Reply pause to finish later.`);
      await assertWritableMarketplaceProfessional(business.id);
      await assertMarketplaceOperational(business.id, MARKETPLACE_ENTITLEMENTS.activeListingsMax.key, 0);
      await submitMarketplaceListingForReview(input.userId, business.id, data.listingId!, { expectedRevision: data.reviewedRevision, evidence: { type: data.evidenceType!, reference: data.evidenceReference! } });
    } else {
      await submitOrganisationListingForReview(input.userId, business.organisationId, data.listingId!, { expectedRevision: data.reviewedRevision, evidence: { type: data.evidenceType!, reference: data.evidenceReference! } });
    }
  } catch (error) {
    if (error instanceof AppError && error.code === "LISTING_CHANGED_SINCE_REVIEW") return back("The listing changed after you reviewed it (its details or photos were edited here or on the website), so nothing was submitted. Reply done to review the current version.", "photos");
    if (error instanceof AppError && error.status < 500) return back(`${error.message} Your draft is saved; reply edit to change it.`);
    await finishFlowDraft(draft.id, { status: "OPEN", step: "review" });
    throw error;
  }
  await finishFlowDraft(draft.id, { status: "SUBMITTED", step: "submitted" });
  const listing = await db.listing.findUniqueOrThrow({ where: { id: data.listingId! }, select: { status: true } });
  return {
    reply: `Submitted for review. Status: ${listing.status === "PENDING_REVIEW" ? "submitted for review (not yet published)" : listing.status.toLowerCase()}. NesAfric checks the listing before it is published; I'll let you know here if you have WhatsApp updates switched on.\nView it: ${editLink(data)}`,
    exit: true,
  };
}
