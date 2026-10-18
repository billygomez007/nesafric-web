import { uploadMarketplaceListingMedia } from "@/modules/documents/service";
import {
  createMarketplaceNativeListing,
  getMarketplaceProfessionalListing,
  listingReadinessProblems,
  submitMarketplaceListingForReview,
  transitionMarketplaceProfessionalListing,
  updateMarketplaceNativeListing,
} from "@/modules/listings/service";
import { listUserMarketplaceProfessionals } from "@/modules/marketplace-professionals/service";
import { isBookableCategory } from "@/lib/listing-categories";
import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { runOnce } from "../actions";
import { aiPolishListingCopy } from "../ai";
import type { Ctx, StartSeed, Workflow } from "../context";
import { askField, askNextField, beginEdit, editOptions, handleFieldAnswer, SKIP_HINT, summaryLines, type FieldSpec, type FormData } from "../form";
import { moneyText, propertyUrl } from "../format";
import { accountExistsForContact, linkedUser } from "../identity";
import { fetchInboundMedia, uploadFailureMessage } from "../media";
import {
  categoryLabel, detectCommand, isResidentialCategory, parseAreaSqm, parseAvailableFrom, parseDecimal, parseFurnishing,
  parseInteger, parseList, parseListingType, parseLocation, parseMoneyMinor, PROPERTY_CATEGORIES, type ParsedLocation,
} from "../nlu";
import { referenceFor } from "../references";
import { recordEvent, recordEventInTx } from "../store";

const MAX_PHOTOS = 12;

const AUTHORITIES = {
  OWNER_SELF: { title: "I own it", evidence: "ownership_reference", hint: "e.g. *Land title / indenture no. GA-12345*" },
  MANAGING_AGENT: { title: "Owner's agent", evidence: "owner_mandate", hint: "e.g. *Signed mandate from the owner dated 3 Oct 2026*" },
  PROPERTY_MANAGER: { title: "Property manager", evidence: "listing_authority", hint: "e.g. *Management agreement dated 1 Jan 2026*" },
  DEVELOPER: { title: "Developer", evidence: "developer_authority", hint: "e.g. *Building permit no. AMA/123/2025*" },
} as const;

type Authority = keyof typeof AUTHORITIES;

type Draft = FormData & {
  /** "edit": the person asked to change an existing listing rather than create one. */
  mode?: "edit";
  professionalId?: string;
  professionalName?: string;
  listingId?: string;
  listingStatus?: string;
  dirty?: boolean;
  listingType?: "RENT" | "SALE";
  category?: string;
  location?: ParsedLocation;
  bedrooms?: number;
  bathrooms?: number;
  landSizeSqm?: number;
  sizeSqm?: number;
  priceMinor?: string;
  frequency?: string;
  furnishing?: "FURNISHED" | "SEMI_FURNISHED" | "UNFURNISHED";
  amenities?: string[];
  availableFrom?: string;
  notes?: string;
  title?: string;
  description?: string;
  authority?: Authority;
  evidenceReference?: string;
  photos?: number;
};

const residential = (draft: Draft) => isResidentialCategory(draft.category);
const isLand = (draft: Draft) => draft.category === "LAND";
const bookable = (draft: Draft) => isBookableCategory(draft.category);

const FREQUENCIES = [
  { id: "MONTHLY", title: "Per month" },
  { id: "ANNUAL", title: "Per year" },
  { id: "QUARTERLY", title: "Per quarter" },
  { id: "DAILY", title: "Per day" },
];

