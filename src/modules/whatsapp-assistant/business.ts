import { absoluteUrl, BRAND } from "@/platform/brand";
import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { AppError } from "@/platform/errors";
import { db } from "@/platform/database/client";
import { maskPhone } from "@/platform/identity/phone";
import { requestOtp, verifyOtp } from "@/modules/identity/otp";
import { createMarketplaceProfessional, listUserMarketplaceProfessionals } from "@/modules/marketplace-professionals/service";
import { createMarketplaceNativeListing, submitMarketplaceListingForReview } from "@/modules/listings/service";
import { uploadMarketplaceListingMedia, uploadMarketplaceProfessionalLogo, uploadServiceProviderLogo } from "@/modules/documents/service";
import { createServiceProvider, listOwnedProviders, listServiceCategories } from "@/modules/providers/service";
import { updateMarketplaceProfile } from "@/modules/marketplace/service";
import { createOrganisation } from "@/modules/organisations/service";
import { MAX_LISTING_PHOTOS, LISTING_PHOTO_MIME_TYPES } from "@/lib/listing-media-rules";
import { LOGO_MIME_TYPES } from "@/modules/marketplace-professionals/logo";
import { linkedWhatsAppUser, linkWhatsAppIdentity, whatsappAddress } from "./identity";
import { downloadWhatsAppMedia } from "./maintenance/media";
import { formatMinor, parseAmountMinor } from "./onboarding/parse";
import { businessStateSchema, type AssistantState, type BusinessState } from "./schemas";

/**
 * Agents, agencies, real estate companies and service businesses sign up and list on the official
 * WhatsApp number. Every answer is checked by deterministic code; nothing is created until the
 * person replies confirm to a summary, and every record is created through the same domain
 * service the website uses, so permissions, plan limits, audit events and NesAfric review apply
 * unchanged. Listings go to NesAfric review; nothing is published from WhatsApp directly.
 *
 * Each WhatsApp message is one processing pass, so a pass downloads at most one file: the draft
 * listing (or profile) is created on confirm, then each photo or logo is stored as it arrives.
 */

export type BusinessKind = BusinessState["kind"];
export type BusinessInput = { phone: string; messageId: string; body: string; kind: string; organisationId: string; defaultCountry: string; defaultCurrency: string; media?: { id: string; mimeType?: string } };
export type BusinessResult = { state: AssistantState; reply: string; redactInbound?: boolean; handoff?: boolean };
type File = { fileName: string; contentType: string; dataBase64: string };
type Linked = Awaited<ReturnType<typeof linkedWhatsAppUser>>;

