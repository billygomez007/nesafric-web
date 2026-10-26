import { createHash } from "node:crypto";
import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { absoluteUrl } from "@/platform/brand";
import { getPublicListing, searchPublicListings } from "@/modules/listings/service";
import { discoverMarketplaceProviders } from "@/modules/marketplace/service";
import { createMaintenanceRequest } from "@/modules/maintenance/service";
import { maintenanceCategorySchema } from "@/modules/maintenance/schemas";
import { listUserTenancies } from "@/modules/tenants/self-service";
import { redeemTenantAccessCode } from "@/modules/tenants/access-invitations";
import { LISTING_PROPERTY_TYPES } from "@/lib/listing-options";
import { linkedWhatsAppUser } from "@/modules/whatsapp-assistant/identity";
import { submitCustomerRequest } from "@/modules/whatsapp-assistant/tools";
import { listingFlowChoices, startListingFromFlow } from "@/modules/whatsapp-assistant/business/listing";
import { REGISTRATION_FLOW_KINDS, startRegistrationFromFlow } from "@/modules/whatsapp-assistant/business/registration";
import { GHANA_REGIONS } from "@/modules/whatsapp-assistant/business/common";
import { findOpenDraft, saveDraft, startDraft } from "@/modules/whatsapp-assistant/onboarding/draft";
import { parseUnits } from "@/modules/whatsapp-assistant/onboarding/parse";
import { signOutcome, type FlowClaims } from "./token";
import type { FlowKey } from "./registry";

export type FlowRequest = { action: string; screen?: string; data: Record<string, unknown>; flowToken: string };
export type FlowResponse = { screen: string; data: Record<string, unknown> };
type Ctx = { claims: FlowClaims; token: string; linked: Awaited<ReturnType<typeof linkedWhatsAppUser>> };
type Handler = (request: FlowRequest, ctx: Ctx) => Promise<FlowResponse>;

const DAY = 24 * 60 * 60_000;
const clip = (value: string | null | undefined, max: number) => { const text = (value ?? "").replace(/\s+/g, " ").trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };
const field = (data: Record<string, unknown>, name: string, max = 2000) => typeof data[name] === "string" ? (data[name] as string).trim().slice(0, max) : "";
const option = (id: string, title: string, description?: string) => ({ id, title: clip(title, 30), ...(description ? { description: clip(description, 300) } : {}) });
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const REGIONS = GHANA_REGIONS.map((name) => option(name, name));
const SEARCH_TYPES = LISTING_PROPERTY_TYPES.map(([value, label]) => option(value, label));
const money = (minor: string | null, currency: string) => minor === null ? "Price on request" : `${currency} ${(BigInt(minor) / BigInt(100)).toLocaleString("en-GH")}`;
/** Idempotency for one Flow submission: the token's nonce and the action. */
const submissionId = (ctx: Ctx, action: string) => `flow:${ctx.claims.n}:${action}`;
const flowInput = (ctx: Ctx, action: string) => ({ address: ctx.claims.a, userId: ctx.linked!.user.id, messageId: submissionId(ctx, action), body: "", kind: "text" });

/** Ends the Flow on the endpoint; the signed outcome reaches the chat in the nfm_reply. */
function finish(ctx: Ctx, outcome: Record<string, string>): FlowResponse {
  return { screen: "SUCCESS", data: { extension_message_response: { params: { flow_token: ctx.token, ...outcome, receipt: signOutcome(ctx.token, outcome) } } } };
}
const notice = (message: string): FlowResponse => ({ screen: "NOTICE", data: { message } });
const invalid = (screen: string, data: Record<string, unknown>, message: string): FlowResponse => ({ screen, data: { ...data, error_message: message } });

// --- Property search ---------------------------------------------------------------------------

const searchScreen = (): FlowResponse => ({ screen: "SEARCH", data: { categories: SEARCH_TYPES, regions: REGIONS } });