const FIELDS: FieldSpec<Draft>[] = [
  {
    key: "listingType",
    label: "Rent or sale",
    ask: (ctx) => ctx.ask("Is the property for *rent* or for *sale*?", [{ id: "ls:type:RENT", title: "For rent" }, { id: "ls:type:SALE", title: "For sale" }]),
    parse: (ctx, draft) => {
      const type = ctx.choice?.startsWith("ls:type:") ? ctx.choice.slice(8) as "RENT" | "SALE" : parseListingType(ctx.text);
      if (!type) return { ok: false, error: "Please choose *For rent* or *For sale*." };
      draft.listingType = type;
      if (type === "SALE" && bookable(draft)) delete draft.category;
      return { ok: true };
    },
    summary: (draft) => `Type: ${draft.listingType === "RENT" ? "For rent" : "For sale"}`,
  },
  {
    key: "category",
    label: "Property type",
    ask: (ctx, draft) => ctx.ask("What type of property is it?", PROPERTY_CATEGORIES
      .filter((category) => draft.listingType === "RENT" || !isBookableCategory(category.key))
      .slice(0, 10)
      .map((category) => ({ id: `ls:cat:${category.key}`, title: category.label })), "Property type"),
    parse: (ctx, draft) => {
      const key = ctx.choice?.startsWith("ls:cat:") ? ctx.choice.slice(7) : PROPERTY_CATEGORIES.find((category) => category.pattern.test(ctx.text.toLowerCase()))?.key;
      if (!key || !PROPERTY_CATEGORIES.some((category) => category.key === key)) return { ok: false, error: "Please choose a property type from the list." };
      if (draft.listingType === "SALE" && isBookableCategory(key)) return { ok: false, error: "Hotels and short stays are listed for rent by the night." };
      draft.category = key;
      if (!isResidentialCategory(key)) { delete draft.bedrooms; delete draft.bathrooms; delete draft.furnishing; }
      if (key !== "LAND") delete draft.landSizeSqm;
      draft.answered = draft.answered.filter((answered) => !["bedrooms", "bathrooms", "furnishing", "landSizeSqm", "frequency"].includes(answered));
      return { ok: true };
    },
    summary: (draft) => `Property: ${categoryLabel(draft.category)}`,
  },
  {
    key: "location",
    label: "Location",
    ask: (ctx) => ctx.prompt("Where is it? Send the *area and city*, e.g. *Adenta, Accra* or *Ahodwo, Kumasi*. (Don't send the exact house number — it isn't shown publicly.)"),
    parse: (ctx, draft) => {
      const location = parseLocation(ctx.text, true);
      if (!location) return { ok: false, error: "I couldn't read that location." };
      const parts = ctx.text.split(",").map((part) => part.trim()).filter(Boolean);
      // "Adenta, Accra": keep the person's own area wording, resolve the city/region where known.
      if (!location.area && parts.length >= 2) {
        const city = parseLocation(parts.at(-1)!, true);
        draft.location = { countryCode: "GH", area: parts[0], city: city?.city ?? city?.area ?? parts.at(-1), region: city?.region, label: `${parts[0]}, ${city?.city ?? parts.at(-1)}` };
      } else {
        draft.location = location;
      }
      return { ok: true };
    },
    summary: (draft) => (draft.location ? `Location: ${draft.location.label}` : null),
  },
  {
    key: "bedrooms",
    label: "Bedrooms",
    applies: (draft) => residential(draft) && !bookable(draft),
    ask: (ctx) => ctx.prompt("How many *bedrooms*? (Reply *0* for a studio.)"),
    parse: (ctx, draft) => {
      const value = parseInteger(ctx.text, 0, 50);
      if (value === undefined) return { ok: false, error: "Please reply with a number, e.g. *3*." };
      draft.bedrooms = value;
      return { ok: true };
    },
    summary: (draft) => (draft.bedrooms !== undefined ? `Bedrooms: ${draft.bedrooms}` : null),
  },
  {
    key: "bathrooms",
    label: "Bathrooms",
    applies: (draft) => residential(draft) && !bookable(draft),
    ask: (ctx) => ctx.prompt("How many *bathrooms*?"),
    parse: (ctx, draft) => {
      const value = parseDecimal(ctx.text, 0, 50);
      if (value === undefined || value * 2 !== Math.round(value * 2)) return { ok: false, error: "Please reply with a number, e.g. *2* or *2.5*." };
      draft.bathrooms = value;
      return { ok: true };
    },
    summary: (draft) => (draft.bathrooms !== undefined ? `Bathrooms: ${draft.bathrooms}` : null),
  },
  {
    key: "landSizeSqm",
    label: "Land size",
    applies: isLand,
    ask: (ctx) => ctx.prompt("What is the *land size*? e.g. *600 sqm*, *70x100 ft*, *1 acre* or *0.5 hectare*."),
    parse: (ctx, draft) => {
      const value = parseAreaSqm(ctx.text);
      if (!value) return { ok: false, error: "Please give the size with a unit, e.g. *600 sqm*, *70x100 ft* or *2 acres*." };
      draft.landSizeSqm = value;
      return { ok: true };
    },
    summary: (draft) => (draft.landSizeSqm ? `Land size: ${draft.landSizeSqm.toLocaleString("en")} m²` : null),
  },
  {
    key: "sizeSqm",
    label: "Floor size",
    optional: true,
    applies: (draft) => !isLand(draft),
    ask: (ctx) => ctx.prompt(`What is the *floor area*? e.g. *120 sqm*. ${SKIP_HINT}`),
    parse: (ctx, draft) => {
      const value = parseAreaSqm(ctx.text);
      if (!value) return { ok: false, error: "Please give the size with a unit, e.g. *120 sqm*, or *skip*." };
      draft.sizeSqm = value;
      return { ok: true };
    },
    summary: (draft) => (draft.sizeSqm ? `Floor area: ${draft.sizeSqm.toLocaleString("en")} m²` : null),
  },
  {
    key: "priceMinor",
    label: "Price",
    ask: (ctx, draft) => ctx.prompt(bookable(draft)
      ? "What is the price *per night* in Ghana cedis? e.g. *650*."
      : draft.listingType === "RENT" ? "What is the *rent* in Ghana cedis? e.g. *4500* (you'll choose per month/year next)." : "What is the *asking price* in Ghana cedis? e.g. *1.5 million*."),
    parse: (ctx, draft) => {
      const value = parseMoneyMinor(ctx.text);
      if (!value) return { ok: false, error: "Please reply with an amount, e.g. *4500*, *45k* or *1.2 million*." };
      draft.priceMinor = value;
      if (bookable(draft)) draft.frequency = "PER_NIGHT";
      return { ok: true };
    },
    summary: (draft) => (draft.priceMinor ? `Price: ${moneyText(draft.priceMinor)}${draft.frequency ? ` ${FREQUENCIES.find(({ id }) => id === draft.frequency)?.title.toLowerCase() ?? (draft.frequency === "PER_NIGHT" ? "per night" : "")}` : ""}` : null),
  },
  {
    key: "frequency",
    label: "Rent period",
    applies: (draft) => draft.listingType === "RENT" && !bookable(draft),
    ask: (ctx) => ctx.ask("Is that rent per month or per year?", FREQUENCIES),
    parse: (ctx, draft) => {
      const choice = FREQUENCIES.find(({ id }) => id === ctx.choice) ?? (/year|annual|annum/i.test(ctx.text) ? FREQUENCIES[1] : /month/i.test(ctx.text) ? FREQUENCIES[0] : undefined);
      if (!choice) return { ok: false, error: "Please choose a rent period." };
      draft.frequency = choice.id;
      return { ok: true };
    },
  },
  {
    key: "furnishing",
    label: "Furnishing",
    applies: residential,
    ask: (ctx) => ctx.ask("Is it furnished?", [{ id: "ls:furn:FURNISHED", title: "Furnished" }, { id: "ls:furn:SEMI_FURNISHED", title: "Semi-furnished" }, { id: "ls:furn:UNFURNISHED", title: "Unfurnished" }]),
    parse: (ctx, draft) => {
      const value = ctx.choice?.startsWith("ls:furn:") ? ctx.choice.slice(8) as Draft["furnishing"] : parseFurnishing(ctx.text);
      if (!value) return { ok: false, error: "Please choose one of the options." };
      draft.furnishing = value;
      return { ok: true };
    },
    summary: (draft) => (draft.furnishing ? `Furnishing: ${draft.furnishing.toLowerCase().replace("_", "-")}` : null),
  },
  {
    key: "amenities",
    label: "Amenities",
    optional: true,
    ask: (ctx) => ctx.prompt(`List the main *features/amenities*, separated by commas — e.g. *parking, borehole, CCTV, backup generator*. ${SKIP_HINT}`),
    parse: (ctx, draft) => {
      const items = parseList(ctx.text, 30);
      if (!items.length) return { ok: false, error: "Please list at least one, or *skip*." };
      draft.amenities = items.map((item) => item.charAt(0).toUpperCase() + item.slice(1));
      return { ok: true };
    },
    summary: (draft) => (draft.amenities?.length ? `Amenities: ${draft.amenities.join(", ")}` : null),
  },
  {
    key: "availableFrom",
    label: "Availability",
    ask: (ctx) => ctx.prompt("When is it available? Reply *now* or a date, e.g. *1 Nov* or *01/11/2026*."),
    parse: (ctx, draft) => {
      const date = parseAvailableFrom(ctx.text, ctx.now);
      if (!date) return { ok: false, error: "Please reply *now* or a date like *1 Nov*." };
      draft.availableFrom = date.toISOString();
      return { ok: true };
    },
    summary: (draft) => (draft.availableFrom ? `Available: ${new Date(draft.availableFrom) <= new Date() ? "now" : new Date(draft.availableFrom).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}` : null),
  },
  {
    key: "authority",
    label: "Your authority",
    ask: (ctx) => ctx.ask("What is your relationship to this property? NesAfric checks this before publishing.", Object.entries(AUTHORITIES).map(([id, authority]) => ({ id: `ls:auth:${id}`, title: authority.title }))),
    parse: (ctx, draft) => {
      const key = ctx.choice?.startsWith("ls:auth:") ? ctx.choice.slice(8) : undefined;
      if (!key || !(key in AUTHORITIES)) return { ok: false, error: "Please choose one of the options." };
      draft.authority = key as Authority;
      return { ok: true };
    },
    summary: (draft) => (draft.authority ? `Listing as: ${AUTHORITIES[draft.authority].title}` : null),
  },
  {
    key: "evidenceReference",
    label: "Proof of authority",
    ask: (ctx, draft) => ctx.prompt(`Which document proves this? Describe it so our team can verify it — ${AUTHORITIES[draft.authority ?? "MANAGING_AGENT"].hint}. You don't need to send the document now; our team may ask for it.`),
    parse: (ctx, draft) => {
      const value = ctx.text.trim();
      if (value.length < 3 || value.length > 1000) return { ok: false, error: "Please describe the document in a few words." };
      draft.evidenceReference = value;
      return { ok: true };
    },
    summary: (draft) => (draft.evidenceReference ? `Proof: ${draft.evidenceReference}` : null),
  },
  {
    key: "notes",
    label: "Your description",
    ask: (ctx) => ctx.prompt("Now describe the property in your own words: condition, what's special, rules, advance-payment terms, anything a renter or buyer should know. I'll tidy it into a listing for you to approve — I won't add anything you didn't say."),
    parse: (ctx, draft) => {
      const value = ctx.text.trim();
      if (value.length < 20 || value.length > 4000) return { ok: false, error: "Please write a little more (at least 20 characters)." };
      draft.notes = value;
      delete draft.title;
      delete draft.description;
      return { ok: true };
    },
  },
];