async function manageableCompanies(userId: string) {
  const memberships = await db.organisationMember.findMany({
    // Not the hidden organisations behind marketplace profiles (as `listUserOrganisations`).
    where: { userId, status: "ACTIVE", archivedAt: null, organisation: { archivedAt: null, marketplaceProfessional: null }, roles: { some: { role: { key: { in: ["organisation_owner", "administrator"] } } } } },
    select: { organisation: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
    take: 8,
  });
  return memberships.map(({ organisation }) => organisation);
}

export type BusinessDependencies = {
  linkedUser: typeof linkedWhatsAppUser;
  requestOtp: typeof requestOtp;
  verifyOtp: typeof verifyOtp;
  link: typeof linkWhatsAppIdentity;
  download: (mediaId: string) => Promise<{ body: Buffer; contentType: string } | null>;
  professionals: (userId: string) => Promise<Array<{ id: string; displayName: string; myRole: string; status: string; slug: string | null }>>;
  createProfessional: (userId: string, input: unknown) => Promise<{ id: string; slug: string | null; displayName: string }>;
  uploadProfessionalLogo: (userId: string, professionalId: string, file: File) => Promise<unknown>;
  createListing: (userId: string, professionalId: string, input: unknown) => Promise<{ id: string }>;
  uploadListingPhoto: (userId: string, professionalId: string, listingId: string, file: File & { mediaType: "PHOTO" }) => Promise<unknown>;
  submitListing: (userId: string, professionalId: string, listingId: string, input: unknown) => Promise<unknown>;
  categories: () => Promise<Array<{ id: string; name: string }>>;
  companies: (userId: string) => Promise<Array<{ id: string; name: string }>>;
  createCompany: (userId: string, name: string, countryCode: string) => Promise<{ id: string }>;
  createProvider: (userId: string, input: unknown) => Promise<{ id: string; slug: string | null; displayName: string }>;
  listProvider: (userId: string, providerId: string, input: unknown) => Promise<unknown>;
  uploadProviderLogo: (userId: string, providerId: string, file: File) => Promise<unknown>;
  ownedProviders: (userId: string) => Promise<Array<{ id: string; displayName: string }>>;
  /** The provider this person, or this company, already is: one each, as `createServiceProvider` enforces. */
  /** Archived ones included: the database still holds their identity, so they block a new one. */
  existingProvider: (userId: string, identity: { type: "INDIVIDUAL" } | { type: "COMPANY"; companyOrganisationId: string }) => Promise<{ id: string; displayName: string; archivedAt: Date | null } | null>;
  /** Serialises one side effect until this processing pass commits (see `once`). */
  lock: (key: string) => Promise<void>;
  /** What each side effect of a flow created, by flow and effect (see `once`). */
  ledger: { get: (key: string) => Promise<Done | null>; put: (key: string, done: Done) => Promise<void> };
};
type Done = { id: string; slug?: string | null };

const LEDGER_SCOPE = "whatsapp-business";
const ledgerKey = (key: string) => createHash("sha256").update(key).digest("hex");

const defaults: BusinessDependencies = {
  linkedUser: linkedWhatsAppUser,
  requestOtp,
  verifyOtp,
  link: linkWhatsAppIdentity,
  download: (mediaId) => downloadWhatsAppMedia(mediaId),
  professionals: listUserMarketplaceProfessionals,
  createProfessional: createMarketplaceProfessional,
  uploadProfessionalLogo: uploadMarketplaceProfessionalLogo,
  createListing: createMarketplaceNativeListing,
  uploadListingPhoto: uploadMarketplaceListingMedia,
  submitListing: submitMarketplaceListingForReview,
  categories: async () => (await listServiceCategories()).map(({ id, name }) => ({ id, name })),
  companies: manageableCompanies,
  // An ordinary workspace with its trial, exactly as a company created on the website.
  createCompany: (userId, name, countryCode) => createOrganisation(userId, { name, type: "OTHER", countryCode }),
  createProvider: createServiceProvider,
  listProvider: updateMarketplaceProfile,
  uploadProviderLogo: uploadServiceProviderLogo,
  ownedProviders: listOwnedProviders,
  existingProvider: (userId, identity) => db.serviceProvider.findFirst({ where: identity.type === "INDIVIDUAL" ? { individualUserId: userId } : { companyOrganisationId: identity.companyOrganisationId }, select: { id: true, displayName: true, archivedAt: true } }),
  // Inside the processing guard this is held until the pass's transaction commits or rolls back.
  lock: async (key) => { await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`; },
  // The idempotency table the public forms use: one row per flow and effect, written in the same
  // transaction as the record it names, kept 90 days (swept with the public write records).
  ledger: {
    get: async (key) => {
      const row = await db.publicIdempotencyRecord.findUnique({ where: { scope_keyHash: { scope: LEDGER_SCOPE, keyHash: ledgerKey(key) } }, select: { responseBody: true } });
      return (row?.responseBody as Done | null) ?? null;
    },
    put: async (key, done) => {
      const now = new Date();
      await db.publicIdempotencyRecord.create({ data: { scope: LEDGER_SCOPE, keyHash: ledgerKey(key), fingerprint: LEDGER_SCOPE, status: "COMPLETED", responseBody: { id: done.id, slug: done.slug ?? null }, completedAt: now, expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60_000) } });
    },
  },
};

/**
 * Each side effect runs at most once per flow, however many passes handle the same message: two
 * workers can decide one message at once (a burst of photos, a retried job), and a pass's writes
 * can commit even when its conversation update loses the race. The lock makes a concurrent pass
 * wait for this one to commit; the ledger row, written in the same transaction as the record,
 * then names what was created. Records are never matched by name, so a listing or business made
 * elsewhere meanwhile is never mistaken for this flow's. `create` returning null records nothing.
 */
async function once(dependencies: BusinessDependencies, key: string, create: () => Promise<Done | null>): Promise<Done | null> {
  await dependencies.lock(key);
  const done = await dependencies.ledger.get(key);
  if (done) return done;
  const created = await create();
  if (created) await dependencies.ledger.put(key, created);
  return created;
}

// ---------------------------------------------------------------------------------------------
// Starting a flow

const TRIGGERS: Array<[RegExp, BusinessKind, BusinessState["professionalType"]?]> = [
  [/^(3|register (a |my |our )?(real estate )?(agency|company|business|brokerage|firm)|register agency|real estate (agency|company)|i am a developer|register (as a )?developer)$/, "agency"],
  [/^(4|register (as )?(an )?agent|i am an agent|become an agent|agent sign ?up|sign up as (an )?agent)$/, "agency", "INDIVIDUAL_AGENT"],
  [/^(5|list (a |my |our )?(property|properties|house|apartment|flat|land|office|shop)( for (rent|sale))?|add (a )?listing|new listing|post (a )?property|sell my (house|property|land)|rent out my (house|property|apartment|flat))$/, "listing"],
  [/^(6|register (a |my |our )?service( business)?|register as (a )?service provider|service provider sign ?up|sign up as (a )?(service )?provider|join (the )?service marketplace|list my services?)$/, "service"],
  [/^(logo|upload (a |my |our )?logo|change (my |our )?logo|update (my |our )?logo)$/, "logo"],
];

/** The business flow a message asks for. A bare number that picks a search result stays a pick. */
export function businessTrigger(command: string, state: AssistantState): { kind: BusinessKind; professionalType?: BusinessState["professionalType"] } | null {
  for (const [pattern, kind, professionalType] of TRIGGERS) {
    if (!pattern.test(command)) continue;
    // A paused workflow is resumed or cancelled first, whatever starts the new one ("3" or a phrase).
    if (state.paused) return null;
    // Result picks accept 1 to 3 whatever the result count, so all three stay with the search.
    if (/^\d$/.test(command) && state.results.length > 0 && Number(command) <= 3) return null;
    return { kind, professionalType };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Prompts

const PROFESSIONAL_TYPES = [
  ["REAL_ESTATE_COMPANY", "Real estate company"],
  ["BROKERAGE", "Real estate agency or brokerage"],
  ["DEVELOPER", "Property developer"],
  ["BROKER", "Broker"],
  ["PROPERTY_MARKETING_COMPANY", "Property marketing company"],
  ["INDIVIDUAL_AGENT", "Individual agent"],
] as const;
const CATEGORIES = [
  ["APARTMENT", "Apartment / flat"], ["HOUSE", "House"], ["TOWNHOUSE", "Townhouse"], ["VILLA", "Villa"], ["LAND", "Land"],
  ["OFFICE", "Office"], ["SHOP", "Shop"], ["WAREHOUSE", "Warehouse"], ["COMMERCIAL", "Other commercial"],
] as const;
const RESIDENTIAL = new Set(["APARTMENT", "HOUSE", "TOWNHOUSE", "VILLA"]);
const FREQUENCIES = [["MONTHLY", "per month", /^(1|month|monthly|per month|a month)$/], ["ANNUAL", "per year", /^(2|year|yearly|annual|annually|per year|a year|per annum)$/], ["QUARTERLY", "per quarter", /^(3|quarter|quarterly|per quarter)$/], ["DAILY", "per day", /^(4|day|daily|per day)$/]] as const;
const AUTHORITIES = [
  ["OWNER_SELF", "I own the property", "ownership_reference", "the title deed, land certificate or indenture number"],
  ["MANAGING_AGENT", "I am the owner's agent", "owner_mandate", "the owner's mandate or letter of authority (date and owner's name)"],
  ["BROKERAGE_AUTHORIZED", "My agency has the listing", "listing_authority", "the listing agreement (date and owner's name)"],
  ["PROPERTY_MANAGER", "I manage it for the owner", "owner_mandate", "the management contract (date and owner's name)"],
  ["DEVELOPER", "We are the developer", "developer_authority", "the development permit or land title number"],
] as const;
const EVIDENCE_TYPES = ["ownership_reference", "owner_mandate", "listing_authority", "developer_authority"] as const;
/** Summaries stay well inside WhatsApp's 4,096-character message limit. */
const clip = (text: string | undefined, limit = 400) => !text ? text : text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
const numbered = (items: ReadonlyArray<string>) => items.map((item, index) => `${index + 1}. ${clip(item, 120)}`).join("\n");
const optional = "Reply skip to leave it out.";

function promptFor(business: BusinessState, phone: string, currency: string): string {
  const listing = business.listing;
  switch (business.step) {
    case "account_name": return "First, a NesAfric account for this WhatsApp number. What is your full name?";
    case "account_code": return business.account.challengeId ? `Reply with the 6-digit code I sent by text message to ${maskPhone(whatsappAddress(phone))}. Reply resend for a new code.` : "Reply resend to get a 6-digit code by text message.";
    case "agency_type": return `What kind of business are you registering?\n${numbered(PROFESSIONAL_TYPES.map(([, label]) => label))}`;
    case "agency_name": return business.professionalType === "INDIVIDUAL_AGENT" ? "What name should clients see on your agent profile? Reply me to use your own name." : "What is the business called? This is the name clients will see.";
    case "agency_areas": return "Which areas do you work in? Send them separated by commas, for example: East Legon, Cantonments, Tema.";
    case "agency_description": return `Describe ${business.professionalType === "INDIVIDUAL_AGENT" ? "your work" : "the business"} in a few sentences for your public profile. ${optional}`;
    case "agency_email": return `Which email address should enquiries go to? ${optional}`;
    case "agency_review": return [
      "Please check your profile:",
      `Name: ${business.displayName}`,
      `Type: ${PROFESSIONAL_TYPES.find(([key]) => key === business.professionalType)?.[1]}`,
      `Areas: ${clip(business.areas.join(", "), 600)}`,
      `About: ${clip(business.description) ?? "not given"}`,
      `Email: ${business.email ?? "not given"}`,
      `Phone: ${whatsappAddress(phone)} (this WhatsApp number)`,
      "",
      "Reply confirm to create the profile, or cancel.",
    ].join("\n");
    case "agency_logo": return "Now send your logo as a photo (JPG, PNG or WebP, up to 2 MB). Reply skip to add it later.";
    case "listing_professional": return `Which profile should this listing be under?\n${numbered(business.choices.map(({ name }) => name))}`;
    case "listing_purpose": return "Is the property for rent or for sale? Reply rent or sale.";
    case "listing_category": return `What type of property is it?\n${numbered(CATEGORIES.map(([, label]) => label))}`;
    case "listing_title": return "Give the listing a short title, for example: 3 bedroom house with garden, East Legon.";
    case "listing_location": return "Where is it? Send the area and town, for example: East Legon, Accra. Only this general location is shown publicly.";
    case "listing_price": return listing.purpose === "RENT" ? `What is the rent, in ${currency}? For example 4500.` : `What is the asking price, in ${currency}? For example 850000.`;
    case "listing_frequency": return `Is ${formatMinor(listing.priceMinor ?? "0", currency)}:\n1. per month\n2. per year\n3. per quarter\n4. per day`;
    case "listing_bedrooms": return "How many bedrooms? Send a number (0 for a studio).";
    case "listing_bathrooms": return `How many bathrooms? ${optional}`;
    case "listing_description": return "Describe the property for buyers or tenants: condition, features, nearby landmarks. At least 20 characters.";
    case "listing_authority": return `What is your right to list this property?\n${numbered(AUTHORITIES.map(([, label]) => label))}`;
    case "listing_review": return [
      "Please check the listing:",
      `Profile: ${business.choices.find(({ id }) => id === business.professionalId)?.name ?? business.displayName ?? "your profile"}`,
      `${listing.purpose === "RENT" ? "For rent" : "For sale"}: ${CATEGORIES.find(([key]) => key === listing.category)?.[1]}`,
      `Title: ${listing.title}`,
      `Location: ${listing.location}`,
      `Price: ${formatMinor(listing.priceMinor ?? "0", currency)}${listing.frequency ? ` ${FREQUENCIES.find(([key]) => key === listing.frequency)?.[1]}` : ""}`,
      listing.bedrooms !== undefined ? `Bedrooms: ${listing.bedrooms}${listing.bathrooms !== undefined ? `, bathrooms: ${listing.bathrooms}` : ""}` : null,
      `Description: ${clip(listing.description)}`,
      `Your right to list: ${AUTHORITIES.find(([key]) => key === listing.authority)?.[1]}`,
      "",
      "Reply confirm to save it as a draft and add photos, or cancel.",
    ].filter((line) => line !== null).join("\n");
    case "listing_photos": return `Send photos of the property, one or more at a time (up to ${MAX_LISTING_PHOTOS}). Reply done when you have sent them all.`;
    case "listing_evidence": return `Last step. NesAfric checks every listing before it goes live. Send the reference of ${AUTHORITIES.find(([key]) => key === listing.authority)?.[3] ?? "the document that authorises you to list it"}. Do not send the document itself here.`;
    case "service_type": return "Are you registering:\n1. As an individual (a tradesperson or freelancer)\n2. A company";
    case "service_company": return business.choices.length
      ? `Which company is it?\n${numbered(business.choices.map(({ name }) => name))}\n${business.choices.length + 1}. A new company — or just send its name.`
      : "What is the company called?";
    case "service_name": return "What name should customers see? For example: Kwame Plumbing Services. Reply me to use your own name.";
    case "service_categories": return business.choices.length
      ? `${business.categories.length ? `Added: ${clip(business.categories.map(({ name }) => name).join(", "), 600)}.\n` : ""}Which of these do you offer? Reply the numbers separated by commas, for example 1, 3:\n${numbered(business.choices.map(({ name }) => name))}`
      : "Which services do you offer? Send them in your own words, separated by commas, for example: plumbing, electrical, roofing.";
    case "service_areas": return "Which towns or areas do you serve? Send them separated by commas, for example: Accra, Tema, Kasoa.";
    case "service_description": return `Describe your services and experience for customers. ${optional}`;
    case "service_review": return [
      "Please check your service profile:",
      `Name: ${business.displayName}`,
      `${business.providerType === "COMPANY" ? `Company: ${business.companyName}` : "Registered as an individual"}`,
      `Services: ${clip(business.categories.map(({ name }) => name).join(", "), 600)}`,
      `Areas: ${clip(business.areas.join(", "), 600)}`,
      `About: ${clip(business.description) ?? "not given"}`,
      `Phone: ${whatsappAddress(phone)} (this WhatsApp number)`,
      "",
      "Reply confirm to create it and list it on the NesAfric service marketplace, or cancel.",
    ].join("\n");
    case "service_logo": return "Send your business logo as a photo (JPG, PNG or WebP, up to 2 MB), or reply skip.";
    case "logo_target": return `Whose logo do you want to change?\n${numbered(business.choices.map(({ name }) => name))}`;
    case "logo_upload": return `Send the new logo for ${business.target?.name} as a photo (JPG, PNG or WebP, up to 2 MB). Reply cancel to keep the current one.`;
  }
}

// ---------------------------------------------------------------------------------------------
// Service categories, matched from the words people use

const GENERIC = new Set(["and", "the", "for", "services", "service", "systems", "system", "installation", "installer", "install", "maintenance", "repair", "repairs", "works", "work", "support", "general", "company"]);
const SYNONYMS: Record<string, string> = { tiler: "tiling", tilers: "tiling", tile: "tiling", tiles: "tiling", ac: "conditioning", aircon: "conditioning", mover: "moving", movers: "moving", removals: "moving", removal: "moving", lift: "elevator", fumigation: "pest", electrician: "electrical", electricians: "electrical", lawyer: "lawyers", solicitor: "lawyers", handyman: "handyman", fumigator: "pest" };
const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).map((word) => SYNONYMS[word] ?? word).filter((word) => word.length >= 3 && !GENERIC.has(word));
const sharedPrefix = (a: string, b: string) => { let index = 0; while (index < a.length && index < b.length && a[index] === b[index]) index += 1; return index; };
/** Same stem: "plumber" and "plumbing", "roofer" and "roofing". Three-letter words must be equal. */
const wordMatches = (wanted: string, offered: string) => wanted === offered || (Math.min(wanted.length, offered.length) >= 4 && sharedPrefix(wanted, offered) >= 4);

/**
 * Which categories a phrase such as "plumber" or "electrical wiring" means. An exact name wins;
 * otherwise every category sharing all of the phrase's meaningful words (by stem) is a candidate.
 */
export function matchServiceCategories(phrase: string, categories: ReadonlyArray<{ id: string; name: string }>) {
  const exact = categories.find(({ name }) => name.toLowerCase() === phrase.trim().toLowerCase());
  if (exact) return [exact];
  const wanted = words(phrase);
  if (!wanted.length) return [];
  return categories.filter(({ name }) => {
    const offered = words(name);
    return wanted.every((word) => offered.some((candidate) => wordMatches(word, candidate)));
  });
}

// ---------------------------------------------------------------------------------------------
// The flow

/** The stored name of a WhatsApp file, also how a repeated pass recognises it was stored. */
const fileName = (mediaId: string, contentType = "image/jpeg") => `whatsapp-${mediaId}.${contentType.split(";")[0].split("/")[1]?.trim().replace("jpeg", "jpg") || "jpg"}`;
const fileFor = (mediaId: string, file: { body: Buffer; contentType: string }): File => ({
  fileName: fileName(mediaId, file.contentType),
  contentType: file.contentType,
  dataBase64: file.body.toString("base64"),
});
/** Items separated by commas, semicolons or lines; repeats (any case) kept once, as the domain requires. */
/**
 * Whether an image type is one we store. The type WhatsApp declares with the message is optional:
 * without one the image is fetched and the type the download reports decides (`required`).
 */
const acceptedType = (type: string | undefined, accepted: ReadonlyArray<string>, required = false) => {
  const value = type?.split(";")[0].trim().toLowerCase();
  return value ? accepted.includes(value) : !required;
};
const splitList = (body: string) => {
  const seen = new Set<string>();
  return body.split(/[,;\n]/).map((item) => item.trim()).filter((item) => item && !seen.has(item.toLowerCase()) && seen.add(item.toLowerCase()));
};
/**
 * A refusal the person can act on becomes the reply. A domain validation error is one too: retrying
 * the same answer can never succeed, so it must not become a job retried forever.
 */
const failure = (error: unknown) => {
  if (error instanceof AppError && error.status < 500) return error.message;
  if (error instanceof ZodError) return `Some details were not accepted (${error.issues.slice(0, 3).map(({ path, message }) => `${path.join(".") || "value"}: ${message}`).join("; ")}). Reply cancel and start again with shorter or corrected answers, or contact support.`;
  throw error;
};

/** Start a flow from the menu or a phrase. The caller has checked `businessTrigger`. */
export async function startBusiness(trigger: { kind: BusinessKind; professionalType?: BusinessState["professionalType"] }, input: BusinessInput, reset: () => AssistantState, dependencies: BusinessDependencies = defaults): Promise<BusinessResult> {
  const business = businessStateSchema.parse({ kind: trigger.kind, step: "account_name", professionalType: trigger.professionalType, startedAt: new Date().toISOString() });
  const linked = await dependencies.linkedUser(input.phone);
  const next: AssistantState = { ...reset(), workflow: "business", business };
  if (!linked) return reply(next, business, input, INTRO[trigger.kind]);
  const begun = await begin(business, linked.user.id, linked.user.displayName, dependencies);
  if (typeof begun === "string") return { state: reset(), reply: begun };
  return reply(next, business, input, business.kind === "logo" ? "" : INTRO[trigger.kind]);
}

const INTRO: Record<BusinessKind, string> = {
  agency: "Let's put your real estate business on NesAfric. It takes a few minutes and your answers are kept as you go. Reply cancel at any time.",
  listing: "Let's list your property. NesAfric reviews every listing before it goes live. Reply cancel at any time.",
  service: "Let's list your service business on the NesAfric service marketplace. Reply cancel at any time.",
  logo: "",
};

function reply(state: AssistantState, business: BusinessState, input: BusinessInput, prefix: string, extra: Partial<BusinessResult> = {}): BusinessResult {
  return { state: { ...state, workflow: "business", business }, reply: `${prefix ? `${prefix}\n\n` : ""}${promptFor(business, input.phone, input.defaultCurrency)}`, ...extra };
}

/**
 * The first real step of a flow for a known account. A string is a reason the flow cannot start
 * (for example, a listing needs a profile first).
 */
async function begin(business: BusinessState, userId: string, displayName: string, dependencies: BusinessDependencies): Promise<true | string> {
  if (business.kind === "agency") {
    business.step = business.professionalType ? "agency_name" : "agency_type";
    if (business.professionalType === "INDIVIDUAL_AGENT") business.displayName = displayName;
    return true;
  }
  if (business.kind === "listing") {
    const profiles = (await dependencies.professionals(userId)).filter(({ status }) => status === "ACTIVE");
    if (!profiles.length) return "To list a property you need an agent or agency profile first. Reply 4 to register as an agent, or 3 to register your agency or company. It takes about two minutes.";
    business.choices = profiles.slice(0, 9).map(({ id, displayName: name }) => ({ id, name }));
    if (profiles.length === 1) { business.professionalId = profiles[0].id; business.step = "listing_purpose"; }
    else business.step = "listing_professional";
    return true;
  }
  if (business.kind === "service") {
    business.step = "service_type";
    return true;
  }
  const targets = [
    ...(await dependencies.professionals(userId)).filter(({ myRole }) => myRole === "OWNER" || myRole === "ADMIN").map(({ id, displayName: name }) => ({ kind: "professional" as const, id, name })),
    ...(await dependencies.ownedProviders(userId)).map(({ id, displayName: name }) => ({ kind: "provider" as const, id, name })),
  ].slice(0, 9);
  if (!targets.length) return "You have no business profile to add a logo to yet. Reply 3 to register an agency or company, 4 to register as an agent, or 6 for a service business.";
  if (targets.length === 1) { business.target = targets[0]; business.step = "logo_upload"; return true; }
  business.choices = targets.map(({ id, name }) => ({ id, name }));
  business.step = "logo_target";
  return true;
}

export async function advanceBusiness(input: BusinessInput, state: AssistantState, reset: () => AssistantState, dependencies: BusinessDependencies = defaults): Promise<BusinessResult> {
  const business = state.business ? structuredClone(state.business) : null;
  if (!business) return { state: reset(), reply: "That request has expired. Reply menu to start again." };
  const body = input.body.trim();
  const command = body.toLowerCase();
  const redactInbound = business.step === "account_code";
  const say = (prefix = "", extra: Partial<BusinessResult> = {}) => reply(state, business, input, prefix, extra);

  // Help is always one word away. "8" stays an answer here: several steps are numbered lists.
  if (/^(support|human|talk to support|help me)$/.test(command)) {
    return { state: { ...state, business }, reply: "Your conversation has been added to the support queue. A team member will reply here; no response time is guaranteed. Reply menu to stop waiting and go back to the assistant.", handoff: true, redactInbound };
  }
  // "help", as in the main menu, never becomes an answer: it repeats the question and the way out.
  if (command === "help") return say("Answer the question below to continue. Reply support to reach a person, or cancel to stop.", { redactInbound });
  if (command === "cancel" || command === "menu" || command === "stop") {
    const kept = business.committed.listingId ? " Your draft listing is kept; finish it on the website or reply 5 to list another." : business.committed.professionalId || business.committed.providerId ? " Your profile is saved." : " Nothing was saved.";
    return { state: reset(), reply: `Stopped.${kept} Reply menu for other options.`, redactInbound };
  }

  // Photos and logos are the only steps that take media.
  const mediaStep = business.step === "listing_photos" || business.step === "agency_logo" || business.step === "service_logo" || business.step === "logo_upload";
  if (input.kind !== "text" && !mediaStep) return say("Please reply with text for this step.");
  if (input.kind === "text" && mediaStep && !/^(done|skip|finish|finished|later|no)$/.test(command)) return say(business.step === "listing_photos" ? "Send the photos as images, or reply done." : "Send the logo as an image, or reply skip.");

  const linked: Linked = await dependencies.linkedUser(input.phone);

  // Account: create one for this number, or sign in to the one that already uses it.
  if (business.step === "account_name" || business.step === "account_code") {
    if (linked) {
      const begun = await begin(business, linked.user.id, linked.user.displayName, dependencies);
      return typeof begun === "string" ? { state: reset(), reply: begun } : say("", { redactInbound });
    }
    if (business.step === "account_name") {
      if (body.length < 2 || body.length > 100 || !/\p{L}/u.test(body)) return say("Please send your full name (2 to 100 characters).");
      business.account.displayName = body;
      return say(await sendCode(business, input, dependencies));
    }
    if (command === "resend" || !business.account.challengeId) return say(await sendCode(business, input, dependencies), { redactInbound: true });
    if (!/^\d{6}$/.test(body)) return say("Send the 6-digit code, or reply resend for a new one.", { redactInbound: true });
    try {
      const { user } = await dependencies.verifyOtp({ challengeId: business.account.challengeId, channel: "sms", identifier: whatsappAddress(input.phone), code: body, displayName: business.account.displayName });
      await dependencies.link(input.phone, user.id, "SMS_OTP", input.organisationId);
      business.account = { failures: 0 };
      const begun = await begin(business, user.id, user.displayName, dependencies);
      if (typeof begun === "string") return { state: reset(), reply: `Number confirmed. Signed in as ${user.displayName}.\n\n${begun}`, redactInbound: true };
      return say(`Number confirmed. Signed in as ${user.displayName}.`, { redactInbound: true });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      if (error.code === "OTP_INVALID") {
        business.account.failures += 1;
        if (business.account.failures >= 5) { business.account.challengeId = undefined; return say("Too many incorrect codes. Reply resend for a new code.", { redactInbound: true }); }
        return say("That code is incorrect. Check it and send it again, or reply resend.", { redactInbound: true });
      }
      if (error.code === "OTP_EXPIRED") { business.account.challengeId = undefined; return say("That code has expired. Reply resend for a new one.", { redactInbound: true }); }
      return say(error.status < 500 ? error.message : "I could not check the code right now. Please send it again in a moment.", { redactInbound: true });
    }
  }

  // Every later step acts as the account linked to this number, and only that account.
  if (!linked) {
    business.step = "account_name";
    return say("This WhatsApp number is no longer linked to a NesAfric account.");
  }
  const userId = linked.user.id;
  const currency = input.defaultCurrency;
  const listing = business.listing;
  // Names this flow in the ledger: the number and the moment the flow began.
  business.startedAt ??= new Date().toISOString();
  const key = (effect: string) => `${whatsappAddress(input.phone)}:${business.startedAt}:${effect}`;

  switch (business.step) {
    // ---- Agents, agencies and companies -------------------------------------------------------
    case "agency_type": {
      const choice = PROFESSIONAL_TYPES[Number(command) - 1] ?? PROFESSIONAL_TYPES.find(([, label]) => label.toLowerCase().includes(command) && command.length >= 4);
      if (!choice) return say();
      business.professionalType = choice[0];
      business.step = "agency_name";
      return say();
    }
    case "agency_name": {
      const name = command === "me" ? linked.user.displayName : body;
      if (name.length < 2 || name.length > 200) return say("Please send a name between 2 and 200 characters.");
      business.displayName = name;
      business.step = "agency_areas";
      return say();
    }
    case "agency_areas": {
      const areas = splitList(body);
      if (!areas.length || areas.length > 20 || areas.some((area) => area.length < 2 || area.length > 120)) return say("Send 1 to 20 areas separated by commas.");
      business.areas = areas;
      business.step = "agency_description";
      return say();
    }
    case "agency_description": {
      if (body.length > 5000) return say("Please keep it under 5,000 characters, or reply skip.");
      business.description = command === "skip" ? undefined : body;
      business.step = "agency_email";
      return say();
    }
    case "agency_email": {
      if (command !== "skip" && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/.test(body)) return say("That does not look like an email address. Send one, or reply skip.");
      business.email = command === "skip" ? undefined : body.toLowerCase();
      business.step = "agency_review";
      return say();
    }
    case "agency_review": {
      if (command !== "confirm") return say();
      if (!business.committed.professionalId) {
        try {
          const professional = (await once(dependencies, key("professional"), () => dependencies.createProfessional(userId, {
            type: business.professionalType, displayName: business.displayName, description: business.description, contactEmail: business.email,
            contactPhone: whatsappAddress(input.phone), countryCode: input.defaultCountry, serviceAreas: business.areas,
          })))!;
          business.committed.professionalId = professional.id;
          business.committed.slug = professional.slug ?? undefined;
        } catch (error) {
          return say(`Not saved: ${failure(error)}`);
        }
      }
      business.target = { kind: "professional", id: business.committed.professionalId, name: business.displayName ?? "your profile" };
      business.step = "agency_logo";
      return say(`Your profile ${business.displayName} is created.`);
    }
    case "agency_logo":
    case "service_logo":
    case "logo_upload": {
      const finish = () => business.kind === "agency" ? agencyDone(business) : business.kind === "service" ? serviceDone(business) : "Logo updated. It shows on your public profile now. Reply menu for other options.";
      if (input.kind === "text") return { state: reset(), reply: business.kind === "logo" ? "The logo is unchanged. Reply menu for other options." : finish() };
      const media = input.media;
      if (input.kind !== "image" || !media || !acceptedType(media.mimeType, LOGO_MIME_TYPES)) return say("Please send the logo as a JPG, PNG or WebP photo.");
      const target = business.target!;
      try {
        const stored = await once(dependencies, key(`logo:${target.id}:${media.id}`), async () => {
          const file = await dependencies.download(media.id);
          if (!file) return null;
          if (!acceptedType(file.contentType, LOGO_MIME_TYPES, true)) throw new AppError("WHATSAPP_IMAGE_TYPE", 422, "Please send the logo as a JPG, PNG or WebP photo.");
          if (target.kind === "professional") await dependencies.uploadProfessionalLogo(userId, target.id, fileFor(media.id, file));
          else await dependencies.uploadProviderLogo(userId, target.id, fileFor(media.id, file));
          return { id: media.id };
        });
        if (!stored) return say("I could not fetch that image from WhatsApp. Please send it again.");
      } catch (error) {
        return say(`The logo was not saved: ${failure(error)}`);
      }
      return { state: reset(), reply: `Logo saved.\n\n${finish()}` };
    }
    case "logo_target": {
      const index = Number(command) - 1;
      const picked = business.choices[index];
      if (!picked) return say();
      const providers = new Set((await dependencies.ownedProviders(userId)).map(({ id }) => id));
      business.target = { kind: providers.has(picked.id) ? "provider" : "professional", id: picked.id, name: picked.name };
      business.step = "logo_upload";
      return say();
    }

    // ---- Property listings --------------------------------------------------------------------
    case "listing_professional": {
      const picked = business.choices[Number(command) - 1];
      if (!picked) return say();
      business.professionalId = picked.id;
      business.step = "listing_purpose";
      return say();
    }
    case "listing_purpose": {
      const purpose = /^(1|rent|for rent|renting|let|to let)$/.test(command) ? "RENT" : /^(2|sale|sell|for sale|selling|buy)$/.test(command) ? "SALE" : null;
      if (!purpose) return say();
      listing.purpose = purpose;
      business.step = "listing_category";
      return say();
    }
    case "listing_category": {
      const choice = CATEGORIES[Number(command) - 1] ?? CATEGORIES.find(([key, label]) => command.length >= 3 && (key.toLowerCase() === command || label.toLowerCase().includes(command)));
      if (!choice) return say();
      listing.category = choice[0];
      business.step = "listing_title";
      return say();
    }
    case "listing_title": {
      if (body.length < 3 || body.length > 200) return say("Please send a title between 3 and 200 characters.");
      listing.title = body;
      business.step = "listing_location";
      return say();
    }
    case "listing_location": {
      if (body.length < 2 || body.length > 250) return say("Please send the area and town (2 to 250 characters).");
      // Each part becomes the listing's locality or city, which hold 150 characters each.
      if (body.split(",").some((part) => part.trim().length > 150)) return say("Please keep the area and the town under 150 characters each, for example: East Legon, Accra.");
      listing.location = body;
      business.step = "listing_price";
      return say();
    }
    case "listing_price": {
      const amount = parseAmountMinor(body.replace(/\s*(cedis?|ghs)$/i, ""));
      if (!amount || amount === "0") return say("Please send the amount as a number, for example 4500.");
      listing.priceMinor = amount;
      business.step = listing.purpose === "RENT" ? "listing_frequency" : RESIDENTIAL.has(listing.category ?? "") ? "listing_bedrooms" : "listing_description";
      return say();
    }
    case "listing_frequency": {
      const frequency = FREQUENCIES.find(([, , pattern]) => pattern.test(command));
      if (!frequency) return say();
      listing.frequency = frequency[0];
      business.step = RESIDENTIAL.has(listing.category ?? "") ? "listing_bedrooms" : "listing_description";
      return say();
    }
    case "listing_bedrooms": {
      if (!/^\d{1,2}$/.test(command)) return say("Please send the number of bedrooms, for example 3.");
      listing.bedrooms = Number(command);
      business.step = "listing_bathrooms";
      return say();
    }
    case "listing_bathrooms": {
      if (command !== "skip" && !/^\d{1,2}(\.5)?$/.test(command)) return say("Please send the number of bathrooms, for example 2, or reply skip.");
      listing.bathrooms = command === "skip" ? undefined : Number(command);
      business.step = "listing_description";
      return say();
    }
    case "listing_description": {
      if (body.length < 20 || body.length > 10_000) return say("Please write at least 20 characters (and under 10,000).");
      listing.description = body;
      business.step = "listing_authority";
      return say();
    }
    case "listing_authority": {
      const choice = AUTHORITIES[Number(command) - 1];
      if (!choice) return say();
      listing.authority = choice[0];
      business.step = "listing_review";
      return say();
    }
    case "listing_review": {
      if (command !== "confirm") return say();
      if (!business.committed.listingId) {
        const [locality, ...rest] = (listing.location ?? "").split(",").map((part) => part.trim()).filter(Boolean);
        const city = rest.at(-1) ?? locality;
        try {
          const created = (await once(dependencies, key("listing"), () => dependencies.createListing(userId, business.professionalId!, {
            asset: {
              name: listing.title, category: listing.category, purpose: listing.purpose, currencyCode: currency, priceMinor: listing.priceMinor,
              countryCode: input.defaultCountry, city, locality: rest.length ? locality : null, publicLocationLabel: listing.location,
              bedrooms: listing.bedrooms ?? null, bathrooms: listing.bathrooms ?? null, availableFrom: new Date().toISOString(),
            },
            listing: {
              listingType: listing.purpose, category: listing.category, title: listing.title, publicDescription: listing.description,
              currencyCode: currency, frequency: listing.purpose === "RENT" ? listing.frequency : null, availableFrom: new Date().toISOString(),
              countryCode: input.defaultCountry, bedrooms: listing.bedrooms ?? null, bathrooms: listing.bathrooms ?? null,
              contactPhone: whatsappAddress(input.phone), enquiryEnabled: true,
            },
            listingAuthority: listing.authority,
          })))!;
          business.committed.listingId = created.id;
        } catch (error) {
          return say(`Not saved: ${failure(error)}`);
        }
      }
      business.step = "listing_photos";
      return say("Saved as a draft.");
    }
    case "listing_photos": {
      if (input.kind === "text") {
        if (!business.committed.media.length) return say("A listing needs at least one photo before NesAfric can review it.");
        business.step = "listing_evidence";
        return say(`${business.committed.media.length} ${business.committed.media.length === 1 ? "photo" : "photos"} saved.`);
      }
      const media = input.media;
      if (input.kind !== "image" || !media || !acceptedType(media.mimeType, LISTING_PHOTO_MIME_TYPES)) return say("That file was not added. Please send photos as JPG, PNG or WebP images.");
      if (business.committed.media.includes(media.id)) return { state: { ...state, business }, reply: "That photo is already saved." };
      if (business.committed.media.length >= MAX_LISTING_PHOTOS) return say(`A listing can have up to ${MAX_LISTING_PHOTOS} photos. Reply done to continue.`);
      try {
        const stored = await once(dependencies, key(`photo:${media.id}`), async () => {
          const file = await dependencies.download(media.id);
          if (!file) return null;
          if (!acceptedType(file.contentType, LISTING_PHOTO_MIME_TYPES, true)) throw new AppError("WHATSAPP_IMAGE_TYPE", 422, "That file was not added. Please send photos as JPG, PNG or WebP images.");
          await dependencies.uploadListingPhoto(userId, business.professionalId!, business.committed.listingId!, { ...fileFor(media.id, file), mediaType: "PHOTO" });
          return { id: media.id };
        });
        if (!stored) return say("I could not fetch that photo from WhatsApp. Please send it again.");
      } catch (error) {
        return say(`That photo was not saved: ${failure(error)}`);
      }
      business.committed.media.push(media.id);
      // Short acknowledgement: photos usually arrive in a burst.
      return { state: { ...state, workflow: "business", business }, reply: `Photo ${business.committed.media.length} saved. Send more, or reply done.` };
    }
    case "listing_evidence": {
      if (body.length < 3 || body.length > 1000) return say("Please send the document reference (3 to 1,000 characters).");
      const type = AUTHORITIES.find(([key]) => key === listing.authority)?.[2] ?? "listing_authority";
      try {
        // Already sent by an earlier pass of this message: reported, not submitted twice.
        await once(dependencies, key("submit"), async () => {
          await dependencies.submitListing(userId, business.professionalId!, business.committed.listingId!, { evidence: { type: (EVIDENCE_TYPES as readonly string[]).includes(type) ? type : "listing_authority", reference: body }, note: "Submitted on WhatsApp." });
          return { id: business.committed.listingId! };
        });
      } catch (error) {
        return say(`Not submitted yet: ${failure(error)}`);
      }
      return { state: reset(), reply: `Submitted for NesAfric review: ${listing.title}.\nYou will see it go live in your dashboard once it is approved: ${absoluteUrl("/pro")}\nEnquiries and viewing requests for it come to your NesAfric inbox.\n\nReply 5 to list another property, logo to change your logo, or menu.` };
    }

    // ---- Service businesses -------------------------------------------------------------------
    case "service_type": {
      if (/^(1|individual|me|myself|freelancer|self employed|self-employed)$/.test(command)) {
        const existing = await dependencies.existingProvider(userId, { type: "INDIVIDUAL" });
        if (existing) return { state: reset(), reply: alreadyProvider(existing) };
        business.providerType = "INDIVIDUAL";
        business.step = "service_name";
        return say();
      }
      if (/^(2|company|business|firm)$/.test(command)) {
        business.providerType = "COMPANY";
        business.choices = (await dependencies.companies(userId)).map(({ id, name }) => ({ id, name }));
        business.step = "service_company";
        return say();
      }
      return say();
    }
    case "service_company": {
      const index = /^\d$/.test(command) ? Number(command) - 1 : -1;
      const picked = business.choices[index];
      if (picked) {
        const existing = await dependencies.existingProvider(userId, { type: "COMPANY", companyOrganisationId: picked.id });
        if (existing) return { state: reset(), reply: alreadyProvider(existing) };
        business.companyOrganisationId = picked.id; business.companyName = picked.name;
      }
      else if (index === business.choices.length) return say("What is the new company called?");
      else {
        if (body.length < 2 || body.length > 160) return say("Please send a company name between 2 and 160 characters.");
        business.companyOrganisationId = undefined;
        business.companyName = body;
      }
      business.displayName = business.companyName;
      business.choices = [];
      business.step = "service_categories";
      return say(`Customers will see ${business.companyName}.`);
    }
    case "service_name": {
      const name = command === "me" ? linked.user.displayName : body;
      if (name.length < 2 || name.length > 200) return say("Please send a name between 2 and 200 characters.");
      business.displayName = name;
      business.choices = [];
      business.step = "service_categories";
      return say();
    }
    case "service_categories": {
      const picked = new Map(business.categories.map((category) => [category.id, category]));
      // Picking from the suggestions shown.
      if (business.choices.length && /^\d{1,2}(\s*,\s*\d{1,2})*$/.test(command)) {
        const chosen = command.split(",").map((part) => business.choices[Number(part.trim()) - 1]);
        if (chosen.some((choice) => !choice)) return say("Reply with numbers from the list.");
        for (const choice of chosen) picked.set(choice!.id, choice!);
        business.choices = [];
      } else {
        const categories = await dependencies.categories();
        const suggestions = new Map<string, { id: string; name: string }>();
        const unknown: string[] = [];
        for (const part of splitList(body)) {
          const matches = matchServiceCategories(part, categories);
          if (matches.length === 1) picked.set(matches[0].id, matches[0]);
          else if (matches.length) for (const match of matches.slice(0, 12)) suggestions.set(match.id, match);
          else unknown.push(part);
        }
        if (unknown.length) return say(`I could not match ${clip(unknown.join(", "), 300)} to a service. Try other words, for example plumbing, roofing, cleaning, solar, or land surveyors.`);
        business.choices = [...suggestions.values()].filter(({ id }) => !picked.has(id)).slice(0, 20);
      }
      if (picked.size > 10) return say("Choose up to 10 services.");
      business.categories = [...picked.values()];
      if (business.choices.length) return say();
      if (!business.categories.length) return say();
      business.step = "service_areas";
      return say(`Services: ${clip(business.categories.map(({ name }) => name).join(", "), 600)}.`);
    }
    case "service_areas": {
      const areas = splitList(body);
      if (!areas.length || areas.length > 20 || areas.some((area) => area.length < 2 || area.length > 120)) return say("Send 1 to 20 towns or areas separated by commas.");
      business.areas = areas;
      business.step = "service_description";
      return say();
    }
    case "service_description": {
      if (body.length > 5000) return say("Please keep it under 5,000 characters, or reply skip.");
      business.description = command === "skip" ? undefined : body;
      business.step = "service_review";
      return say();
    }
    case "service_review": {
      if (command !== "confirm") return say();
      try {
        if (business.providerType === "COMPANY" && !business.companyOrganisationId) {
          business.companyOrganisationId = business.committed.organisationId ?? (await once(dependencies, key("company"), () => dependencies.createCompany(userId, business.companyName!, input.defaultCountry)))!.id;
          business.committed.organisationId = business.companyOrganisationId;
        }
        if (!business.committed.providerId) {
          const provider = (await once(dependencies, key("provider"), () => dependencies.createProvider(userId, {
            type: business.providerType, companyOrganisationId: business.providerType === "COMPANY" ? business.companyOrganisationId : undefined,
            displayName: business.displayName, contactPhone: whatsappAddress(input.phone), biography: business.description,
            categoryIds: business.categories.map(({ id }) => id), serviceAreas: business.areas.map((name) => ({ areaType: "CITY", name })),
          })))!;
          business.committed.providerId = provider.id;
          business.committed.slug = provider.slug ?? undefined;
        }
        if (!business.committed.profileListed) {
          await dependencies.listProvider(userId, business.committed.providerId, {
            listed: true, publicDescription: business.description ?? null, categoryIds: business.categories.map(({ id }) => id),
            serviceAreas: business.areas.map((city) => ({ countryCode: input.defaultCountry, city })),
          });
          business.committed.profileListed = true;
        }
      } catch (error) {
        // Registered meanwhile (on the website, say): continuing would only repeat the conflict.
        if (error instanceof AppError && error.code === "PROVIDER_IDENTITY_EXISTS") {
          const existing = await dependencies.existingProvider(userId, business.providerType === "COMPANY" && business.companyOrganisationId ? { type: "COMPANY", companyOrganisationId: business.companyOrganisationId } : { type: "INDIVIDUAL" });
          return { state: reset(), reply: alreadyProvider(existing ?? { displayName: business.displayName ?? "This business", archivedAt: null }) };
        }
        return say(`Not finished: ${failure(error)}\nReply confirm to try again, or cancel.`);
      }
      business.target = { kind: "provider", id: business.committed.providerId, name: business.displayName ?? "your business" };
      business.step = "service_logo";
      return say(`${business.displayName} is registered.`);
    }
  }
  return say();
}

async function sendCode(business: BusinessState, input: BusinessInput, dependencies: BusinessDependencies) {
  business.step = "account_code";
  try {
    const sent = await dependencies.requestOtp({ mode: "register", channel: "sms", identifier: whatsappAddress(input.phone) });
    business.account.challengeId = sent.challengeId;
    business.account.failures = 0;
    return `To confirm this number I sent a 6-digit code by text message to ${sent.destination}. NesAfric staff will never ask you for it.`;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    // The code already sent stays valid: a refused resend (too soon, SMS down) must not discard it.
    return error.status === 429 ? `${error.message}` : "Text-message codes are unavailable right now. Your answers are saved; reply resend in a few minutes.";
  }
}

/** One provider per person and per company: an existing one is managed, not registered again. */
const alreadyProvider = (provider: { displayName: string; archivedAt: Date | null }) => provider.archivedAt
  ? `${provider.displayName} was registered as your service business before and is now archived, so a new one cannot be created. Contact ${BRAND.contact.support} to restore it.`
  : `${provider.displayName} is already registered as your service business on NesAfric. Reply logo to change its logo, or manage its services, areas and verification at ${absoluteUrl("/providers")}.`;

function agencyDone(business: BusinessState) {
  const profile = business.committed.slug ? absoluteUrl(`/marketplace/professionals/${business.committed.slug}`) : absoluteUrl("/pro");
  return [
    `${business.displayName} is set up on NesAfric.`,
    `• Public profile: ${profile}`,
    `• Get the verified badge by sending your business registration or licence at ${absoluteUrl("/pro")}. Until then the profile shows as unverified.`,
    "• Reply 5 to list a property now. Photos are sent right here.",
    "• Reply logo at any time to change your logo.",
  ].join("\n");
}

function serviceDone(business: BusinessState) {
  return [
    `${business.displayName} is listed on the NesAfric service marketplace.`,
    business.committed.slug ? `• Public profile: ${absoluteUrl(`/marketplace/services/${encodeURIComponent(business.committed.slug)}`)}` : null,
    `• Customers searching on WhatsApp see verified providers. Send your Ghana Card and trade certificates at ${absoluteUrl("/providers")} to get verified.`,
    "• Reply logo at any time to change your logo.",
  ].filter(Boolean).join("\n");
}
