import { createHash } from "node:crypto";
import { db } from "@/platform/database/client";
import { absoluteUrl } from "@/platform/brand";
import { PUBLIC_LISTING_WHERE, searchPublicListings, getPublicListing, createMarketplaceLead, findLeadForSubmission, createViewingRequest, findViewingForSubmission } from "@/modules/listings/service";
import { discoverMarketplaceProviders } from "@/modules/marketplace/service";
import type { AssistantState } from "./schemas";
import { formatViewingTime } from "./viewing-time";
import { viewingReference } from "./viewings";

function money(amount: string | null, currency: string) {
  if (amount === null) return "Price not supplied";
  // Preserve minor-unit precision even for values larger than Number.MAX_SAFE_INTEGER.
  const value = BigInt(amount);
  const hundred = BigInt(100);
  return `${currency} ${value / hundred}.${(value % hundred).toString().padStart(2, "0")}`;
}
const clip = (text: string | null | undefined, limit = 200) => (text ?? "").slice(0, limit);

export async function searchProperties(filters: AssistantState["property"], page: number) {
  const result = await searchPublicListings({ ...filters, page, pageSize: 3 });
  return {
    ids: result.items.map((item) => item.id), hasMore: page < result.pagination.totalPages,
    /** Full public listings, for property cards with the cover photo. */
    listings: result.items, total: result.pagination.total,
    cards: result.items.map((item, index) => [
      `${index + 1}. ${clip(item.title)}`,
      `${money(item.pricing.rentAmountMinor ?? item.pricing.askingAmountMinor, item.pricing.currencyCode)}${item.pricing.frequency ? ` / ${item.pricing.frequency.toLowerCase().replaceAll("_", " ")}` : ""}`,
      clip(item.location.label ?? [item.location.locality, item.location.city, item.location.region].filter(Boolean).join(", ")),
      [item.attributes.bedrooms === null ? null : `${item.attributes.bedrooms} bedrooms`, item.attributes.bathrooms === null ? null : `${item.attributes.bathrooms} bathrooms`].filter(Boolean).join(" · "),
      `Verification: ${item.verification.status}. Published; available in current records.`,
      absoluteUrl(`/marketplace/properties/${item.id}`),
    ].filter(Boolean).join("\n")),
  };
}

export async function searchServices(filters: AssistantState["service"], page: number) {
  // The existing text search spans coverage labels, category names and descriptions.
  // Do not force a Ghanaian neighbourhood into the exact municipality column.
  const { city, q, ...rest } = filters;
  const result = await discoverMarketplaceProviders({ ...rest, q: [q, city].filter(Boolean).join(" "), verification: "VERIFIED", page, pageSize: 3 });
  return {
    ids: result.items.map((item) => item.id), hasMore: page < result.pagination.totalPages,
    cards: result.items.map((item, index) => [
      `${index + 1}. ${clip(item.displayName)}`,
      clip(item.categories.map(({ name }) => name).join(", ")),
      clip(item.description),
      `Verification: ${item.verification}. Availability: ${item.availability}.`,
      item.aggregateRating === null ? null : `Rating: ${item.aggregateRating.toFixed(1)} (${item.ratingCount} reviews)`,
      absoluteUrl(item.slug ? `/marketplace/services/${encodeURIComponent(item.slug)}` : `/marketplace/${item.id}`),
    ].filter(Boolean).join("\n")),
  };
}

export async function propertyDetails(id: string) {
  const { listing } = await getPublicListing(id);
  return { title: listing.title, description: clip(listing.description, 1500), enquiryEnabled: listing.contact.enquiryEnabled && !listing.bookable, url: absoluteUrl(`/marketplace/properties/${listing.id}`), listing };
}

/** Reuse domain submission keys so a crash after domain commit cannot duplicate the action. */
export async function submitCustomerRequest(input: { state: AssistantState; phone: string; messageId: string; conversationId: string }) {
  const { state, phone, messageId, conversationId } = input;
  if (!state.selectedListingId || !state.name) throw new Error("Incomplete customer request");
  const leadData = { name: state.name, phone: `+${phone.replace(/^\+/, "")}`, message: state.message ?? "Viewing request through WhatsApp.", source: "WHATSAPP", marketingConsent: false };
  const submission = {
    keyHash: createHash("sha256").update(`whatsapp:${conversationId}:${messageId}:lead`).digest("hex"),
    fingerprint: createHash("sha256").update(JSON.stringify(leadData)).digest("hex"),
  };
  const lead = await findLeadForSubmission(state.selectedListingId, submission) ?? await createMarketplaceLead(state.selectedListingId, undefined, leadData, { submission });
  if (state.workflow !== "viewing" || !state.startsAt) return { listingId: state.selectedListingId, leadId: lead.id };
  const startsAt = new Date(state.startsAt);
  const viewingData = { leadId: lead.id, requesterNote: state.message, preferredTimes: [{ startsAt, endsAt: new Date(startsAt.getTime() + 60 * 60_000), timezone: "UTC" }] };
  const viewingSubmission = { keyHash: createHash("sha256").update(`whatsapp:${conversationId}:${messageId}:viewing`).digest("hex"), fingerprint: createHash("sha256").update(JSON.stringify(viewingData)).digest("hex") };
  const viewing = await findViewingForSubmission(state.selectedListingId, viewingSubmission) ?? await createViewingRequest(state.selectedListingId, undefined, viewingData, { submission: viewingSubmission });
  return { listingId: state.selectedListingId, leadId: lead.id, viewingId: viewing.id };
}