// ------------------------------------------------------------------------------------------------
// Listing copy: deterministic first, optional AI polish, always confirmed by the person
// ------------------------------------------------------------------------------------------------

/** The facts the person supplied, as plain text — the only input the copy may draw on. */
export function factsText(draft: Draft) {
  return [
    `Property type: ${categoryLabel(draft.category)}`,
    `Purpose: ${draft.listingType === "RENT" ? "for rent" : "for sale"}`,
    draft.location ? `Location: ${draft.location.label}` : null,
    draft.bedrooms !== undefined ? `Bedrooms: ${draft.bedrooms}` : null,
    draft.bathrooms !== undefined ? `Bathrooms: ${draft.bathrooms}` : null,
    draft.landSizeSqm ? `Land size: ${draft.landSizeSqm} square metres` : null,
    draft.sizeSqm ? `Floor area: ${draft.sizeSqm} square metres` : null,
    draft.furnishing ? `Furnishing: ${draft.furnishing.toLowerCase().replace("_", "-")}` : null,
    draft.amenities?.length ? `Amenities: ${draft.amenities.join(", ")}` : null,
    draft.notes ? `Owner/agent notes: ${draft.notes}` : null,
  ].filter(Boolean).join("\n");
}

/** A title and description built only from supplied facts (no AI). */
export function composeListingCopy(draft: Draft) {
  const type = categoryLabel(draft.category);
  const bedroomPart = residential(draft) && draft.bedrooms !== undefined && !bookable(draft) ? (draft.bedrooms === 0 ? "Studio " : `${draft.bedrooms}-Bedroom `) : "";
  const sizePart = isLand(draft) && draft.landSizeSqm ? `${Math.round(draft.landSizeSqm).toLocaleString("en")} m² ` : "";
  const area = draft.location?.area ?? draft.location?.city ?? draft.location?.label ?? "";
  const purpose = bookable(draft) ? "" : draft.listingType === "RENT" ? " for Rent" : " for Sale";
  const title = `${bedroomPart}${sizePart}${type}${purpose}${area ? ` in ${area}` : ""}`.replace(/\s+/g, " ").trim().slice(0, 120);
  const features = [
    residential(draft) && draft.bedrooms !== undefined ? (draft.bedrooms === 0 ? "Studio layout" : `${draft.bedrooms} bedroom${draft.bedrooms === 1 ? "" : "s"}`) : null,
    draft.bathrooms !== undefined ? `${draft.bathrooms} bathroom${draft.bathrooms === 1 ? "" : "s"}` : null,
    draft.landSizeSqm ? `Land size: ${draft.landSizeSqm.toLocaleString("en")} m²` : null,
    draft.sizeSqm ? `Floor area: ${draft.sizeSqm.toLocaleString("en")} m²` : null,
    draft.furnishing ? draft.furnishing.charAt(0) + draft.furnishing.slice(1).toLowerCase().replace("_", "-") : null,
    ...(draft.amenities ?? []),
  ].filter(Boolean);
  const description = [
    draft.notes?.trim(),
    features.length ? `Key features:\n${features.map((feature) => `• ${feature}`).join("\n")}` : null,
    draft.location ? `Location: ${draft.location.label}.` : null,
  ].filter(Boolean).join("\n\n").slice(0, 9_000);
  return { title, description };
}