const propertySearch: Handler = async (request, ctx) => {
  const data = request.data;
  if (request.action === "INIT") return searchScreen();
  if (data.action === "search") {
    const purpose = field(data, "purpose");
    const category = field(data, "category");
    const region = field(data, "region");
    const area = field(data, "area", 80);
    const budget = field(data, "max_budget", 15);
    const bedrooms = field(data, "bedrooms", 2);
    if (!["RENT", "SALE"].includes(purpose) || !GHANA_REGIONS.includes(region) || (category && !SEARCH_TYPES.some((item) => item.id === category))) return invalid("SEARCH", searchScreen().data, "Please choose rent or buy, and a region.");
    if (budget && !/^\d{1,12}$/.test(budget)) return invalid("SEARCH", searchScreen().data, "Enter the budget as a number in GHS, for example 4500.");
    if (bedrooms && !/^[1-5]$/.test(bedrooms)) return invalid("SEARCH", searchScreen().data, "Please choose the number of bedrooms from the list.");
    const filters = {
      listingType: purpose, region, country: "GH", currencyCode: "GHS",
      ...(category ? { category } : {}), ...(area.length >= 2 ? { location: area } : {}),
      ...(budget ? { maxPriceMinor: `${budget}00`, ...(purpose === "RENT" ? { frequency: "MONTHLY" } : {}) } : {}),
      ...(bedrooms ? { bedroomsMin: Number(bedrooms) } : {}),
    };
    const result = await searchPublicListings({ ...filters, page: 1, pageSize: 10 });
    if (!result.items.length) return invalid("SEARCH", searchScreen().data, "No published properties match these filters yet. Try another area, type or budget.");
    return {
      screen: "RESULTS",
      data: {
        summary: `${result.pagination.total ?? result.items.length} ${purpose === "RENT" ? "rental" : "sale"} ${result.items.length === 1 ? "property matches" : "properties match"}. Showing ${result.items.length}.`,
        results: result.items.map((item) => option(item.id, item.title, `${money(item.pricing.rentAmountMinor ?? item.pricing.askingAmountMinor, item.pricing.currencyCode)}${item.pricing.frequency ? ` / ${item.pricing.frequency.toLowerCase().replaceAll("_", " ")}` : ""} · ${item.location.label ?? [item.location.locality, item.location.city].filter(Boolean).join(", ")}`)),
        filters: JSON.stringify(filters),
      },
    };
  }
  if (data.action === "select" || data.action === "next") {
    const listingId = field(data, "listing", 40);
    // Any id the screen sends is checked against the published marketplace again.
    const listing = await getPublicListing(listingId).then((result) => result.listing).catch(() => null);
    if (!listing) return invalid("SEARCH", searchScreen().data, "That property is no longer available. Please search again.");
    const enquiries = listing.contact.enquiryEnabled && !listing.bookable;
    if (data.action === "next") {
      const next = field(data, "next", 20);
      if ((next === "book" || next === "inquire") && enquiries) return finish(ctx, { outcome: "open_flow", flow: next === "book" ? "nesafric_book_viewing" : "nesafric_property_inquiry", listing: listing.id });
      return invalid("DETAILS", {}, "Please choose what you would like to do.");
    }
    return {
      screen: "DETAILS",
      data: {
        listing_id: listing.id,
        title: clip(listing.title, 80),
        price: `${money(listing.pricing.rentAmountMinor ?? listing.pricing.askingAmountMinor, listing.pricing.currencyCode)}${listing.pricing.frequency ? ` / ${listing.pricing.frequency.toLowerCase().replaceAll("_", " ")}` : ""}`,
        location: clip(listing.location.label ?? [listing.location.locality, listing.location.city, listing.location.region].filter(Boolean).join(", "), 120) || "Ghana",
        features: [listing.attributes.bedrooms === null ? null : `${listing.attributes.bedrooms} bedrooms`, listing.attributes.bathrooms === null ? null : `${listing.attributes.bathrooms} bathrooms`, `Verification: ${listing.verification.status.toLowerCase()}`].filter(Boolean).join(" · "),
        description: `${clip(listing.description, 600)}\nMore photos: ${absoluteUrl(`/marketplace/properties/${listing.id}`)}`,
        // Without enquiries there is nothing to do here but go back (the header's back arrow).
        next_steps: enquiries ? [option("book", "Book a viewing"), option("inquire", "Ask a question")] : [option("none", "Viewings on the website only")],
      },
    };
  }
  return searchScreen();
};

// --- Book a viewing and ask about a property (the listing comes from the token only) ----------

async function boundListing(ctx: Ctx) {
  if (!ctx.claims.l) return null;
  const listing = await getPublicListing(ctx.claims.l).then((result) => result.listing).catch(() => null);
  return listing && listing.contact.enquiryEnabled && !listing.bookable ? listing : null;
}

const SLOT_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const slotLabel = (hour: number) => `${hour % 12 || 12}:00 ${hour < 12 ? "am" : "pm"}`;

