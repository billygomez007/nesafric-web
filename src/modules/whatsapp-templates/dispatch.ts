import { createHash } from "node:crypto";
import { db } from "@/platform/database/client";
import type { DomainEvent, Prisma } from "@/platform/database/generated/client";
import { officialWhatsAppOrganisationId } from "@/modules/whatsapp-assistant/identity";
import { whatsappRecipientE164 } from "@/modules/whatsapp-assistant/outbound";
import { utilityTemplate } from "./registry";
import { queueUtilityTemplate, type UtilityRecipient } from "./send";

/**
 * Business events to Utility templates. The services already write a `DomainEvent` in the same
 * transaction as each state change; this reads those events and decides, once per event, template
 * and recipient, whether to send. Nothing here runs on reads, and a notification problem can
 * never roll back the business change that caused it.
 *
 * Switched on by `WHATSAPP_UTILITY_EVENTS_SINCE` (an ISO time): events before it are never
 * considered, so enabling it does not message people about old activity. Events older than 48
 * hours are not sent either: a late notification is worse than none.
 */
type Tx = Prisma.TransactionClient;
type Plan = { templateKey: string; recipient: UtilityRecipient; values: Record<string, string> } | { templateKey: string; skip: string };
type Handler = (tx: Tx, event: DomainEvent) => Promise<Plan[]>;