async function generateCopy(ctx: Ctx) {
  const draft = ctx.data<Draft>();
  const base = composeListingCopy(draft);
  const polished = await aiPolishListingCopy(factsText(draft));
  draft.title = polished?.title ?? base.title;
  draft.description = polished?.description ?? base.description;
  await recordEvent("listing_copy_generated", ctx.contact.id, { ai: Boolean(polished) });
  return showCopy(ctx);
}

function showCopy(ctx: Ctx) {
  const draft = ctx.data<Draft>();
  ctx.step("copy");
  ctx.say(`Here's the listing text, written only from what you told me:\n\n*${draft.title}*\n\n${draft.description}`);
  ctx.ask("Happy with it?", [
    { id: "ls:copy:ok", title: "Use this" },
    { id: "ls:copy:title", title: "Change title" },
    { id: "ls:copy:desc", title: "Write my own text" },
  ]);
}

// ------------------------------------------------------------------------------------------------
// Persistence through the existing listing services
// ------------------------------------------------------------------------------------------------

function nativePayload(draft: Draft) {
  const location = draft.location!;
  const amenities = (draft.amenities ?? []).map((label) => ({
    key: label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "feature",
    label: label.slice(0, 120),
  })).filter((amenity, index, all) => all.findIndex(({ key }) => key === amenity.key) === index);
  const shared = {
    countryCode: "GH",
    region: location.region ?? null,
    city: location.city ?? null,
    locality: location.area ?? null,
    publicLocationLabel: location.label.slice(0, 250),
  };
  return {
    asset: {
      name: draft.title!,
      category: draft.category!,
      purpose: draft.listingType!,
      bedrooms: draft.bedrooms ?? null,
      bathrooms: draft.bathrooms ?? null,
      sizeSqm: draft.sizeSqm ?? null,
      currencyCode: "GHS",
      priceMinor: draft.priceMinor!,
      ...shared,
      amenities: amenities.map(({ label }) => label),
      furnishing: draft.furnishing ?? null,
      mediaUrls: [],
      availableFrom: draft.availableFrom!,
      authorityEvidenceReady: true,
    },
    listing: {
      listingType: draft.listingType!,
      category: draft.category!,
      title: draft.title!,
      publicDescription: draft.description!,
      currencyCode: "GHS",
      frequency: draft.listingType === "RENT" ? (draft.frequency ?? "MONTHLY") : null,
      availableFrom: draft.availableFrom!,
      bedrooms: draft.bedrooms ?? null,
      bathrooms: draft.bathrooms ?? null,
      sizeSqm: draft.sizeSqm ?? null,
      landSizeSqm: draft.landSizeSqm ?? null,
      furnishing: draft.furnishing ?? null,
      ...shared,
      enquiryEnabled: true,
      amenities,
      media: [],
    },
    listingAuthority: draft.authority!,
  };
}

