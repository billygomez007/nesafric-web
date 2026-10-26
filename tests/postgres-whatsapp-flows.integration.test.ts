import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createListing, transitionListing, updateListingVerification } from "@/modules/listings/service";
import { createTenant } from "@/modules/tenants/service";
import { createTenantAccessInvitation } from "@/modules/tenants/access-invitations";
import { createMarketplaceProfessional } from "@/modules/marketplace-professionals/service";
import { linkWhatsAppIdentity } from "@/modules/whatsapp-assistant/identity";
import { handleFlowsRequest } from "@/modules/whatsapp-flows/endpoint";
import { issueFlowToken } from "@/modules/whatsapp-flows/token";
import type { FlowKey } from "@/modules/whatsapp-flows/registry";
import { completeFlow } from "@/modules/whatsapp-flows/completion";
import { initialState } from "@/modules/whatsapp-assistant/schemas";
import { db } from "@/platform/database/client";
import { createLease } from "./helpers/lease";
import { flowsClient, flowsKeyPair } from "./helpers/whatsapp-flows";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

const PHONE = "+233241234567";
const keys = flowsKeyPair();
const client = flowsClient(keys.publicKey, "flows-app-secret");
let official = "";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge", "WhatsAppFlowDraft", "OnboardingDraft" CASCADE');
  await db.tenant.deleteMany();
}

/** One encrypted data-exchange round trip, as the WhatsApp client sends it. */
async function exchange(token: string, action: string, screen?: string, data: Record<string, unknown> = {}) {
  const request = client.request({ version: "3.0", action, screen, data, flow_token: token });
  const result = await handleFlowsRequest(request.raw, request.signature, { ...process.env, WHATSAPP_APP_SECRET: "flows-app-secret", WHATSAPP_FLOWS_PRIVATE_KEY: keys.privateKey, WHATSAPP_OFFICIAL_ORGANISATION_ID: official });
  expect(result.status).toBe(200);
  return request.decrypt(result.body);
}
const token = (flow: FlowKey, extra: { listingId?: string } = {}) => issueFlowToken({ flow, address: PHONE, organisationId: official, ...extra });
const outcomeOf = (response: { data: Record<string, unknown> }) => (response.data.extension_message_response as { params: Record<string, string> }).params;
const finish = (response: { data: Record<string, unknown> }) => completeFlow({ phone: PHONE, organisationId: official, flowResponse: JSON.stringify(outcomeOf(response)) }, initialState(), () => initialState());