/** Hours still open on `date` (Ghana is UTC+0): not past, and not an already confirmed viewing of this listing. */
async function openSlots(listingId: string, date: string, now = new Date()) {
  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return [];
  const taken = await db.viewingRequest.findMany({
    where: { listingId, status: { in: ["CONFIRMED", "RESCHEDULED"] }, confirmedStartsAt: { gte: start, lt: new Date(start.getTime() + DAY) } },
    select: { confirmedStartsAt: true, confirmedEndsAt: true },
  });
  return SLOT_HOURS.filter((hour) => {
    const slotStart = new Date(start.getTime() + hour * 60 * 60_000);
    const slotEnd = new Date(slotStart.getTime() + 60 * 60_000);
    if (slotStart.getTime() <= now.getTime() + 2 * 60 * 60_000) return false;
    return !taken.some(({ confirmedStartsAt, confirmedEndsAt }) => confirmedStartsAt! < slotEnd && (confirmedEndsAt ?? new Date(confirmedStartsAt!.getTime() + 60 * 60_000)) > slotStart);
  }).map((hour) => option(`${String(hour).padStart(2, "0")}:00`, slotLabel(hour)));
}

const bookingWindow = (now = new Date()) => ({ min: isoDate(new Date(now.getTime() + DAY)), max: isoDate(new Date(now.getTime() + 60 * DAY)) });

const bookViewing: Handler = async (request, ctx) => {
  const listing = await boundListing(ctx);
  if (!listing) return { screen: "DONE", data: { message: "This property is no longer taking viewing requests. Reply menu in the chat to search again." } };
  const window = bookingWindow();
  const base = { property: clip(listing.title, 80), min_date: window.min, max_date: window.max, name: ctx.linked?.user.displayName ?? "" };
  const data = request.data;
  const date = field(data, "date", 10);
  if (request.action === "INIT") return { screen: "BOOK", data: { ...base, slots: await openSlots(listing.id, window.min) } };
  if (data.action === "date") {
    const inWindow = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= window.min && date <= window.max;
    const slots = inWindow ? await openSlots(listing.id, date) : [];
    return slots.length ? { screen: "BOOK", data: { ...base, slots } } : invalid("BOOK", { ...base, slots: [option("none", "No times left")] }, "No viewing times are left on that day. Please choose another date.");
  }
  if (data.action !== "book") return { screen: "BOOK", data: { ...base, slots: await openSlots(listing.id, window.min) } };
  const slot = field(data, "slot", 5);
  const name = field(data, "name", 100);
  const note = field(data, "note", 500);
  if (!(/^\d{4}-\d{2}-\d{2}$/.test(date) && date >= window.min && date <= window.max)) return invalid("BOOK", { ...base, slots: await openSlots(listing.id, window.min) }, "Please choose a date between tomorrow and 60 days from now.");
  const slots = await openSlots(listing.id, date);
  // Availability is checked again at submission: the screen's options may be stale.
  if (!slots.some((item) => item.id === slot)) return invalid("BOOK", { ...base, slots: slots.length ? slots : [option("none", "No times left")] }, "That time is no longer available. Please choose another.");
  if (name.length < 2) return invalid("BOOK", { ...base, slots }, "Please enter your name.");
  // One open viewing request per number per property: a second one returns the first.
  const existing = await db.viewingRequest.findFirst({ where: { listingId: listing.id, status: { in: ["REQUESTED", "CONFIRMED", "RESCHEDULED"] }, lead: { phone: ctx.claims.a } }, select: { id: true } });
  if (existing) return finish(ctx, { outcome: "viewing_exists", reference: existing.id, listing: listing.id });
  const startsAt = new Date(`${date}T${slot}:00.000Z`);
  const request_ = await submitCustomerRequest({
    state: { workflow: "viewing", step: "confirm", selectedListingId: listing.id, name, message: note || undefined, startsAt: startsAt.toISOString() } as never,
    phone: ctx.claims.a, messageId: submissionId(ctx, "book"), conversationId: "whatsapp-flow",
  });
  return finish(ctx, { outcome: "viewing_requested", reference: request_.viewingId ?? request_.leadId, lead: request_.leadId, listing: listing.id });
};