/** Rebuilds a draft from a stored listing so a returned or existing listing can be edited here. */
async function draftFromListing(userId: string, professionalId: string, listingId: string): Promise<Draft> {
  const listing = await getMarketplaceProfessionalListing(userId, professionalId, listingId) as unknown as {
    id: string; status: string; listingType: "RENT" | "SALE"; category: string; title: string; publicDescription: string;
    rentAmountMinor: { toString(): string } | null; askingAmountMinor: { toString(): string } | null; frequency: string | null;
    bedrooms: number | null; bathrooms: { toString(): string } | null; sizeSqm: { toString(): string } | null; landSizeSqm: { toString(): string } | null;
    furnishing: string | null; region: string | null; city: string | null; locality: string | null; publicLocationLabel: string | null;
    availableFrom: Date; listingAuthority: string | null; amenities: Array<{ label: string }>; media: Array<{ type: string }>;
    verificationEvidence?: Array<{ privateReference: string }>;
  };
  const price = listing.listingType === "RENT" ? listing.rentAmountMinor : listing.askingAmountMinor;
  return {
    answered: FIELDS.map(({ key }) => key),
    professionalId,
    listingId: listing.id,
    listingStatus: listing.status,
    listingType: listing.listingType,
    category: listing.category,
    location: { countryCode: "GH", region: listing.region ?? undefined, city: listing.city ?? undefined, area: listing.locality ?? undefined, label: listing.publicLocationLabel ?? [listing.locality, listing.city].filter(Boolean).join(", ") },
    bedrooms: listing.bedrooms ?? undefined,
    bathrooms: listing.bathrooms ? Number(listing.bathrooms.toString()) : undefined,
    sizeSqm: listing.sizeSqm ? Number(listing.sizeSqm.toString()) : undefined,
    landSizeSqm: listing.landSizeSqm ? Number(listing.landSizeSqm.toString()) : undefined,
    priceMinor: price?.toString(),
    frequency: listing.frequency ?? undefined,
    furnishing: (listing.furnishing as Draft["furnishing"]) ?? undefined,
    amenities: listing.amenities.map(({ label }) => label),
    availableFrom: new Date(listing.availableFrom).toISOString(),
    notes: listing.publicDescription,
    title: listing.title,
    description: listing.publicDescription,
    authority: (listing.listingAuthority && listing.listingAuthority in AUTHORITIES ? listing.listingAuthority : "MANAGING_AGENT") as Authority,
    evidenceReference: listing.verificationEvidence?.at(-1)?.privateReference,
    photos: listing.media.filter(({ type }) => type === "PHOTO").length,
  };
}

async function createDraft(ctx: Ctx) {
  const draft = ctx.data<Draft>();
  const userId = ctx.contact.userId!;
  // The draft, its WhatsApp source channel, its event and the action binding commit together, so
  // a retry returns this exact draft — never a look-alike with the same title.
  const outcome = await runOnce(ctx.actionKey("listing_draft"), ctx.contact.id, "listing_draft", async (bind) => {
    const listing = await createMarketplaceNativeListing(userId, draft.professionalId!, nativePayload(draft), {
      inTransaction: bind(async (tx, listingId) => {
        await tx.listing.update({ where: { id: listingId }, data: { sourceChannel: "WHATSAPP" } });
        await recordEventInTx(tx, "listing_draft_created", ctx.contact.id, { listingId });
      }),
    });
    return { id: listing.id };
  });
  draft.listingId = outcome.resultId;
  draft.listingStatus = "DRAFT";
  draft.photos ??= 0;
  ctx.say(`💾 Draft saved. Reference: ${referenceFor("PR", outcome.resultId)} (not public).`);
  return true;
}

async function saveChanges(ctx: Ctx) {
  const draft = ctx.data<Draft>();
  if (!draft.listingId || !draft.dirty) return true;
  try {
    await updateMarketplaceNativeListing(ctx.contact.userId!, draft.professionalId!, draft.listingId, nativePayload(draft));
    draft.dirty = false;
    return true;
  } catch (error) {
    if (error instanceof AppError && error.status < 500) {
      ctx.say(`I couldn't save those changes: ${error.message}`);
      return false;
    }
    throw error;
  }
}

function askPhotos(ctx: Ctx) {
  const draft = ctx.data<Draft>();
  ctx.step("photos");
  ctx.prompt(draft.photos
    ? `You have ${draft.photos} photo${draft.photos === 1 ? "" : "s"}. Send more (up to ${MAX_PHOTOS}), or reply *done*.`
    : "📸 Now send photos. Send the *main photo first* (it becomes the cover), then the living room, bedrooms, kitchen, bathrooms and outside. Reply *done* when finished.", "media");
}