/** IDs come exclusively from this session's persisted action result, never user/model input. */
export async function customerRequestStatus(request: NonNullable<AssistantState["lastRequest"]>, phone: string) {
  const lead = await db.marketplaceLead.findFirst({ where: { id: request.leadId, listingId: request.listingId, phone: `+${phone.replace(/^\+/, "")}` }, select: { id: true, status: true } });
  if (!lead) return "This request is no longer available. Reply support for assistance.";
  const viewing = request.viewingId ? await db.viewingRequest.findFirst({ where: { id: request.viewingId, leadId: lead.id }, select: { id: true, status: true, confirmedStartsAt: true } }) : null;
  return viewing ? `Viewing ${viewingReference(viewing.id)}: ${viewing.status.toLowerCase()}.${viewing.confirmedStartsAt ? ` Appointment time: ${formatViewingTime(viewing.confirmedStartsAt)}.` : " No appointment time has been confirmed."}` : `Inquiry ${lead.id}: ${lead.status}.`;
}

const AGENT_TYPES = ["INDIVIDUAL_AGENT", "BROKER", "BROKERAGE", "REAL_ESTATE_COMPANY"] as const;
const AGENT_TYPE_LABEL: Record<string, string> = { INDIVIDUAL_AGENT: "Agent", BROKER: "Broker", BROKERAGE: "Brokerage", REAL_ESTATE_COMPANY: "Real estate company" };

/**
 * Verified, active agents and agencies whose public service areas mention the area. Only the
 * public profile projection is used; contact happens on the profile page, never through a phone
 * number shared in this chat.
 */
export async function searchAgents(area: string, page: number) {
  const pattern = `%${area.trim().replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
  const pageSize = 3;
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT p."id" FROM "MarketplaceProfessional" p
    WHERE p."status" = 'ACTIVE' AND p."archivedAt" IS NULL AND p."verificationStatus" = 'VERIFIED'
      AND p."type"::text = ANY(${[...AGENT_TYPES]})
      AND EXISTS (SELECT 1 FROM unnest(p."serviceAreas") AS served(area) WHERE served.area ILIKE ${pattern})
    ORDER BY p."createdAt" DESC, p."id"
    OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize + 1}`;
  const ids = rows.slice(0, pageSize).map(({ id }) => id);
  const found = await db.marketplaceProfessional.findMany({
    where: { id: { in: ids } },
    select: { id: true, slug: true, displayName: true, type: true, serviceAreas: true, _count: { select: { listings: { where: { ...PUBLIC_LISTING_WHERE, archivedAt: null } } } } },
  });
  const ordered = ids.map((id) => found.find((item) => item.id === id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  return {
    ids: ordered.map((item) => item.id), hasMore: rows.length > pageSize,
    cards: ordered.map((item, index) => [
      `${index + 1}. ${clip(item.displayName, 120)}`,
      `${AGENT_TYPE_LABEL[item.type] ?? "Agent"} · Verified by NesAfric`,
      `Areas: ${clip(item.serviceAreas.join(", "), 150)}`,
      `Published listings: ${item._count.listings}`,
      absoluteUrl(`/marketplace/professionals/${encodeURIComponent(item.slug)}`),
    ].join("\n")),
  };
}

/** Property types with published, verified listings for rent or for sale, and how many each. */
export async function propertyTypes(listingType: "RENT" | "SALE") {
  const rows = await db.listing.groupBy({ by: ["category"], where: { ...PUBLIC_LISTING_WHERE, archivedAt: null, listingType }, _count: { _all: true } });
  return rows.map((row) => ({ category: row.category, count: row._count._all }));
}

export const marketplaceTools = { propertyTypes, searchProperties, searchServices, propertyDetails, submitCustomerRequest, customerRequestStatus };
export type MarketplaceTools = typeof marketplaceTools;