const propertyInquiry: Handler = async (request, ctx) => {
  const listing = await boundListing(ctx);
  if (!listing) return { screen: "DONE", data: { message: "This property is no longer taking questions. Reply menu in the chat to search again." } };
  const base = { property: clip(listing.title, 80), name: ctx.linked?.user.displayName ?? "" };
  if (request.action === "INIT" || request.data.action !== "send") return { screen: "INQUIRY", data: base };
  const name = field(request.data, "name", 100);
  const message = field(request.data, "message", 2000);
  if (name.length < 2) return invalid("INQUIRY", base, "Please enter your name.");
  if (message.length < 3) return invalid("INQUIRY", base, "Please write your question.");
  const result = await submitCustomerRequest({
    state: { workflow: "inquiry", step: "confirm", selectedListingId: listing.id, name, message } as never,
    phone: ctx.claims.a, messageId: submissionId(ctx, "send"), conversationId: "whatsapp-flow",
  });
  return finish(ctx, { outcome: "inquiry_sent", reference: result.leadId, lead: result.leadId, listing: listing.id });
};

// --- List a property (linked account; the chat's listing steps validate every answer) ---------

const listProperty: Handler = async (request, ctx) => {
  if (!ctx.linked) return notice("To list a property, first connect this WhatsApp number to your NesAfric account: reply link in the chat.");
  const data = request.data;
  const picked = { business: field(data, "business", 3), purpose: field(data, "purpose", 4), category: field(data, "category", 3) };
  const choices = await listingFlowChoices(ctx.linked.user.id, picked);
  if (!choices.hasBusinesses) return notice("To list a property, register first: reply register agency, register agent, or register (landlords) in the chat.");
  const basics = { businesses: choices.businesses, properties: choices.properties.length ? choices.properties : [option("0", "Not needed")], categories: choices.categories, regions: REGIONS };
  const carriedBasics = Object.fromEntries(["business", "property", "purpose", "category", "title", "region", "city", "locality"].map((name) => [name, field(data, name, 300)]));
  const pricingNames = ["price", "price_unit", "bedrooms", "bathrooms", "furnishing", "size", "land_size", "amenities", "description"];
  if (request.action === "INIT" || data.action === "restart") return { screen: "BASICS", data: basics };
  if (data.action === "basics") {
    if (!["RENT", "SALE"].includes(picked.purpose) || !choices.categories.some((item) => item.id === picked.category) || !GHANA_REGIONS.includes(carriedBasics.region)) return invalid("BASICS", basics, "Please choose rent or sale, the property type and the region.");
    if (choices.isLandlord && !choices.properties.some((item) => item.id === carriedBasics.property)) return invalid("BASICS", basics, "Please choose which of your properties this listing is for.");
    return { screen: "PRICING", data: { units: choices.units.length ? choices.units : [option("0", "Not needed")], furnishing_options: choices.furnishing, amenity_options: choices.amenities, ...carriedBasics } };
  }
  const carriedPricing = Object.fromEntries(pricingNames.map((name) => [name, Array.isArray(data[name]) ? (data[name] as unknown[]).filter((item) => typeof item === "string").join(",") : field(data, name, 2000)]));
  if (data.action === "pricing") return { screen: "AUTHORITY", data: { authorities: choices.authorities, evidence_types: choices.evidenceTypes, ...carriedBasics, ...carriedPricing } };
  if (data.action !== "save") return { screen: "BASICS", data: basics };
  const value = (name: string) => carriedBasics[name] ?? carriedPricing[name] ?? field(data, name, 2000);
  const orSkip = (name: string) => value(name) || "skip";
  const answers: Record<string, string> = {
    ...(choices.businesses.length > 1 ? { business: value("business") } : {}),
    ...(choices.isLandlord ? { property: value("property") } : {}),
    purpose: value("purpose") === "SALE" ? "sale" : "rent", category: value("category"), title: value("title"), region: value("region"), city: value("city"), locality: orSkip("locality"),
    price: value("price"), price_unit: value("price_unit"), bedrooms: value("bedrooms"), bathrooms: value("bathrooms"), furnishing: orSkip("furnishing"),
    size: orSkip("size"), land_size: value("land_size"), amenities: orSkip("amenities"), description: value("description"),
    authority: field(data, "authority", 3), evidence_type: field(data, "evidence_type", 3), evidence_reference: field(data, "evidence_reference", 500),
  };
  const started = await startListingFromFlow(flowInput(ctx, "save"), answers);
  if ("error" in started) return invalid("AUTHORITY", { authorities: choices.authorities, evidence_types: choices.evidenceTypes, ...carriedBasics, ...carriedPricing }, started.error);
  return finish(ctx, { outcome: "draft", draft: started.draftId, kind: "listing" });
};