async function savePhoto(ctx: Ctx) {
  const draft = ctx.data<Draft>();
  const media = ctx.input.media!;
  if (media.kind !== "image") {
    ctx.say("Please send photos as images (JPG or PNG). Videos and documents can't be added to a listing here yet.");
    return;
  }
  if ((draft.photos ?? 0) >= MAX_PHOTOS) {
    ctx.say(`A listing can have up to ${MAX_PHOTOS} photos — reply *done* to continue.`);
    return;
  }
  const fetched = await fetchInboundMedia(ctx.contact.id, media, "listing_photo");
  if (!fetched.ok) {
    ctx.say(`Photo ${(draft.photos ?? 0) + 1}: ${fetched.message}`);
    return;
  }
  try {
    // One stored photo per WhatsApp message: a redelivered or retried message returns the photo
    // its first attempt stored instead of adding a copy.
    await runOnce(ctx.actionKey("listing_photo"), ctx.contact.id, "listing_photo", async (bind) => {
      const { storageObject } = await uploadMarketplaceListingMedia(ctx.contact.userId!, draft.professionalId!, draft.listingId!, {
        ...fetched.payload,
        mediaType: "PHOTO",
        ...(media.caption ? { title: media.caption.slice(0, 160) } : {}),
      }, { inTransaction: bind((tx) => recordEventInTx(tx, "listing_photo_saved", ctx.contact.id, { listingId: draft.listingId })) });
      return { id: storageObject.id };
    });
  } catch (error) {
    // Reaching here means the photo was not stored (`runOnce` checked the binding).
    ctx.say(`Photo ${(draft.photos ?? 0) + 1} wasn't saved: ${await uploadFailureMessage(ctx.contact.id, "listing_photo", error)}`);
    return;
  }
  draft.photos = (draft.photos ?? 0) + 1;
  ctx.say(draft.photos === 1 ? "✅ Main photo saved. Send more, or reply *done*." : `✅ Photo ${draft.photos} saved.`);
}

async function showReview(ctx: Ctx) {
  const draft = ctx.data<Draft>();
  ctx.step("review");
  const lines = [
    "*Please review your property listing:*",
    "",
    `*Title:* ${draft.title}`,
    ...summaryLines(FIELDS, draft),
    `Photos: ${draft.photos ?? 0}`,
    "",
    `*Description:*\n${(draft.description ?? "").length > 600 ? `${draft.description!.slice(0, 599)}…` : draft.description}`,
  ];
  ctx.say(lines.join("\n"));
  const submittable = draft.listingStatus === "DRAFT" || draft.listingStatus === "REJECTED";
  ctx.ask(submittable ? "Ready to submit it for NesAfric review?" : "What would you like to do?", [
    ...(submittable ? [{ id: "ls:submit", title: "Submit for review" }] : []),
    { id: "ls:edit", title: "Edit details" },
    { id: "ls:photos", title: "Add photos" },
    { id: "ls:later", title: "Save for later" },
  ]);
}

async function submit(ctx: Ctx) {
  const draft = ctx.data<Draft>();
  if (!(await saveChanges(ctx))) return showReview(ctx);
  const problems = listingReadinessProblems({ title: draft.title ?? "", publicDescription: draft.description, listingType: draft.listingType!, askingAmountMinor: draft.listingType === "SALE" ? draft.priceMinor : null, rentAmountMinor: draft.listingType === "RENT" ? draft.priceMinor : null, city: draft.location?.city, locality: draft.location?.area, publicLocationLabel: draft.location?.label, media: Array.from({ length: draft.photos ?? 0 }, () => ({ type: "PHOTO" })) });
  if (problems.length) {
    ctx.say(`Almost there — ${problems.map(({ message }) => message).join(" ")}`);
    if (problems.some(({ field }) => field === "media")) return askPhotos(ctx);
    return showReview(ctx);
  }
  const authority = AUTHORITIES[draft.authority!];
  try {
    await runOnce(ctx.actionKey("listing_submit"), ctx.contact.id, "listing_submit", async (bind) => {
      await submitMarketplaceListingForReview(ctx.contact.userId!, draft.professionalId!, draft.listingId!, {
        note: "Submitted via NesAfric WhatsApp.",
        evidence: { type: authority.evidence, reference: draft.evidenceReference! },
      }, {
        inTransaction: bind((tx, listingId) => recordEventInTx(tx, "listing_submitted", ctx.contact.id, { listingId, resubmission: draft.listingStatus === "REJECTED" || Boolean(draft.dirty) })),
      });
      return { id: draft.listingId! };
    });
  } catch (error) {
    if (error instanceof AppError && error.status < 500) {
      ctx.say(`It couldn't be submitted yet: ${error.message}`);
      return showReview(ctx);
    }
    throw error;
  }
  ctx.say([
    "✅ Your listing has been submitted for review.",
    `Reference: ${referenceFor("PR", draft.listingId!)}`,
    "Status: Pending review",
    "",
    "It will *not* appear on NesAfric until our team approves it. I'll message you here when it's published or if changes are needed.",
  ].join("\n"));
  ctx.finish();
  ctx.ask("What next?", [{ id: "menu:list_property", title: "List another" }, { id: "menu:status", title: "My listings" }, { id: "menu", title: "Main menu" }]);
}

// ------------------------------------------------------------------------------------------------
// Workflow
// ------------------------------------------------------------------------------------------------

async function proceed(ctx: Ctx) {
  const draft = ctx.data<Draft>();
  if (draft.editing) {
    delete draft.editing;
    draft.dirty = true;
    if (draft.title && !draft.notes) return showReview(ctx);
    if (!draft.title) return generateCopy(ctx);
    return showReview(ctx);
  }
  if (await askNextField(ctx, FIELDS, draft)) return;
  if (!draft.title || !draft.description) return generateCopy(ctx);
  if (!draft.listingId) {
    if (!(await createDraft(ctx))) return;
    return askPhotos(ctx);
  }
  return showReview(ctx);
}