const MAX_AGE_MS = 48 * 60 * 60_000;
const ACTIVE_CHAT_MS = 24 * 60 * 60_000;
const short = (prefix: string, id: string) => `${prefix}-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
const payloadOf = (event: DomainEvent) => (event.payload && typeof event.payload === "object" ? event.payload : {}) as Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const accraTime = (at: Date) => `${new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Accra" }).format(at).replace(" at ", ", ")} GMT`;

/**
 * The verified WhatsApp number linked to this account. With `selfInitiated`, nobody is returned
 * while the person is chatting with NesAfric: the chat already confirms their own actions.
 */
async function linkedRecipient(tx: Tx, userId: string | null | undefined, options: { selfInitiated?: boolean; now: Date }): Promise<UtilityRecipient | string> {
  if (!userId) return "No account to notify.";
  const identity = await tx.channelIdentity.findFirst({ where: { channel: "WHATSAPP", userId, verifiedAt: { not: null } }, orderBy: { verifiedAt: "desc" }, include: { user: { select: { displayName: true } } } });
  if (!identity) return "The recipient has not linked a WhatsApp number.";
  if (identity.optedOutAt) return "The recipient opted out of WhatsApp messages (STOP).";
  if (options.selfInitiated && identity.lastInboundAt && options.now.getTime() - identity.lastInboundAt.getTime() < ACTIVE_CHAT_MS) return "The recipient is chatting with NesAfric; the chat confirms their own action.";
  return { phone: identity.address, displayName: identity.user?.displayName ?? "NesAfric user", basis: "LINKED_ACCOUNT" };
}

/** An enquirer: opted in on the form, or made the enquiry on WhatsApp. */
function enquiryRecipient(lead: { name: string; phone: string | null; source: string | null; whatsappUpdatesConsent: boolean }): UtilityRecipient | string {
  if (!lead.phone || !whatsappRecipientE164(lead.phone)) return "The enquiry has no WhatsApp number.";
  if (!lead.whatsappUpdatesConsent && lead.source !== "WHATSAPP") return "The enquirer did not ask for WhatsApp updates.";
  return { phone: lead.phone, displayName: lead.name, basis: "ENQUIRY_OPT_IN" };
}

const plan = (templateKey: string, recipient: UtilityRecipient | string, values: () => Record<string, string>): Plan =>
  typeof recipient === "string" ? { templateKey, skip: recipient } : { templateKey, recipient, values: values() };

async function viewingContext(tx: Tx, viewingId: string) {
  return tx.viewingRequest.findUnique({ where: { id: viewingId }, include: { lead: true, listing: { select: { title: true, locality: true, city: true } } } });
}

const handlers: Record<string, Handler> = {
  "marketplace.lead_created": async (tx, event) => {
    const lead = await tx.marketplaceLead.findUnique({ where: { id: event.aggregateId }, include: { listing: { select: { title: true } } } });
    if (!lead) return [{ templateKey: "U01", skip: "The enquiry no longer exists." }];
    if (lead.source === "WHATSAPP") return [{ templateKey: "U01", skip: "Made on WhatsApp; answered in the chat." }];
    return [plan("U01", enquiryRecipient(lead), () => ({ recipient_name: firstName(lead.name), listing_title: lead.listing.title, enquiry_reference: short("EQ", lead.id) }))];
  },
  "viewing.requested": async (tx, event) => {
    const viewing = await viewingContext(tx, event.aggregateId);
    if (!viewing) return [{ templateKey: "U05", skip: "The viewing no longer exists." }];
    if (viewing.lead.source === "WHATSAPP") return [{ templateKey: "U05", skip: "Made on WhatsApp; answered in the chat." }];
    return [plan("U05", enquiryRecipient(viewing.lead), () => ({ recipient_name: firstName(viewing.lead.name), listing_title: viewing.listing.title, viewing_reference: short("VW", viewing.id) }))];
  },
  "viewing.confirmed": async (tx, event) => {
    const viewing = await viewingContext(tx, event.aggregateId);
    if (viewing?.status !== "CONFIRMED" || !viewing.confirmedStartsAt) return [{ templateKey: "U02", skip: "The viewing is no longer confirmed." }];
    const area = [viewing.listing.locality, viewing.listing.city].filter(Boolean).join(", ");
    if (!area) return [{ templateKey: "U02", skip: "The listing has no area to name." }];
    return [plan("U02", enquiryRecipient(viewing.lead), () => ({ recipient_name: firstName(viewing.lead.name), listing_title: viewing.listing.title, viewing_time: accraTime(viewing.confirmedStartsAt!), area }))];
  },
  "viewing.rescheduled": async (tx, event) => {
    const viewing = await viewingContext(tx, event.aggregateId);
    if (viewing?.status !== "RESCHEDULED") return [{ templateKey: "U03", skip: "The viewing changed again." }];
    return [plan("U03", enquiryRecipient(viewing.lead), () => ({ recipient_name: firstName(viewing.lead.name), listing_title: viewing.listing.title, viewing_time: viewing.confirmedStartsAt ? accraTime(viewing.confirmedStartsAt) : "a time the lister will confirm with you" }))];
  },
  "listing.viewing_status_changed": async (tx, event) => {
    if (payloadOf(event).toStatus !== "CANCELLED") return [];
    const viewing = await viewingContext(tx, event.aggregateId);
    if (viewing?.status !== "CANCELLED") return [{ templateKey: "U04", skip: "The viewing is no longer cancelled." }];
    const history = await tx.viewingRequestStatusHistory.findFirst({ where: { viewingRequestId: viewing.id, toStatus: "CANCELLED" }, orderBy: { createdAt: "desc" }, select: { note: true } });
    return [plan("U04", enquiryRecipient(viewing.lead), () => ({ recipient_name: firstName(viewing.lead.name), listing_title: viewing.listing.title, reason: text(history?.note) ?? "the lister cancelled it" }))];
  },

  "marketplace_professional.created": async (tx, event, now = new Date()) => {
    const professional = await tx.marketplaceProfessional.findUnique({ where: { id: event.aggregateId }, include: { createdBy: { select: { displayName: true } } } });
    if (!professional) return [{ templateKey: "U07", skip: "The profile no longer exists." }];
    const recipient = await linkedRecipient(tx, professional.createdByUserId, { selfInitiated: true, now });
    return [plan("U07", recipient, () => ({ recipient_name: firstName(professional.createdBy.displayName), business_name: professional.displayName }))];
  },
  "marketplace_professional.verification_reviewed": async (tx, event) => {
    const { toStatus, reason } = payloadOf(event);
    const templateKey = toStatus === "VERIFIED" ? "U08" : toStatus === "REJECTED" ? "U09" : null;
    if (!templateKey) return [];
    const professional = await tx.marketplaceProfessional.findUnique({ where: { id: event.aggregateId }, include: { members: { where: { status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } }, include: { user: { select: { displayName: true } } } } } });
    if (!professional?.members.length) return [{ templateKey, skip: "The profile has no active owner or admin." }];
    return Promise.all(professional.members.map(async (member) => plan(templateKey, await linkedRecipient(tx, member.userId, { now: new Date() }), () => ({
      recipient_name: firstName(member.user.displayName), business_name: professional.displayName, ...(templateKey === "U09" ? { reason: text(reason) ?? "the documents did not meet the requirements" } : {}),
    }))));
  },
  "listing.pending_review": async (tx, event) => {
    const listing = await tx.listing.findUnique({ where: { id: event.aggregateId }, include: { createdBy: { select: { displayName: true } } } });
    if (listing?.status !== "PENDING_REVIEW") return [{ templateKey: "U10", skip: "The listing is no longer pending review." }];
    return [plan("U10", await linkedRecipient(tx, listing.createdByUserId, { selfInitiated: true, now: new Date() }), () => ({ recipient_name: firstName(listing.createdBy.displayName), listing_title: listing.title, listing_reference: short("LS", listing.id) }))];
  },
  "listing.published": async (tx, event) => listingReviewed(tx, event, "PUBLISHED"),
  "listing.rejected": async (tx, event) => listingReviewed(tx, event, "REJECTED"),
  "listing.verification_verified": async (tx, event) => listingEvidenceReviewed(tx, event, true),
  "listing.verification_rejected": async (tx, event) => listingEvidenceReviewed(tx, event, false),

  "organisation.created": async (tx, event) => {
    if (event.organisationId === officialWhatsAppOrganisationId()) return [];
    // A marketplace profile's hidden backing organisation is not a workspace (U07 covers it).
    if (await tx.marketplaceProfessional.findUnique({ where: { backingOrganisationId: event.organisationId }, select: { id: true } })) return [];
    const organisation = await tx.organisation.findUnique({ where: { id: event.organisationId }, include: { members: { where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" }, take: 1, include: { user: { select: { displayName: true } } } } } });
    const owner = organisation?.members[0];
    if (!organisation || !owner) return [{ templateKey: "U13", skip: "The workspace has no active owner." }];
    return [plan("U13", await linkedRecipient(tx, owner.userId, { selfInitiated: true, now: new Date() }), () => ({ recipient_name: firstName(owner.user.displayName), workspace_name: organisation.name }))];
  },
  "portfolio_verification.verified": async (tx, event) => ownershipReviewed(tx, event, true),
  "portfolio_verification.rejected": async (tx, event) => ownershipReviewed(tx, event, false),

  "tenant.access_invitation_created": async (tx, event, now = new Date()) => {
    const invitationId = text(payloadOf(event).invitationId);
    const invitation = invitationId ? await tx.tenantAccessInvitation.findUnique({ where: { id: invitationId }, include: { tenantOrganisation: { include: { tenant: { select: { legalName: true } }, organisation: { select: { name: true } } } }, lease: { select: { property: { select: { name: true } } } } } }) : null;
    const relationship = invitation?.tenantOrganisation;
    if (!invitation || !relationship || relationship.organisationId !== event.organisationId) return [{ templateKey: "U17", skip: "The invitation no longer exists." }];
    if (invitation.redeemedAt || invitation.revokedAt || invitation.expiresAt <= now) return [{ templateKey: "U17", skip: "The invitation is no longer active." }];
    // A number the landlord typed in is not consent: the landlord must have recorded the tenant's agreement.
    if (relationship.userId) return [{ templateKey: "U17", skip: "The tenancy is already connected to an account." }];
    if (!relationship.communicationWhatsappAllowed) return [{ templateKey: "U17", skip: "The landlord has not recorded the tenant's consent to WhatsApp messages." }];
    if (!relationship.phone || !whatsappRecipientE164(relationship.phone)) return [{ templateKey: "U17", skip: "The tenancy has no WhatsApp number." }];
    const property = invitation.lease?.property.name ?? (await tx.leaseParty.findFirst({ where: { tenantOrganisationId: relationship.id }, orderBy: { createdAt: "desc" }, select: { lease: { select: { property: { select: { name: true } } } } } }))?.lease.property.name;
    if (!property) return [{ templateKey: "U17", skip: "The tenancy has no property to name." }];
    return [{ templateKey: "U17", recipient: { phone: relationship.phone, displayName: relationship.tenant.legalName, basis: "TENANT_CONSENT_RECORDED" }, values: { recipient_name: firstName(relationship.tenant.legalName), landlord_name: relationship.organisation.name, property_name: property } }];
  },
  "tenant.access_invitation_redeemed": async (tx, event) => {
    const userId = text(payloadOf(event).userId);
    const relationship = await tx.tenantOrganisation.findUnique({ where: { id: event.aggregateId }, include: { organisation: { select: { name: true } }, user: { select: { displayName: true } } } });
    if (!relationship || relationship.userId !== userId) return [{ templateKey: "U18", skip: "The tenancy is not connected to this account." }];
    return [plan("U18", await linkedRecipient(tx, userId, { selfInitiated: true, now: new Date() }), () => ({ recipient_name: firstName(relationship.user?.displayName ?? "there"), landlord_name: relationship.organisation.name }))];
  },

  "maintenance.requested": async (tx, event) => {
    if (payloadOf(event).intakeChannel === "WHATSAPP") return [{ templateKey: "U23", skip: "Reported on WhatsApp; answered in the chat." }];
    const request = await maintenanceContext(tx, event);
    if (!request) return [{ templateKey: "U23", skip: NOT_IN_WORKSPACE }];
    if (!request.tenantOrganisation) return [{ templateKey: "U23", skip: "The request is not linked to a tenancy." }];
    return [plan("U23", await linkedRecipient(tx, request.tenantOrganisation.userId, { now: new Date() }), () => ({ recipient_name: firstName(request.tenantOrganisation!.user?.displayName ?? "there"), request_reference: request.referenceNumber ?? short("MR", request.id), property_name: placeName(request), issue: request.title }))];
  },
  "maintenance.started": async (tx, event) => maintenanceUpdate(tx, event, "work has started"),
  "maintenance.rejected": async (tx, event) => maintenanceUpdate(tx, event, "not approved by your landlord"),
  "maintenance.cancelled": async (tx, event) => maintenanceUpdate(tx, event, "cancelled"),
  "maintenance.completed": async (tx, event) => {
    const request = await maintenanceContext(tx, event);
    if (!request) return [{ templateKey: "U25", skip: NOT_IN_WORKSPACE }];
    if (!request.tenantOrganisation) return [{ templateKey: "U25", skip: "The request is not linked to a tenancy." }];
    if (await automated(tx, request.id)) return [{ templateKey: "U25", skip: "Handled by the provider network, which messages the tenant itself." }];
    return [plan("U25", await linkedRecipient(tx, request.tenantOrganisation.userId, { now: new Date() }), () => ({ recipient_name: firstName(request.tenantOrganisation!.user?.displayName ?? "there"), request_reference: request.referenceNumber ?? short("MR", request.id), property_name: placeName(request) }))];
  },
};

async function listingReviewed(tx: Tx, event: DomainEvent, toStatus: "PUBLISHED" | "REJECTED"): Promise<Plan[]> {
  if (payloadOf(event).fromStatus !== "PENDING_REVIEW") return [];
  const listing = await tx.listing.findUnique({ where: { id: event.aggregateId }, include: { createdBy: { select: { displayName: true } } } });
  if (!listing) return [{ templateKey: "U11", skip: "The listing no longer exists." }];
  const decision = await tx.listingStatusHistory.findFirst({ where: { listingId: listing.id, toStatus }, orderBy: { createdAt: "desc" }, select: { actorUserId: true, note: true } });
  if (decision?.actorUserId === listing.createdByUserId) return [{ templateKey: "U11", skip: "Decided by the listing's own creator." }];
  const note = text(payloadOf(event).note) ?? text(decision?.note);
  const outcome = toStatus === "PUBLISHED" ? "approved and published" : `not approved${note ? ` (${note})` : ""}`;
  return [plan("U11", await linkedRecipient(tx, listing.createdByUserId, { now: new Date() }), () => ({ recipient_name: firstName(listing.createdBy.displayName), listing_title: listing.title, outcome }))];
}

async function listingEvidenceReviewed(tx: Tx, event: DomainEvent, verified: boolean): Promise<Plan[]> {
  const listing = await tx.listing.findUnique({ where: { id: event.aggregateId }, include: { createdBy: { select: { displayName: true } } } });
  if (!listing) return [{ templateKey: "U29", skip: "The listing no longer exists." }];
  const note = text(payloadOf(event).note);
  return [plan("U29", await linkedRecipient(tx, listing.createdByUserId, { now: new Date() }), () => ({ recipient_name: firstName(listing.createdBy.displayName), subject: listing.title, result: verified ? "verified" : `not verified${note ? ` (${note})` : ""}` }))];
}

async function ownershipReviewed(tx: Tx, event: DomainEvent, verified: boolean): Promise<Plan[]> {
  const templateKey = verified ? "U14" : "U15";
  const claim = await tx.portfolioVerification.findUnique({ where: { id: event.aggregateId }, include: { property: { select: { name: true } }, organisation: { select: { name: true } }, claimedBy: { select: { displayName: true } } } });
  if (!claim || claim.status !== (verified ? "VERIFIED" : "REJECTED")) return [{ templateKey, skip: "The claim's decision changed." }];
  return [plan(templateKey, await linkedRecipient(tx, claim.claimedByUserId, { now: new Date() }), () => ({
    recipient_name: firstName(claim.claimedBy.displayName), property_name: claim.property?.name ?? claim.organisation.name,
    ...(verified ? {} : { reason: text(claim.reviewNote) ?? "more information is needed" }),
  }))];
}

const NOT_IN_WORKSPACE = "The request does not belong to the event's workspace.";
/** Scoped to the event's own workspace: an event can never reach another workspace's request or tenant. */
async function maintenanceContext(tx: Tx, event: DomainEvent) {
  return tx.maintenanceRequest.findFirst({ where: { id: event.aggregateId, organisationId: event.organisationId }, include: { property: { select: { name: true } }, unit: { select: { name: true } }, tenantOrganisation: { select: { userId: true, user: { select: { displayName: true } } } } } });
}
const placeName = (request: { property: { name: string }; unit: { name: string } | null }) => request.unit ? `${request.property.name}, ${request.unit.name}` : request.property.name;
/** Requests the routing rules dispatched: the provider-network messages already keep the tenant informed. */
const automated = async (tx: Tx, requestId: string) => (await tx.workOrder.count({ where: { maintenanceRequestId: requestId, routingRuleId: { not: null } } })) > 0;

async function maintenanceUpdate(tx: Tx, event: DomainEvent, status: string): Promise<Plan[]> {
  const request = await maintenanceContext(tx, event);
  if (!request) return [{ templateKey: "U24", skip: NOT_IN_WORKSPACE }];
  if (!request.tenantOrganisation) return [{ templateKey: "U24", skip: "The request is not linked to a tenancy." }];
  if (await automated(tx, request.id)) return [{ templateKey: "U24", skip: "Handled by the provider network, which messages the tenant itself." }];
  return [plan("U24", await linkedRecipient(tx, request.tenantOrganisation.userId, { now: new Date() }), () => ({ recipient_name: firstName(request.tenantOrganisation!.user?.displayName ?? "there"), request_reference: request.referenceNumber ?? short("MR", request.id), property_name: placeName(request), status }))];
}

export const UTILITY_EVENT_NAMES = Object.keys(handlers);

const recipientKey = (phone: string) => createHash("sha256").update(whatsappRecipientE164(phone) ?? phone).digest("hex");

/** Decides one event exactly once (advisory lock + the dispatch ledger's unique key). */
export async function dispatchUtilityEvent(eventId: string) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-utility:${eventId}`}, 0))`;
    if (await tx.whatsAppUtilityDispatch.findFirst({ where: { domainEventId: eventId }, select: { id: true } })) return [];
    const event = await tx.domainEvent.findUnique({ where: { id: eventId } });
    const handler = event ? handlers[event.name] : undefined;
    if (!event || !handler) return [];
    const plans = await handler(tx, event);
    const decisions: Array<{ templateKey: string; outcome: "QUEUED" | "SKIPPED"; reason?: string; messageId?: string }> = [];
    const seen = new Set<string>();
    for (const item of plans) {
      const template = utilityTemplate(item.templateKey);
      if ("skip" in item) {
        decisions.push({ templateKey: item.templateKey, outcome: "SKIPPED", reason: item.skip });
        await tx.whatsAppUtilityDispatch.create({ data: { domainEventId: event.id, organisationId: event.organisationId, templateKey: item.templateKey, recipientKey: `none:${decisions.length}`, outcome: "SKIPPED", reason: item.skip } });
        continue;
      }
      const key = recipientKey(item.recipient.phone);
      if (seen.has(key)) continue;
      seen.add(key);
      const result = template.wiring.status === "WIRED"
        ? await queueUtilityTemplate(tx, { template, recipient: item.recipient, values: item.values, idempotencyKey: `${event.id}:${key.slice(0, 16)}`, metadata: { domainEventId: event.id, domainEvent: event.name, organisationId: event.organisationId } })
        : { outcome: "SKIPPED" as const, reason: "Template is not wired." };
      decisions.push({ templateKey: item.templateKey, ...result });
      await tx.whatsAppUtilityDispatch.create({ data: { domainEventId: event.id, organisationId: event.organisationId, templateKey: item.templateKey, recipientKey: key, outcome: result.outcome, reason: result.outcome === "SKIPPED" ? result.reason : null, messageId: result.outcome === "QUEUED" ? result.messageId : null } });
    }
    // Always leave a record, so the event is never considered again.
    if (!decisions.length) await tx.whatsAppUtilityDispatch.create({ data: { domainEventId: event.id, organisationId: event.organisationId, templateKey: "-", recipientKey: "none", outcome: "SKIPPED", reason: "No Utility template applies to this event." } });
    for (const decision of decisions) console.info(JSON.stringify({ event: "whatsapp.utility_dispatch", domainEvent: event.name, domainEventId: event.id, organisationId: event.organisationId, ...decision }));
    return decisions;
  }, { timeout: 30_000, maxWait: 10_000 });
}

/** Decides every recent, undecided event once. Runs with the job drain (worker and /api/jobs/run). */
export async function dispatchUtilityEvents(options: { now?: Date; limit?: number; env?: Record<string, string | undefined> } = {}) {
  const env = options.env ?? process.env;
  const since = env.WHATSAPP_UTILITY_EVENTS_SINCE?.trim() ? new Date(env.WHATSAPP_UTILITY_EVENTS_SINCE.trim()) : null;
  if (!since || Number.isNaN(since.getTime())) return { enabled: false as const, decided: 0, failed: 0 };
  const now = options.now ?? new Date();
  const floor = new Date(Math.max(since.getTime(), now.getTime() - MAX_AGE_MS));
  const events = await db.$queryRaw<Array<{ id: string }>>`
    SELECT e."id" FROM "DomainEvent" e
    WHERE e."name" = ANY(${UTILITY_EVENT_NAMES}) AND e."occurredAt" >= ${floor} AND e."occurredAt" <= ${now}
      AND NOT EXISTS (SELECT 1 FROM "WhatsAppUtilityDispatch" d WHERE d."domainEventId" = e."id")
    ORDER BY e."occurredAt" ASC
    LIMIT ${Math.max(1, Math.min(options.limit ?? 50, 200))}
  `;
  let decided = 0;
  let failed = 0;
  for (const { id } of events) {
    try {
      await dispatchUtilityEvent(id);
      decided += 1;
    } catch (error) {
      // Left undecided: tried again on the next pass until the event is 48 hours old.
      failed += 1;
      console.error(JSON.stringify({ event: "whatsapp.utility_dispatch_failed", domainEventId: id, error: error instanceof Error ? error.message : "unknown" }));
    }
  }
  return { enabled: true as const, decided, failed };
}