// --- Agent and agency registration --------------------------------------------------------------

const agentRegistration: Handler = async (request, ctx) => {
  if (!ctx.linked) return notice("To register, first connect this WhatsApp number to your NesAfric account: reply link in the chat.");
  const base = { kinds: REGISTRATION_FLOW_KINDS, regions: REGIONS };
  if (request.action === "INIT" || request.data.action !== "save") return { screen: "PROFILE", data: base };
  const data = request.data;
  const orSkip = (name: string, max: number) => field(data, name, max) || "skip";
  const started = await startRegistrationFromFlow(flowInput(ctx, "save"), field(data, "kind", 20), {
    name: field(data, "name", 200), legal_name: orSkip("legal_name", 300), email: orSkip("email", 320), region: field(data, "region", 100), city: field(data, "city", 150),
    description: field(data, "description", 2000), service_areas: field(data, "areas", 400), reference: orSkip("reference", 300),
  });
  if ("error" in started) return invalid("PROFILE", base, started.error);
  return finish(ctx, { outcome: "draft", draft: started.draftId, kind: "registration" });
};

// --- Landlord sign-up: the first property, then the chat onboarding continues -------------------

const landlordRegistration: Handler = async (request, ctx) => {
  if (!ctx.linked) return notice("To set up your properties, reply register in the chat: it creates your account and confirms this number first.");
  if (request.action === "INIT" || request.data.action !== "save") return { screen: "SETUP", data: {} };
  const data = request.data;
  const role = field(data, "role", 10);
  const organisation = field(data, "organisation", 160);
  const property = field(data, "property", 200);
  const city = field(data, "city", 100);
  const address = field(data, "address", 250);
  if (!["LANDLORD", "MANAGER"].includes(role) || organisation.length < 2 || property.length < 2 || city.length < 2) return invalid("SETUP", {}, "Please fill in your role, the name to manage under, the property and its town.");
  const units = parseUnits(field(data, "units", 400), "Unit ");
  if (units.errors.length || !units.units.length) return invalid("SETUP", {}, `Units: ${units.errors[0]?.reason ?? "send a number such as 4, or names such as A1, A2"}.`);
  if (await findOpenDraft(ctx.claims.a)) return invalid("SETUP", {}, "You already have a sign-up in progress. Reply resume in the chat to continue it.");
  const draft = await startDraft(ctx.claims.a, ctx.linked.user.id, { countryCode: "GH", currencyCode: "GHS" });
  draft.userId = ctx.linked.user.id;
  draft.data = { ...draft.data, role: role as "LANDLORD" | "MANAGER", displayName: clip(ctx.linked.user.displayName, 100), organisationName: organisation, properties: [{ name: property, city, ...(address ? { addressLine1: address } : {}), buildings: [{ name: null, units: units.units }] }], cursor: { property: 0, building: 0 } };
  draft.step = "more_properties";
  const saved = await saveDraft(draft, submissionId(ctx, "save"));
  return finish(ctx, { outcome: "onboarding", draft: saved.id });
};

// --- Tenants: connect a tenancy, report a problem -------------------------------------------------

const tenantRegistration: Handler = async (request, ctx) => {
  if (!ctx.linked) return notice("First confirm this number: reply link in the chat. Then open this form again to enter your tenant access code.");
  if (request.action === "INIT" || request.data.action !== "redeem") return { screen: "CONNECT", data: {} };
  const code = field(request.data, "code", 40);
  try {
    await redeemTenantAccessCode(ctx.linked.user.id, code);
  } catch (error) {
    if (error instanceof AppError && error.status < 500) return invalid("CONNECT", {}, "That access code is not valid, has expired or was already used. Ask your landlord for a new one.");
    throw error;
  }
  return finish(ctx, { outcome: "tenancy_connected" });
};

async function tenancyOptions(userId: string) {
  const tenancies = await listUserTenancies(userId, { forRepairs: true });
  return tenancies.flatMap((tenancy) => tenancy.leases.map((lease) => ({ tenantOrganisationId: tenancy.tenantOrganisationId, organisationId: tenancy.organisation.id, propertyId: lease.property.id, unitId: lease.unit?.id, label: `${lease.property.name}${lease.unit ? `, ${lease.unit.name}` : ""}`, landlord: tenancy.organisation.name }))).slice(0, 20);
}
const MAINTENANCE_CATEGORIES = maintenanceCategorySchema.options.map((value) => option(value, value.charAt(0).toUpperCase() + value.slice(1)));