async function chooseProfessional(ctx: Ctx, preset?: string) {
  if (preset === "edit") ctx.data<Draft>().mode = "edit";
  const user = await linkedUser(ctx.contact);
  const memberships = user ? (await listUserMarketplaceProfessionals(user.id)).filter(({ status }) => status === "ACTIVE") : [];
  if (!memberships.length) {
    const unlinkedAccount = !user && (await accountExistsForContact(ctx.contact));
    ctx.finish();
    if (unlinkedAccount) ctx.say("This number belongs to a NesAfric account that isn't linked to WhatsApp yet. Reply *link account* to verify it with an SMS code — then you can list for your business here.");
    ctx.say("To list a property you first need a NesAfric business profile — as an agent, agency, developer or landlord. It only takes a couple of minutes.");
    ctx.ask("Shall we set it up?", [
      { id: "menu:register_agent", title: "I'm an agent" },
      { id: "menu:register_landlord", title: "I'm a landlord" },
      { id: "menu:register_business", title: "Agency / company" },
    ]);
    return;
  }
  if (memberships.length === 1) return selectProfessional(ctx, memberships[0].id, memberships[0].displayName);
  ctx.step("professional");
  ctx.ask("Which profile are you listing for?", memberships.slice(0, 10).map((membership) => ({ id: `ls:prof:${membership.id}`, title: membership.displayName, description: `${membership.myRole.toLowerCase()} · ${membership.verificationStatus.toLowerCase()}` })), "Profiles");
}

async function selectProfessional(ctx: Ctx, professionalId: string, name: string) {
  const draft = ctx.data<Draft>();
  draft.professionalId = professionalId;
  draft.professionalName = name;
  if (draft.mode === "edit") return chooseExistingListing(ctx);
  ctx.say(`Let's list a property for *${name}*. I'll ask a few questions — type *menu* to pause anytime and *resume* to continue later.`);
  return proceed(ctx);
}

async function chooseExistingListing(ctx: Ctx) {
  const draft = ctx.data<Draft>();
  const listings = await db.listing.findMany({
    where: { marketplaceProfessionalId: draft.professionalId, status: { in: ["DRAFT", "REJECTED", "PAUSED", "PUBLISHED", "PENDING_REVIEW", "RESERVED"] } },
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: { id: true, title: true, status: true },
  });
  if (!listings.length) {
    ctx.say("You don't have any listings to edit yet — let's create one.");
    delete draft.mode;
    return proceed(ctx);
  }
  if (listings.length === 1) return openExisting(ctx, listings[0].id);
  ctx.step("pick");
  ctx.ask("Which listing?", listings.map((listing) => ({ id: `ls:pick:${listing.id}`, title: listing.title, description: `${referenceFor("PR", listing.id)} · ${listing.status.toLowerCase().replace("_", " ")}` })), "Listings");
}

async function openExisting(ctx: Ctx, listingId: string) {
  const draft = ctx.data<Draft>();
  const professionalId = draft.professionalId!;
  let loaded: Draft;
  try {
    loaded = await draftFromListing(ctx.contact.userId!, professionalId, listingId);
  } catch (error) {
    if (error instanceof AppError && [403, 404].includes(error.status)) {
      ctx.say("I couldn't find that listing in your profile.");
      return ctx.finish();
    }
    throw error;
  }
  ctx.state.data = { ...loaded, professionalName: draft.professionalName };
  const lastNote = await db.listingStatusHistory.findFirst({ where: { listingId, note: { not: null } }, orderBy: { createdAt: "desc" }, select: { note: true, toStatus: true } });
  const status = loaded.listingStatus!;
  if (status === "PENDING_REVIEW") {
    ctx.say(`*${loaded.title}* (${referenceFor("PR", listingId)}) is being reviewed by NesAfric. It can't be changed until the review is finished — I'll message you with the outcome.`);
    return ctx.finish();
  }
  if (status === "PUBLISHED" || status === "RESERVED") {
    ctx.step("live");
    ctx.ask(`*${loaded.title}* is live: ${propertyUrl(listingId)}\n\nChanges to a published listing go back through NesAfric review.`, [
      { id: "ls:live:edit", title: "Pause & edit" },
      { id: "ls:live:taken", title: loaded.listingType === "RENT" ? "Mark as rented" : "Mark as sold" },
      { id: "ls:live:withdraw", title: "Withdraw listing" },
    ]);
    return;
  }
  if (lastNote?.note && (status === "DRAFT" || status === "REJECTED")) ctx.say(`📝 NesAfric's reviewer said:\n"${lastNote.note}"`);
  return showReview(ctx);
}