async function publishedListing(title = "3-bedroom house in Spintex") {
  const owner = await registerUser({ displayName: "Abena Agyei", email: `owner-${Math.random()}@flows.test`, password: "secure-password-123" });
  const organisation = await createOrganisation(owner.id, { name: "Agyei Lettings", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
  const property = await createProperty(owner.id, organisation.id, { name: "Spintex Villa", referenceNumber: `SV-${Math.random()}`, category: "Residential", countryCode: "GH", currencyCode: "GHS" });
  const listing = await createListing(owner.id, organisation.id, {
    propertyId: property.id, listingType: "RENT", category: "HOUSE", title, publicDescription: "A family house close to the main road.",
    rentAmountMinor: "450000", currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-11-01", countryCode: "GH", region: "Greater Accra", city: "Accra", locality: "Spintex", enquiryEnabled: true, bedrooms: 3, bathrooms: 2,
    media: [{ type: "PHOTO", publicUrl: "https://cdn.example.com/listing/photo.jpg", mimeType: "image/jpeg", sortOrder: 1 }],
  });
  await updateListingVerification(owner.id, organisation.id, listing.id, { status: "PENDING", evidence: [{ type: "OWNERSHIP_OR_AUTHORITY", privateReference: "private/evidence/deed.pdf", metadata: {} }] });
  await updateListingVerification(owner.id, organisation.id, listing.id, { status: "VERIFIED", note: "Checked." });
  await transitionListing(owner.id, organisation.id, listing.id, { status: "PENDING_REVIEW" });
  await transitionListing(owner.id, organisation.id, listing.id, { status: "PUBLISHED" });
  return { owner, organisation, listing };
}

async function linked(email = "kofi@flows.test") {
  const user = await registerUser({ displayName: "Kofi Mensah", email, password: "secure-password-123" });
  const organisation = await createOrganisation(user.id, { name: "Kofi personal", type: "OTHER", countryCode: "GH" });
  await linkWhatsAppIdentity(PHONE.slice(1), user.id, "SMS_OTP", organisation.id);
  return { user, organisation };
}

describe("PostgreSQL WhatsApp Flows", () => {
  beforeEach(async () => {
    await cleanDatabase();
    const staff = await registerUser({ displayName: "NesAfric", email: "support@flows.test", password: "secure-password-123" });
    official = (await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" })).id;
    vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official);
    vi.stubEnv("WHATSAPP_FLOW_IDS", JSON.stringify({ nesafric_book_viewing: "947132434820601", nesafric_property_inquiry: "1421839692827883" }));
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => { await cleanDatabase(); await db.$disconnect(); });

  it("searches published properties, shows details from the database, and hands over to the viewing form", async () => {
    const { listing } = await publishedListing();
    const search = token("nesafric_property_search");
    const first = await exchange(search, "INIT");
    expect(first.screen).toBe("SEARCH");
    expect((first.data.regions as unknown[]).length).toBe(16);
    const results = await exchange(search, "data_exchange", "SEARCH", { action: "search", purpose: "RENT", region: "Greater Accra", category: "HOUSE", max_budget: "5000" });
    expect(results.screen).toBe("RESULTS");
    expect(results.data.results).toEqual([expect.objectContaining({ id: listing.id, title: "3-bedroom house in Spintex", description: expect.stringContaining("GHS 4,500") })]);
    expect((await exchange(search, "data_exchange", "SEARCH", { action: "search", purpose: "SALE", region: "Ashanti" })).data.error_message).toContain("No published properties");
    expect((await exchange(search, "data_exchange", "SEARCH", { action: "search", purpose: "RENT", region: "Atlantis" })).data.error_message).toBeTruthy();
    const details = await exchange(search, "data_exchange", "RESULTS", { action: "select", listing: listing.id });
    expect(details.data).toMatchObject({ listing_id: listing.id, price: "GHS 4,500 / monthly" });
    // An id the person did not get from NesAfric (or an unpublished one) shows nothing.
    expect((await exchange(search, "data_exchange", "RESULTS", { action: "select", listing: "00000000-0000-4000-8000-000000000000" })).data.error_message).toContain("no longer available");
    const handOver = await exchange(search, "data_exchange", "DETAILS", { action: "next", listing: listing.id, next: "book" });
    expect(handOver.screen).toBe("SUCCESS");
    const chat = await finish(handOver);
    expect(chat.interactive).toMatchObject({ type: "flow", flowId: "947132434820601" });
  });

  it("searches when WhatsApp leaves the step out of the payload, as it does live", async () => {
    const { listing } = await publishedListing();
    const search = token("nesafric_property_search");
    const results = await exchange(search, "data_exchange", "SEARCH", { purpose: "RENT", region: "Greater Accra", category: "", area: "", max_budget: "", bedrooms: "" });
    expect(results.screen).toBe("RESULTS");
    expect(results.data.results).toEqual([expect.objectContaining({ id: listing.id })]);
    expect((await exchange(search, "data_exchange", "RESULTS", { listing: listing.id, filters: "{}" })).screen).toBe("DETAILS");
    expect((await exchange(search, "data_exchange", "DETAILS", { listing: listing.id, next: "book" })).screen).toBe("SUCCESS");
  });

  it("shows the photos and books a viewing or sends a question without leaving the search form", async () => {
    const { listing } = await publishedListing();
    const photo = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#2a6" } }).jpeg().toBuffer();
    const fetched: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { fetched.push(String(url)); return new Response(new Uint8Array(photo)); }));
    const search = token("nesafric_property_search");
    const details = await exchange(search, "data_exchange", "RESULTS", { listing: listing.id, filters: "{}" });
    vi.unstubAllGlobals();
    expect(fetched).toEqual(["https://cdn.example.com/listing/photo.jpg"]);
    expect(details.data).toMatchObject({ listing_id: listing.id, has_photo_1: true, has_photo_2: false, has_photo_3: false, next_steps: [{ id: "book", title: "Book a viewing" }, { id: "inquire", title: "Ask a question" }] });
    const size = await sharp(Buffer.from(details.data.photo_1 as string, "base64")).metadata();
    expect([size.format, size.width, size.height]).toEqual(["jpeg", 640, 480]);

    // Version 2 of the form continues on its own screens (WhatsApp leaves the step out, as live).
    const viewing = await exchange(search, "data_exchange", "DETAILS", { listing: listing.id, next: "book", form_version: "2" });
    expect(viewing).toMatchObject({ screen: "VIEWING", data: { listing_id: listing.id, property: "3-bedroom house in Spintex" } });
    const date = viewing.data.min_date as string;
    const slots = await exchange(search, "data_exchange", "VIEWING", { date, listing: listing.id, form_version: "2" });
    expect(slots.screen).toBe("VIEWING");
    const booked = await exchange(search, "data_exchange", "VIEWING", { date, slot: "14:00", name: "Ama Owusu", note: "", listing: listing.id, form_version: "2" });
    expect(outcomeOf(booked)).toMatchObject({ outcome: "viewing_requested", listing: listing.id });
    expect(await db.viewingRequest.count({ where: { listingId: listing.id, lead: { phone: PHONE } } })).toBe(1);
    expect((await finish(booked)).reply).toContain("Viewing request saved");

    const question = await exchange(search, "data_exchange", "DETAILS", { listing: listing.id, next: "inquire", form_version: "2" });
    expect(question.screen).toBe("QUESTION");
    expect((await exchange(search, "data_exchange", "QUESTION", { name: "Ama Owusu", message: "", listing: listing.id, form_version: "2" })).data.error_message).toContain("write your question");
    const sent = await exchange(search, "data_exchange", "QUESTION", { name: "Ama Owusu", message: "Is parking included?", listing: listing.id, form_version: "2" });
    expect(outcomeOf(sent)).toMatchObject({ outcome: "inquiry_sent", listing: listing.id });
    // A forged listing id never reaches a request.
    expect((await exchange(search, "data_exchange", "QUESTION", { name: "Ama", message: "Hello there", listing: "00000000-0000-4000-8000-000000000000", form_version: "2" })).data.error_message).toContain("no longer available");
  });

  it("requests a short stay inside the search form, with the website's rules", async () => {
    const { user } = await linked();
    const owner = await registerUser({ displayName: "Esi Host", email: "host@flows.test", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Esi Stays", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const property = await createProperty(owner.id, organisation.id, { name: "Osu Loft", referenceNumber: "OL-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const listing = await createListing(owner.id, organisation.id, {
      propertyId: property.id, listingType: "RENT", category: "SHORT_STAY", title: "Osu loft for short stays", publicDescription: "A bright loft near Oxford Street.",
      rentAmountMinor: "60000", currencyCode: "GHS", frequency: "PER_NIGHT", availableFrom: "2026-10-01", countryCode: "GH", region: "Greater Accra", city: "Accra", locality: "Osu", enquiryEnabled: true, bedrooms: 1, bathrooms: 1, maxGuests: 3, minimumNights: 2,
      media: [{ type: "PHOTO", publicUrl: "https://cdn.example.com/listing/loft.jpg", mimeType: "image/jpeg", sortOrder: 1 }],
    });
    await updateListingVerification(owner.id, organisation.id, listing.id, { status: "PENDING", evidence: [{ type: "OWNERSHIP_OR_AUTHORITY", privateReference: "private/evidence/lease.pdf", metadata: {} }] });
    await updateListingVerification(owner.id, organisation.id, listing.id, { status: "VERIFIED", note: "Checked." });
    await transitionListing(owner.id, organisation.id, listing.id, { status: "PENDING_REVIEW" });
    await transitionListing(owner.id, organisation.id, listing.id, { status: "PUBLISHED" });

    const search = token("nesafric_property_search");
    // A photo that cannot be fetched is left out; the property still shows.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    const details = await exchange(search, "data_exchange", "RESULTS", { listing: listing.id, filters: "{}" });
    vi.unstubAllGlobals();
    expect(details.data).toMatchObject({ has_photo_1: false, next_steps: [{ id: "stay", title: "Book a stay" }] });
    const stay = await exchange(search, "data_exchange", "DETAILS", { listing: listing.id, next: "stay", form_version: "2" });
    expect(stay).toMatchObject({ screen: "STAY", data: { name: "Kofi Mensah", email: user.email } });
    expect((stay.data.adults as unknown[]).length).toBe(3);
    const day = (offset: number) => new Date(Date.now() + offset * 24 * 60 * 60_000).toISOString().slice(0, 10);
    const form = { check_in: day(10), check_out: day(11), adults: "2", children: "", name: "Kofi Mensah", email: user.email, note: "Late arrival", listing: listing.id, form_version: "2" };
    expect((await exchange(search, "data_exchange", "STAY", form)).data.error_message).toContain("2-night minimum");
    expect((await exchange(search, "data_exchange", "STAY", { ...form, check_out: day(12), adults: "3", children: "1" })).data.error_message).toContain("up to 3 guests");
    expect((await exchange(search, "data_exchange", "STAY", { ...form, check_out: day(12), email: "not-an-email" })).data.error_message).toContain("valid email");
    const requested = await exchange(search, "data_exchange", "STAY", { ...form, check_out: day(12) });
    const outcome = outcomeOf(requested);
    expect(outcome).toMatchObject({ outcome: "stay_requested", listing: listing.id, check_in: day(10), check_out: day(12) });
    // A retried submission returns the same booking.
    await exchange(search, "data_exchange", "STAY", { ...form, check_out: day(12) });
    const bookings = await db.accommodationBooking.findMany({ where: { listingId: listing.id } });
    expect(bookings.map((booking) => [booking.reference, booking.nights, booking.adults, booking.guestPhone, booking.userId, booking.specialRequest])).toEqual([[outcome.reference, 2, 2, PHONE, user.id, "Late arrival"]]);
    expect((await finish(requested)).reply).toContain(`Reference: ${outcome.reference}`);
    // A stay is never booked through the viewing screens, nor a viewing on a stay.
    expect((await exchange(search, "data_exchange", "DETAILS", { listing: listing.id, next: "book", form_version: "2" })).data.error_message).toBeTruthy();
  });

  it("books a viewing only in an open slot, once per number and property", async () => {
    const { owner, organisation, listing } = await publishedListing();
    const booking = token("nesafric_book_viewing", { listingId: listing.id });
    const start = await exchange(booking, "INIT");
    expect(start.screen).toBe("BOOK");
    const date = start.data.min_date as string;
    expect((start.data.slots as Array<{ id: string }>).map(({ id }) => id)).toContain("10:00");
    // Another buyer's confirmed viewing takes 10:00 on that day.
    const other = await db.marketplaceLead.create({ data: { organisationId: organisation.id, listingId: listing.id, name: "Other buyer", phone: "+233200000001", source: "WEBSITE" } });
    await db.viewingRequest.create({ data: { organisationId: organisation.id, listingId: listing.id, leadId: other.id, status: "CONFIRMED", confirmedStartsAt: new Date(`${date}T10:00:00.000Z`), confirmedEndsAt: new Date(`${date}T11:00:00.000Z`), createdByUserId: owner.id } });
    const slots = await exchange(booking, "data_exchange", "BOOK", { action: "date", date });
    expect((slots.data.slots as Array<{ id: string }>).map(({ id }) => id)).not.toContain("10:00");
    const taken = await exchange(booking, "data_exchange", "BOOK", { action: "book", date, slot: "10:00", name: "Ama Owusu" });
    expect(taken.data.error_message).toContain("no longer available");
    const booked = await exchange(booking, "data_exchange", "BOOK", { action: "book", date, slot: "14:00", name: "Ama Owusu", note: "After work please" });
    const outcome = outcomeOf(booked);
    expect(outcome.outcome).toBe("viewing_requested");
    const viewing = await db.viewingRequest.findUniqueOrThrow({ where: { id: outcome.reference }, include: { preferredTimes: true, lead: true } });
    expect([viewing.status, viewing.lead.phone, viewing.lead.source, viewing.preferredTimes[0].startsAt.toISOString()]).toEqual(["REQUESTED", PHONE, "WHATSAPP", `${date}T14:00:00.000Z`]);
    // The same submission again (a retry) creates nothing new; a second booking returns the first.
    await exchange(booking, "data_exchange", "BOOK", { action: "book", date, slot: "14:00", name: "Ama Owusu", note: "After work please" });
    const again = await exchange(token("nesafric_book_viewing", { listingId: listing.id }), "data_exchange", "BOOK", { action: "book", date, slot: "15:00", name: "Ama Owusu" });
    expect(outcomeOf(again)).toMatchObject({ outcome: "viewing_exists", reference: viewing.id });
    expect(await db.viewingRequest.count({ where: { lead: { phone: PHONE } } })).toBe(1);
    const chat = await finish(booked);
    expect(chat.reply).toContain(`Reference: ${viewing.id}`);
    expect(chat.state.lastRequest).toMatchObject({ viewingId: viewing.id, listingId: listing.id });
  });

  it("refuses a viewing outside the booking window and on a listing that is no longer published", async () => {
    const { owner, organisation, listing } = await publishedListing();
    const booking = token("nesafric_book_viewing", { listingId: listing.id });
    expect((await exchange(booking, "data_exchange", "BOOK", { action: "book", date: "2020-01-01", slot: "10:00", name: "Ama" })).data.error_message).toContain("between tomorrow");
    await transitionListing(owner.id, organisation.id, listing.id, { status: "ARCHIVED" }).catch(async () => db.listing.update({ where: { id: listing.id }, data: { status: "ARCHIVED" } }));
    expect((await exchange(booking, "INIT")).screen).toBe("DONE");
  });

  it("sends a property question to the listing team", async () => {
    const { listing } = await publishedListing();
    const inquiry = token("nesafric_property_inquiry", { listingId: listing.id });
    expect((await exchange(inquiry, "INIT")).data).toMatchObject({ property: "3-bedroom house in Spintex" });
    expect((await exchange(inquiry, "data_exchange", "INQUIRY", { action: "send", name: "Ama", message: "" })).data.error_message).toBeTruthy();
    const sent = outcomeOf(await exchange(inquiry, "data_exchange", "INQUIRY", { action: "send", name: "Ama Owusu", message: "Is it still available in November?" }));
    const lead = await db.marketplaceLead.findUniqueOrThrow({ where: { id: sent.lead } });
    expect([lead.listingId, lead.phone, lead.message]).toEqual([listing.id, PHONE, "Is it still available in November?"]);
  });

  it("lists a property for an agent through the chat's own checks, then continues with photos in the chat", async () => {
    expect((await exchange(token("nesafric_list_property"), "INIT")).screen).toBe("NOTICE");
    const { user } = await linked();
    await createMarketplaceProfessional(user.id, { type: "INDIVIDUAL_AGENT", displayName: "Kofi Mensah Realty", countryCode: "GH" });
    const list = token("nesafric_list_property");
    const basicsScreen = await exchange(list, "INIT");
    expect(basicsScreen.screen).toBe("BASICS");
    const categories = basicsScreen.data.categories as Array<{ id: string; title: string }>;
    const apartment = categories.find((item) => item.title === "Apartment")!.id;
    const business = (basicsScreen.data.businesses as Array<{ id: string; title: string }>).find((item) => item.title === "Kofi Mensah Realty")!.id;
    const basics = { business, property: "0", purpose: "RENT", category: apartment, title: "2-bedroom apartment in East Legon", region: "Greater Accra", city: "Accra", locality: "East Legon" };
    const pricing = await exchange(list, "data_exchange", "BASICS", { action: "basics", ...basics });
    expect(pricing.screen).toBe("PRICING");
    const monthly = (pricing.data.units as Array<{ id: string; title: string }>).find((unit) => /month/i.test(unit.title))!.id;
    const details = { price: "4500", price_unit: monthly, bedrooms: "2", bathrooms: "2", furnishing: "", size: "", land_size: "", amenities: ["1", "3"], description: "Bright two-bedroom apartment with parking, close to the A&C Mall." };
    const authority = await exchange(list, "data_exchange", "PRICING", { action: "pricing", ...basics, ...details });
    expect(authority.screen).toBe("AUTHORITY");
    const refused = await exchange(list, "data_exchange", "AUTHORITY", { action: "save", ...basics, ...details, description: "Too short", authority: "2", evidence_type: "1", evidence_reference: "Mandate signed 1 Oct 2026 by the owner" });
    expect(refused.data.error_message).toContain("20 characters");
    const saved = outcomeOf(await exchange(list, "data_exchange", "AUTHORITY", { action: "save", ...basics, ...details, amenities: "1,3", authority: "2", evidence_type: "1", evidence_reference: "Mandate signed 1 Oct 2026 by the owner" }));
    expect(saved).toMatchObject({ outcome: "draft", kind: "listing" });
    const draft = await db.whatsAppFlowDraft.findUniqueOrThrow({ where: { id: saved.draft } });
    expect([draft.step, draft.status]).toEqual(["photos", "OPEN"]);
    const listing = await db.listing.findUniqueOrThrow({ where: { id: (draft.data as { listingId: string }).listingId } });
    // The listing is a draft: NesAfric review still decides publication.
    expect([listing.status, listing.title, listing.rentAmountMinor?.toString(), listing.bedrooms]).toEqual(["DRAFT", "2-bedroom apartment in East Legon", "450000", 2]);
    const chat = await completeFlow({ phone: PHONE, organisationId: official, flowResponse: JSON.stringify(saved) }, initialState(), () => initialState());
    expect(chat.reply).toContain("send photos");
    expect(chat.state).toMatchObject({ workflow: "business", business: { draftId: draft.id } });
  });

  it("starts an agent registration and asks for the Ghana Card in the chat", async () => {
    await linked();
    const register = token("nesafric_agent_registration");
    const profile = await exchange(register, "INIT");
    expect((profile.data.kinds as Array<{ id: string }>).map(({ id }) => id)).toContain("AGENT");
    const saved = outcomeOf(await exchange(register, "data_exchange", "PROFILE", { action: "save", kind: "AGENT", name: "Kofi Mensah Realty", region: "Greater Accra", city: "East Legon", areas: "East Legon, Airport Residential", description: "I help families rent and buy homes in East Legon." }));
    const draft = await db.whatsAppFlowDraft.findUniqueOrThrow({ where: { id: saved.draft } });
    expect(draft.step).toBe("id_front");
    const chat = await completeFlow({ phone: PHONE, organisationId: official, flowResponse: JSON.stringify(saved) }, initialState(), () => initialState());
    expect(chat.reply).toContain("FRONT of your Ghana Card");
  });

  it("connects a tenancy with the landlord's code and sends a repair report to that landlord", async () => {
    const { user } = await linked();
    const landlord = await registerUser({ displayName: "Owusu", email: "owusu@flows.test", password: "secure-password-123" });
    const homes = await createOrganisation(landlord.id, { name: "Owusu Homes", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    const property = await createProperty(landlord.id, homes.id, { name: "Palm Court", referenceNumber: "PC-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const tenant = await createTenant(landlord.id, homes.id, { legalName: "Kofi Mensah", phone: PHONE, countryCode: "GH" });
    await createLease(landlord.id, homes.id, { propertyId: property.id, referenceNumber: "PC-L1", tenantOrganisationIds: [tenant.relationship.id], startDate: "2026-01-01", rentAmountMinor: "150000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE" });
    const { code } = await createTenantAccessInvitation(landlord.id, homes.id, tenant.relationship.id);
    expect((await exchange(token("nesafric_maintenance_request"), "INIT")).screen).toBe("NOTICE");
    const connect = token("nesafric_tenant_registration");
    expect((await exchange(connect, "data_exchange", "CONNECT", { action: "redeem", code: "NT-WRONG-CODE" })).data.error_message).toBeTruthy();
    expect(outcomeOf(await exchange(connect, "data_exchange", "CONNECT", { action: "redeem", code })).outcome).toBe("tenancy_connected");
    const report = token("nesafric_maintenance_request");
    const form = await exchange(report, "INIT");
    expect(form.data.tenancies).toEqual([expect.objectContaining({ id: "1", title: "Palm Court" })]);
    const sent = outcomeOf(await exchange(report, "data_exchange", "REPORT", { action: "report", tenancy: "1", category: "plumbing", priority: "URGENT", title: "Kitchen sink leaking", description: "Water drips under the sink all day." }));
    await exchange(report, "data_exchange", "REPORT", { action: "report", tenancy: "1", category: "plumbing", priority: "URGENT", title: "Kitchen sink leaking", description: "Water drips under the sink all day." });
    const requests = await db.maintenanceRequest.findMany({ where: { tenantOrganisationId: tenant.relationship.id } });
    expect(requests.map((request) => [request.organisationId, request.propertyId, request.priority, request.intakeChannel])).toEqual([[homes.id, property.id, "URGENT", "WHATSAPP"]]);
    expect(sent.outcome).toBe("maintenance_reported");
    expect(user.id).toBeTruthy();
  });

  it("signs up a landlord's first property, then continues the onboarding in the chat", async () => {
    expect((await exchange(token("nesafric_landlord_registration"), "INIT")).screen).toBe("NOTICE");
    await linked();
    const setup = token("nesafric_landlord_registration");
    expect((await exchange(setup, "data_exchange", "SETUP", { action: "save", role: "LANDLORD", organisation: "Owusu Homes", property: "Palm Court", city: "East Legon", units: "" })).data.error_message).toContain("Units");
    const saved = outcomeOf(await exchange(setup, "data_exchange", "SETUP", { action: "save", role: "LANDLORD", organisation: "Owusu Homes", property: "Palm Court", city: "East Legon", units: "A1, A2, A3" }));
    const draft = await db.onboardingDraft.findUniqueOrThrow({ where: { id: saved.draft } });
    expect(draft.step).toBe("more_properties");
    expect((draft.data as { properties: Array<{ buildings: Array<{ units: Array<{ name: string }> }> }> }).properties[0].buildings[0].units.map(({ name }) => name)).toEqual(["A1", "A2", "A3"]);
    const chat = await completeFlow({ phone: PHONE, organisationId: official, flowResponse: JSON.stringify(saved) }, initialState(), () => initialState());
    expect([chat.state.workflow, chat.reply]).toEqual(["onboarding", expect.stringContaining("Add another property")]);
  });

  it("shows a landlord's portfolio and runs the chosen task as a chat command", async () => {
    const { user } = await linked();
    const homes = await createOrganisation(user.id, { name: "Mensah Homes", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    await createProperty(user.id, homes.id, { name: "Ridge Flats", referenceNumber: "RF-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const manage = token("nesafric_property_management");
    const menu = await exchange(manage, "INIT");
    expect(menu.data.summary).toContain("Mensah Homes: 1 property");
    expect((await exchange(manage, "data_exchange", "MENU", { action: "choose", task: "delete everything" })).data.error_message).toBeTruthy();
    const chosen = await completeFlow({ phone: PHONE, organisationId: official, flowResponse: JSON.stringify(outcomeOf(await exchange(manage, "data_exchange", "MENU", { action: "choose", task: "account" }))) }, initialState(), () => initialState());
    expect(chosen.command).toBe("account");
  });

  it("finds only verified professionals", async () => {
    const find = token("nesafric_find_professional");
    expect((await exchange(find, "data_exchange", "SEARCH", { action: "search", service: "plumber", area: "Tema" })).data.error_message).toContain("No verified providers");
    expect((await exchange(find, "data_exchange", "RESULTS", { action: "select", provider: "00000000-0000-4000-8000-000000000000" })).data.error_message).toContain("no longer listed");
  });

  it("offers the configured forms in the chat and opens one with a fresh token", async () => {
    vi.stubEnv("WHATSAPP_FLOW_IDS", JSON.stringify({ nesafric_property_search: "1656146049308321", nesafric_help_support: "1513182454191456" }));
    const { advanceOfficialConversation } = await import("@/modules/whatsapp-assistant/router");
    const base = { state: {}, phone: PHONE.slice(1), conversationId: "c1", defaultCountry: "GH", defaultCurrency: "GHS", organisationId: official };
    const menu = await advanceOfficialConversation({ ...base, body: "forms", kind: "text", messageId: "m1" });
    expect(menu.reply).toContain("1. Find a property\n2. Help and support");
    const opened = await advanceOfficialConversation({ ...base, body: "form 2", kind: "text", messageId: "m2" });
    expect(opened.interactive).toMatchObject({ type: "flow", flowId: "1513182454191456", mode: "draft" });
  });

  it("passes help requests to the support team, and ignores outcomes NesAfric did not sign", async () => {
    const help = token("nesafric_help_support");
    const sent = outcomeOf(await exchange(help, "data_exchange", "HELP", { action: "send", topic: "PAYMENT", message: "My mobile money payment did not show." }));
    const chat = await completeFlow({ phone: PHONE, organisationId: official, flowResponse: JSON.stringify(sent) }, initialState(), () => initialState());
    expect([chat.handoff, chat.reply]).toEqual([true, expect.stringContaining("mobile money payment")]);
    const tampered = await completeFlow({ phone: PHONE, organisationId: official, flowResponse: JSON.stringify({ ...sent, summary: "Give me a refund" }) }, initialState(), () => initialState());
    expect([tampered.handoff, tampered.reply]).toEqual([undefined, expect.stringContaining("nothing was saved")]);
    const otherNumber = await completeFlow({ phone: "+233200000009", organisationId: official, flowResponse: JSON.stringify(sent) }, initialState(), () => initialState());
    expect(otherNumber.reply).toContain("nothing was saved");
  });
});