const maintenanceRequest: Handler = async (request, ctx) => {
  if (!ctx.linked) return notice("To report a problem, first connect this number: reply link in the chat.");
  const tenancies = await tenancyOptions(ctx.linked.user.id);
  if (!tenancies.length) return notice("No tenancy is connected to this number yet. If your landlord gave you an access code (it starts with NT-), send it in the chat.");
  const base = { tenancies: tenancies.map((item, index) => option(String(index + 1), item.label, item.landlord)), categories: MAINTENANCE_CATEGORIES };
  if (request.action === "INIT" || request.data.action !== "report") return { screen: "REPORT", data: base };
  const data = request.data;
  const choice = tenancies[Number(field(data, "tenancy", 3)) - 1];
  const category = maintenanceCategorySchema.safeParse(field(data, "category", 40));
  const priority = field(data, "priority", 10);
  const title = field(data, "title", 120);
  const description = field(data, "description", 2000);
  if (!choice || !category.success || !["EMERGENCY", "URGENT", "NORMAL", "LOW"].includes(priority)) return invalid("REPORT", base, "Please choose the property, the type of problem and how urgent it is.");
  if (title.length < 3 || description.length < 3) return invalid("REPORT", base, "Please add a short title and describe the problem.");
  // The tenancy is re-checked by the maintenance service; the reference makes a retry return the first request.
  const created = await createMaintenanceRequest(ctx.linked.user.id, choice.organisationId, {
    propertyId: choice.propertyId, unitId: choice.unitId, tenantOrganisationId: choice.tenantOrganisationId, title, description, category: category.data,
    priority, intakeChannel: "WHATSAPP", originalReport: description, intakeReference: submissionId(ctx, "report"),
  }) as { id: string; referenceNumber?: string | null };
  return finish(ctx, { outcome: "maintenance_reported", reference: created.referenceNumber ?? created.id });
};

// --- Professionals and services ---------------------------------------------------------------

const findProfessional: Handler = async (request) => {
  const data = request.data;
  if (request.action === "INIT") return { screen: "SEARCH", data: {} };
  if (data.action === "search") {
    const service = field(data, "service", 80);
    const area = field(data, "area", 80);
    if (service.length < 2 || area.length < 2) return invalid("SEARCH", {}, "Please enter the service and the area.");
    const result = await discoverMarketplaceProviders({ q: `${service} ${area}`, verification: "VERIFIED", page: 1, pageSize: 10 });
    if (!result.items.length) return invalid("SEARCH", {}, `No verified providers match "${clip(service, 40)}" in ${clip(area, 40)} yet. Try a nearby town or another word for the service.`);
    return { screen: "RESULTS", data: { summary: `${result.items.length} verified ${result.items.length === 1 ? "provider" : "providers"} found.`, results: result.items.map((item) => option(item.id, item.displayName, item.categories.map(({ name }) => name).join(", "))) } };
  }
  if (data.action === "select") {
    const id = field(data, "provider", 40);
    const provider = /^[0-9a-f-]{36}$/i.test(id) ? await db.serviceProvider.findFirst({ where: { id, verificationStatus: "VERIFIED", suspendedAt: null }, select: { displayName: true, slug: true, id: true } }) : null;
    if (!provider) return invalid("SEARCH", {}, "That provider is no longer listed. Please search again.");
    return { screen: "DONE", data: { message: `${provider.displayName}: open the profile to contact them or request a quote securely: ${absoluteUrl(provider.slug ? `/marketplace/services/${encodeURIComponent(provider.slug)}` : `/marketplace/${provider.id}`)}` } };
  }
  return { screen: "SEARCH", data: {} };
};