export const listing: Workflow = {
  key: "listing",

  async start(ctx: Ctx, seed: StartSeed) {
    ctx.go("listing", "professional", { answered: [] } satisfies Draft);
    const [mode, listingId] = (seed.preset ?? "").split(":");
    const prefill = seed.text ? parseListingType(seed.text) : undefined;
    const draft = ctx.data<Draft>();
    if (prefill && mode !== "edit") { draft.listingType = prefill; draft.answered.push("listingType"); }
    if (mode === "edit" && listingId) {
      const owned = await db.listing.findFirst({
        where: { id: listingId, marketplaceProfessional: { members: { some: { userId: ctx.contact.userId ?? "00000000-0000-0000-0000-000000000000", status: "ACTIVE" } } } },
        select: { marketplaceProfessionalId: true, marketplaceProfessional: { select: { displayName: true } } },
      });
      if (!owned?.marketplaceProfessionalId) {
        ctx.say("I couldn't find that listing in your profiles.");
        return ctx.finish();
      }
      draft.professionalId = owned.marketplaceProfessionalId;
      draft.professionalName = owned.marketplaceProfessional?.displayName;
      return openExisting(ctx, listingId);
    }
    return chooseProfessional(ctx, mode === "edit" ? "edit" : undefined);
  },

  async handle(ctx: Ctx) {
    const draft = ctx.data<Draft>();
    const choice = ctx.choice;
    const step = ctx.state.step;

    if (step === "professional") {
      const id = choice?.startsWith("ls:prof:") ? choice.slice(8) : undefined;
      if (!id) return listing.reprompt(ctx);
      const user = await linkedUser(ctx.contact);
      const membership = user ? (await listUserMarketplaceProfessionals(user.id)).find((item) => item.id === id) : undefined;
      if (!membership) return listing.reprompt(ctx);
      return selectProfessional(ctx, membership.id, membership.displayName);
    }
    if (step === "pick") {
      const id = choice?.startsWith("ls:pick:") ? choice.slice(8) : undefined;
      if (!id) return listing.reprompt(ctx);
      return openExisting(ctx, id);
    }
    if (step === "live") {
      const transition = choice === "ls:live:edit" ? "PAUSED" : choice === "ls:live:taken" ? "RENTED" : choice === "ls:live:withdraw" ? "ARCHIVED" : null;
      if (!transition) return listing.reprompt(ctx);
      await transitionMarketplaceProfessionalListing(ctx.contact.userId!, draft.professionalId!, draft.listingId!, { status: transition, note: "Changed via NesAfric WhatsApp." });
      await recordEvent("listing_status_changed", ctx.contact.id, { listingId: draft.listingId, status: transition });
      if (transition === "PAUSED") {
        await transitionMarketplaceProfessionalListing(ctx.contact.userId!, draft.professionalId!, draft.listingId!, { status: "DRAFT", note: "Returned to draft for editing via WhatsApp." });
        draft.listingStatus = "DRAFT";
        ctx.say("The listing is now hidden from the marketplace while you edit it. Submit it again when you're done.");
        return showReview(ctx);
      }
      ctx.say(transition === "RENTED" ? "✅ Marked as taken — it no longer appears in searches." : "✅ Listing withdrawn — it no longer appears on NesAfric.");
      return ctx.finish();
    }
    if (step === "copy") {
      if (choice === "ls:copy:ok" || detectCommand(ctx.text) === "done") {
        draft.dirty = Boolean(draft.listingId);
        return proceed(ctx);
      }
      if (choice === "ls:copy:title") {
        ctx.step("copy:title");
        ctx.prompt("Send the title you'd like (5–120 characters).");
        return;
      }
      if (choice === "ls:copy:desc") {
        ctx.step("copy:desc");
        ctx.prompt("Send the full description you'd like to use (at least 20 characters).");
        return;
      }
      return showCopy(ctx);
    }
    if (step === "copy:title") {
      if (ctx.text.length < 5 || ctx.text.length > 120) return void ctx.prompt("Please send a title between 5 and 120 characters.");
      draft.title = ctx.text;
      return showCopy(ctx);
    }
    if (step === "copy:desc") {
      if (ctx.text.length < 20 || ctx.text.length > 9000) return void ctx.prompt("Please send a description of at least 20 characters.");
      draft.description = ctx.text;
      return showCopy(ctx);
    }
    if (step === "photos") {
      if (ctx.input.media) return savePhoto(ctx);
      if (["done", "skip"].includes(detectCommand(ctx.text) ?? "")) {
        if (!draft.photos) {
          ctx.prompt("A listing needs at least one photo before it can be reviewed. Please send the main photo, or type *menu* to finish later (your draft is saved).", "media");
          return;
        }
        return showReview(ctx);
      }
      return askPhotos(ctx);
    }
    if (step === "review") {
      if (choice === "ls:submit") return submit(ctx);
      if (choice === "ls:photos") return askPhotos(ctx);
      if (choice === "ls:later") {
        if (!(await saveChanges(ctx))) return showReview(ctx);
        ctx.say(`💾 Saved. Reference: ${referenceFor("PR", draft.listingId!)}. Reply *edit listing* anytime to continue.`);
        return ctx.finish();
      }
      if (choice === "ls:edit") {
        ctx.step("edit");
        ctx.ask("Which detail would you like to change?", [
          { id: "ls:field:copy", title: "Title & description" },
          ...editOptions(FIELDS, draft, "ls:field:").filter(({ id }) => id !== "ls:field:notes").slice(0, 9),
        ], "Details");
        return;
      }
      if (ctx.input.media) {
        await savePhoto(ctx);
        return;
      }
      return showReview(ctx);
    }
    if (step === "edit") {
      const key = choice?.startsWith("ls:field:") ? choice.slice(9) : undefined;
      if (!key) return showReview(ctx);
      if (key === "copy") {
        draft.dirty = true;
        return showCopy(ctx);
      }
      beginEdit(draft, key);
      await askField(ctx, FIELDS, draft, key);
      return;
    }
    if ((await handleFieldAnswer(ctx, FIELDS, draft)) === "next") return proceed(ctx);
  },

  async reprompt(ctx: Ctx) {
    const draft = ctx.data<Draft>();
    switch (ctx.state.step) {
      case "professional":
        return chooseProfessional(ctx);
      case "pick":
        return chooseExistingListing(ctx);
      case "live":
        return openExisting(ctx, draft.listingId!);
      case "copy":
      case "copy:title":
      case "copy:desc":
        return showCopy(ctx);
      case "photos":
        return askPhotos(ctx);
      case "review":
      case "edit":
        return showReview(ctx);
      default:
        return proceed(ctx);
    }
  },
};