const bookService: Handler = async (request, ctx) => {
  const categories = (await db.serviceCategory.findMany({ where: { active: true, onboardingSelectable: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take: 50, select: { id: true, name: true } })).map((item) => option(item.id, item.name));
  const window = bookingWindow();
  const base = { categories: categories.length ? categories : [option("other", "Other service")], min_date: window.min, max_date: window.max, name: ctx.linked?.user.displayName ?? "" };
  if (request.action === "INIT" || request.data.action !== "request") return { screen: "REQUEST", data: base };
  const data = request.data;
  const category = base.categories.find((item) => item.id === field(data, "category", 40));
  const area = field(data, "area", 100);
  const description = field(data, "description", 2000);
  const date = field(data, "date", 10);
  const name = field(data, "name", 100);
  if (!category || area.length < 2 || description.length < 10 || name.length < 2) return invalid("REQUEST", base, "Please choose the service, and add the area, your name and a short description of the job.");
  if (date && !(/^\d{4}-\d{2}-\d{2}$/.test(date) && date >= window.min && date <= window.max)) return invalid("REQUEST", base, "Please choose a date in the next 60 days, or leave it empty.");
  return finish(ctx, { outcome: "support", topic: "SERVICE_REQUEST", summary: clip(`Service request from ${name}: ${category.title} in ${area}${date ? ` on ${date}` : ""}. ${description}`, 900) });
};

// --- Landlord portfolio menu and support --------------------------------------------------------

const MANAGEMENT_TASKS = [
  option("account", "See my portfolio", "Properties, units, tenants and leases"),
  option("register", "Add a property", "Add more properties, units and tenants"),
  option("list a property", "List a vacant unit", "Advertise a property or unit on NesAfric"),
  option("providers", "My maintenance pros", "Your network of professionals"),
];

const propertyManagement: Handler = async (request, ctx) => {
  if (!ctx.linked) return notice("To manage properties here, reply register in the chat first.");
  const organisations = await db.organisation.findMany({ where: { archivedAt: null, marketplaceProfessional: { is: null }, members: { some: { userId: ctx.linked.user.id, status: "ACTIVE", archivedAt: null } }, properties: { some: { archivedAt: null } } }, select: { id: true, name: true }, take: 5 });
  if (!organisations.length) return notice("You have no properties on NesAfric yet. Reply register in the chat to add them.");
  const [properties, units, tenants] = await Promise.all([
    db.property.count({ where: { organisationId: { in: organisations.map(({ id }) => id) }, archivedAt: null } }),
    db.unit.count({ where: { property: { organisationId: { in: organisations.map(({ id }) => id) }, archivedAt: null }, archivedAt: null } }),
    db.tenantOrganisation.count({ where: { organisationId: { in: organisations.map(({ id }) => id) }, archivedAt: null } }),
  ]);
  const summary = `${organisations.map(({ name }) => name).join(", ")}: ${properties} ${properties === 1 ? "property" : "properties"}, ${units} ${units === 1 ? "unit" : "units"}, ${tenants} ${tenants === 1 ? "tenant" : "tenants"}.`;
  if (request.action === "INIT" || request.data.action !== "choose") return { screen: "MENU", data: { summary, actions: MANAGEMENT_TASKS } };
  const task = MANAGEMENT_TASKS.find((item) => item.id === field(request.data, "task", 40));
  if (!task) return invalid("MENU", { summary, actions: MANAGEMENT_TASKS }, "Please choose what you would like to do.");
  return finish(ctx, { outcome: "command", command: task.id });
};

const helpSupport: Handler = async (request, ctx) => {
  if (request.action === "INIT" || request.data.action !== "send") return { screen: "HELP", data: {} };
  const topic = field(request.data, "topic", 20);
  const message = field(request.data, "message", 2000);
  if (!["ACCOUNT", "LISTING", "TENANCY", "PAYMENT", "OTHER"].includes(topic) || message.length < 3) return invalid("HELP", {}, "Please choose a topic and tell us more.");
  return finish(ctx, { outcome: "support", topic, summary: clip(message, 900) });
};

export const FLOW_HANDLERS: Record<FlowKey, Handler> = {
  nesafric_property_search: propertySearch,
  nesafric_book_viewing: bookViewing,
  nesafric_property_inquiry: propertyInquiry,
  nesafric_list_property: listProperty,
  nesafric_agent_registration: agentRegistration,
  nesafric_landlord_registration: landlordRegistration,
  nesafric_tenant_registration: tenantRegistration,
  nesafric_maintenance_request: maintenanceRequest,
  nesafric_find_professional: findProfessional,
  nesafric_book_service: bookService,
  nesafric_property_management: propertyManagement,
  nesafric_help_support: helpSupport,
};

export const flowLog = (event: string, fields: Record<string, unknown>) => console.info(JSON.stringify({ event, ...fields }));
export const submissionHash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);
