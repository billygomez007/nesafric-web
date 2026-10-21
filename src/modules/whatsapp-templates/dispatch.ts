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
const BATCH_WINDOW_MS = 10 * 60_000;
const short = (prefix: string, id: string) => `${prefix}-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
const payloadOf = (event: DomainEvent) => (event.payload && typeof event.payload === "object" ? event.payload : {}) as Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const accraTime = (at: Date) => `${new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Accra" }).format(at).replace(" at ", ", ")} GMT`;
const accraDay = (at: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Accra" }).format(at);
const accraDate = (at: Date) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Accra" }).format(at);
const accraClock = (at: Date) => `${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Accra" }).format(at)} GMT`;

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
  return tx.viewingRequest.findUnique({ where: { id: viewingId }, include: { lead: true, listing: { select: { title: true, createdByUserId: true, listingRepresentativeUserId: true } }, preferredTimes: { orderBy: { startsAt: "asc" }, take: 1 } } });
}

/** The person showing the property: the listing's representative, else whoever listed it. */
async function agentName(tx: Tx, listing: { createdByUserId: string; listingRepresentativeUserId: string | null }) {
  const user = await tx.user.findUnique({ where: { id: listing.listingRepresentativeUserId ?? listing.createdByUserId }, select: { displayName: true } });
  return user?.displayName;
}

/** Enquiry stages the customer hears about; viewings and applications have their own messages. */
const LEAD_STATUS: Record<string, string> = { CONTACTED: "the agent has responded", CLOSED: "closed", LOST: "closed" };
const ASSIGNMENT_STATUS: Record<string, string> = { PENDING: "waiting for the provider to accept", ACCEPTED: "accepted by the provider" };
const REGISTRATION_TYPE: Record<string, string> = { INDIVIDUAL_AGENT: "agent", BROKER: "broker", BROKERAGE: "broker" };

const handlers: Record<string, Handler> = {
  // Category A: customer property enquiries
  "marketplace.lead_created": async (tx, event) => {
    const lead = await tx.marketplaceLead.findUnique({ where: { id: event.aggregateId }, include: { listing: { select: { title: true } } } });
    if (!lead) return [{ templateKey: "U01", skip: "The enquiry no longer exists." }];
    if (lead.source === "WHATSAPP") return [{ templateKey: "U01", skip: "Made on WhatsApp; answered in the chat." }];
    return [plan("U01", enquiryRecipient(lead), () => ({ recipient_name: firstName(lead.name), property_name: lead.listing.title, reference: short("EQ", lead.id) }))];
  },
  "viewing.confirmed": async (tx, event) => {
    const viewing = await viewingContext(tx, event.aggregateId);
    if (viewing?.status !== "CONFIRMED" || !viewing.confirmedStartsAt) return [{ templateKey: "U02", skip: "The viewing is no longer confirmed." }];
    const agent = await agentName(tx, viewing.listing);
    if (!agent) return [{ templateKey: "U02", skip: "The listing has no agent to name." }];
    return [plan("U02", enquiryRecipient(viewing.lead), () => ({ recipient_name: firstName(viewing.lead.name), property_name: viewing.listing.title, date: accraDate(viewing.confirmedStartsAt!), time: accraClock(viewing.confirmedStartsAt!), agent_name: agent }))];
  },
  "viewing.rescheduled": async (tx, event) => {
    const viewing = await viewingContext(tx, event.aggregateId);
    if (viewing?.status !== "RESCHEDULED") return [{ templateKey: "U04", skip: "The viewing changed again." }];
    if (!viewing.confirmedStartsAt) return [{ templateKey: "U04", skip: "No new time is set yet; the lister confirms it with the customer." }];
    return [plan("U04", enquiryRecipient(viewing.lead), () => ({ recipient_name: firstName(viewing.lead.name), property_name: viewing.listing.title, date: accraDate(viewing.confirmedStartsAt!), time: accraClock(viewing.confirmedStartsAt!) }))];
  },
  "listing.lead_status_changed": async (tx, event) => {
    const status = LEAD_STATUS[String(payloadOf(event).toStatus)];
    if (!status) return [];
    const lead = await tx.marketplaceLead.findFirst({ where: { id: event.aggregateId, organisationId: event.organisationId }, include: { listing: { select: { title: true } } } });
    if (!lead) return [{ templateKey: "U05", skip: "The enquiry does not belong to the event's workspace." }];
    // A later stage does not cancel "the agent has responded"; a reopened enquiry cancels "closed".
    const closed = (value: string) => value === "CLOSED" || value === "LOST";
    if (closed(String(payloadOf(event).toStatus)) !== closed(lead.status)) return [{ templateKey: "U05", skip: "The enquiry changed again." }];
    return [plan("U05", enquiryRecipient(lead), () => ({ recipient_name: firstName(lead.name), property_name: lead.listing.title, status, reference: short("EQ", lead.id) }))];
  },
  "listing.viewing_status_changed": async (tx, event) => {
    if (payloadOf(event).toStatus !== "CANCELLED") return [];
    const viewing = await viewingContext(tx, event.aggregateId);
    if (viewing?.status !== "CANCELLED") return [{ templateKey: "U06", skip: "The viewing is no longer cancelled." }];
    const scheduled = viewing.confirmedStartsAt ?? viewing.preferredTimes[0]?.startsAt;
    if (!scheduled) return [{ templateKey: "U06", skip: "The viewing had no time to name." }];
    return [plan("U06", enquiryRecipient(viewing.lead), () => ({ recipient_name: firstName(viewing.lead.name), property_name: viewing.listing.title, scheduled_for: accraTime(scheduled), reference: short("VW", viewing.id) }))];
  },

  // Category B: agent and broker onboarding
  "marketplace_professional.created": async (tx, event, now = new Date()) => {
    const professional = await tx.marketplaceProfessional.findUnique({ where: { id: event.aggregateId }, include: { createdBy: { select: { displayName: true } } } });
    if (!professional) return [{ templateKey: "U07", skip: "The profile no longer exists." }];
    const recipient = await linkedRecipient(tx, professional.createdByUserId, { selfInitiated: true, now });
    return [plan("U07", recipient, () => ({ recipient_name: firstName(professional.createdBy.displayName), registration_type: REGISTRATION_TYPE[professional.type] ?? "business", business_name: professional.displayName, reference: short("RG", professional.id) }))];
  },
  "marketplace_professional.verification_reviewed": async (tx, event) => {
    const { toStatus, reason } = payloadOf(event);
    const templateKey = toStatus === "VERIFIED" ? "U08" : toStatus === "REJECTED" ? "U09" : toStatus === "SUSPENDED" ? "U30" : null;
    if (!templateKey) return [];
    const professional = await tx.marketplaceProfessional.findUnique({ where: { id: event.aggregateId }, include: { members: { where: { status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } }, include: { user: { select: { displayName: true } } } } } });
    if (!professional?.members.length) return [{ templateKey, skip: "The profile has no active owner or admin." }];
    const extra: Record<string, string> = templateKey === "U09" ? { required_information: text(reason) ?? "updated verification details" }
      : templateKey === "U30" ? { status: "suspended", reference: short("AS", event.id) } : {};
    return Promise.all(professional.members.map(async (member) => plan(templateKey, await linkedRecipient(tx, member.userId, { now: new Date() }), () => ({
      recipient_name: firstName(member.user.displayName), [templateKey === "U30" ? "profile_name" : "business_name"]: professional.displayName, ...extra,
    }))));
  },
  "listing.pending_review": async (tx, event) => {
    const listing = await tx.listing.findUnique({ where: { id: event.aggregateId }, include: { createdBy: { select: { displayName: true } } } });
    if (listing?.status !== "PENDING_REVIEW") return [{ templateKey: "U10", skip: "The listing is no longer pending review." }];
    return [plan("U10", await linkedRecipient(tx, listing.createdByUserId, { selfInitiated: true, now: new Date() }), () => ({ recipient_name: firstName(listing.createdBy.displayName), property_title: listing.title, reference: short("LS", listing.id), status: "pending review" }))];
  },
  "listing.published": async (tx, event) => listingReviewed(tx, event, "PUBLISHED"),
  "listing.rejected": async (tx, event) => listingReviewed(tx, event, "REJECTED"),

  // Category C: landlord and property manager onboarding
  "organisation.created": async (tx, event) => {
    if (event.organisationId === officialWhatsAppOrganisationId()) return [];
    // A marketplace profile's hidden backing organisation is not a workspace (U07 covers it).
    if (await tx.marketplaceProfessional.findUnique({ where: { backingOrganisationId: event.organisationId }, select: { id: true } })) return [];
    const organisation = await tx.organisation.findUnique({ where: { id: event.organisationId }, include: { members: { where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" }, take: 1, include: { user: { select: { displayName: true } } } } } });
    const owner = organisation?.members[0];
    if (!organisation || !owner) return [{ templateKey: "U13", skip: "The workspace has no active owner." }];
    return [plan("U13", await linkedRecipient(tx, owner.userId, { selfInitiated: true, now: new Date() }), () => ({ recipient_name: firstName(owner.user.displayName), workspace_name: organisation.name }))];
  },
  "property.created": async (tx, event) => {
    if (event.organisationId === officialWhatsAppOrganisationId()) return [];
    if (await tx.marketplaceProfessional.findUnique({ where: { backingOrganisationId: event.organisationId }, select: { id: true } })) return [];
    const property = await tx.property.findFirst({ where: { id: event.aggregateId, organisationId: event.organisationId } });
    const workspace = await tx.organisation.findUnique({ where: { id: event.organisationId }, select: { name: true } });
    if (!property || !workspace) return [{ templateKey: "U15", skip: "The property does not belong to the event's workspace." }];
    // Whoever added it (from the audit record written in the same transaction).
    const added = await tx.auditEvent.findFirst({ where: { organisationId: event.organisationId, action: "property.created", entityId: property.id }, orderBy: { createdAt: "desc" }, select: { actor: { select: { id: true, displayName: true } } } });
    if (!added?.actor) return [{ templateKey: "U15", skip: "No one is recorded as adding the property." }];
    // A bulk import or onboarding adds many properties at once: one message, not one per property.
    if (await tx.whatsAppUtilityDispatch.count({ where: { organisationId: event.organisationId, templateKey: "U15", outcome: "QUEUED", createdAt: { gte: new Date(Date.now() - BATCH_WINDOW_MS) } } })) return [{ templateKey: "U15", skip: "Another property added moments ago was already confirmed." }];
    const actor = added.actor;
    return [plan("U15", await linkedRecipient(tx, actor.id, { selfInitiated: true, now: new Date() }), () => ({ recipient_name: firstName(actor.displayName), property_name: property.name, workspace_name: workspace.name, property_reference: property.referenceNumber ?? short("PR", property.id) }))];
  },
  "portfolio_verification.rejected": async (tx, event) => {
    const claim = await tx.portfolioVerification.findUnique({ where: { id: event.aggregateId }, include: { property: { select: { name: true } }, organisation: { select: { name: true } }, claimedBy: { select: { displayName: true } } } });
    if (claim?.status !== "REJECTED") return [{ templateKey: "U16", skip: "The claim's decision changed." }];
    return [plan("U16", await linkedRecipient(tx, claim.claimedByUserId, { now: new Date() }), () => ({
      recipient_name: firstName(claim.claimedBy.displayName), property_name: claim.property?.name ?? claim.organisation.name, required_information: text(claim.reviewNote) ?? "more details about your ownership or authority",
    }))];
  },

  // Category D: tenant management
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
    const property = await invitationProperty(tx, invitation);
    if (!property) return [{ templateKey: "U17", skip: "The tenancy has no property to name." }];
    // The reference names the invitation; the access code itself never leaves the landlord's screen.
    return [{ templateKey: "U17", recipient: { phone: relationship.phone, displayName: relationship.tenant.legalName, basis: "TENANT_CONSENT_RECORDED" }, values: { recipient_name: firstName(relationship.tenant.legalName), landlord_name: relationship.organisation.name, property_name: property, invitation_reference: invitationReference(invitation.id) } }];
  },
  "tenant.access_invitation_redeemed": async (tx, event) => {
    const { userId: rawUserId, invitationId: rawInvitationId } = payloadOf(event);
    const userId = text(rawUserId);
    const invitationId = text(rawInvitationId);
    const relationship = await tx.tenantOrganisation.findUnique({ where: { id: event.aggregateId }, include: { organisation: { select: { name: true } }, user: { select: { displayName: true } }, tenant: { select: { legalName: true } } } });
    if (!relationship || relationship.organisationId !== event.organisationId || relationship.userId !== userId) return [{ templateKey: "U19", skip: "The tenancy is not connected to this account." }];
    const invitation = invitationId ? await tx.tenantAccessInvitation.findFirst({ where: { id: invitationId, tenantOrganisationId: relationship.id, redeemedByUserId: userId }, include: { createdBy: { select: { id: true, displayName: true } }, lease: { select: { property: { select: { name: true } } } } } }) : null;
    const property = invitation ? await invitationProperty(tx, invitation) : null;
    if (!invitation || !property) return [{ templateKey: "U19", skip: "The redeemed invitation or its property is missing." }];
    const tenant = await linkedRecipient(tx, userId, { selfInitiated: true, now: new Date() });
    const landlord = await linkedRecipient(tx, invitation.createdBy.id, { now: new Date() });
    return [
      plan("U19", tenant, () => ({ recipient_name: firstName(relationship.user?.displayName ?? relationship.tenant.legalName), property_name: property, manager_name: relationship.organisation.name })),
      plan("U18", landlord, () => ({ recipient_name: firstName(invitation.createdBy.displayName), tenant_name: relationship.tenant.legalName, property_name: property, invitation_reference: invitationReference(invitation.id) })),
    ];
  },
  "lease.amended": async (tx, event) => tenancyUpdated(tx, event),
  "lease.terminated": async (tx, event) => tenancyEnded(tx, event),
  "lease.expired": async (tx, event) => tenancyEnded(tx, event),

  // Category E: property operations
  "maintenance.requested": async (tx, event) => {
    if (payloadOf(event).intakeChannel === "WHATSAPP") return [{ templateKey: "U23", skip: "Reported on WhatsApp; answered in the chat." }];
    const request = await maintenanceContext(tx, event.aggregateId, event.organisationId);
    if (!request) return [{ templateKey: "U23", skip: NOT_IN_WORKSPACE }];
    if (!request.tenantOrganisation) return [{ templateKey: "U23", skip: "The request is not linked to a tenancy." }];
    return [plan("U23", await linkedRecipient(tx, request.tenantOrganisation.userId, { now: new Date() }), () => ({ recipient_name: requesterName(request), property_name: placeName(request), ticket: ticket(request), status: "received" }))];
  },
  "workorder.assigned": async (tx, event) => {
    // Assigning the landlord's own staff is internal; the tenant hears when a provider is assigned.
    const assignmentId = text(payloadOf(event).providerAssignmentId);
    if (!assignmentId) return [];
    const workOrder = await tx.workOrder.findFirst({ where: { id: event.aggregateId, organisationId: event.organisationId }, select: { maintenanceRequestId: true, routingRuleId: true } });
    if (!workOrder) return [{ templateKey: "U24", skip: "The work order does not belong to the event's workspace." }];
    if (workOrder.routingRuleId) return [{ templateKey: "U24", skip: "Handled by the provider network, which messages the tenant itself." }];
    const request = await maintenanceContext(tx, workOrder.maintenanceRequestId, event.organisationId);
    if (!request?.tenantOrganisation) return [{ templateKey: "U24", skip: "The request is not linked to a tenancy." }];
    const assignment = await tx.providerAssignment.findFirst({ where: { id: assignmentId, workOrderId: event.aggregateId }, select: { status: true, provider: { select: { displayName: true } } } });
    const status = assignment && ASSIGNMENT_STATUS[assignment.status];
    if (!assignment || !status) return [{ templateKey: "U24", skip: "The provider assignment is no longer active." }];
    return [plan("U24", await linkedRecipient(tx, request.tenantOrganisation.userId, { now: new Date() }), () => ({ recipient_name: requesterName(request), ticket: ticket(request), provider_name: assignment.provider.displayName, status }))];
  },
  "maintenance.started": async (tx, event) => maintenanceUpdate(tx, event, "work has started"),
  "maintenance.rejected": async (tx, event) => maintenanceUpdate(tx, event, "not approved by your landlord"),
  "maintenance.cancelled": async (tx, event) => maintenanceUpdate(tx, event, "cancelled"),
  "maintenance.completed": async (tx, event) => {
    const request = await maintenanceContext(tx, event.aggregateId, event.organisationId);
    if (!request) return [{ templateKey: "U26", skip: NOT_IN_WORKSPACE }];
    if (!request.tenantOrganisation) return [{ templateKey: "U26", skip: "The request is not linked to a tenancy." }];
    if (await automated(tx, request.id)) return [{ templateKey: "U26", skip: "Handled by the provider network, which messages the tenant itself." }];
    return [plan("U26", await linkedRecipient(tx, request.tenantOrganisation.userId, { now: new Date() }), () => ({ recipient_name: requesterName(request), ticket: ticket(request), property_name: placeName(request) }))];
  },

  // Category F: account and document activity
  "listing.verification_submitted": async (tx, event) => {
    const listing = await tx.listing.findFirst({ where: { id: event.aggregateId, organisationId: event.organisationId }, include: { createdBy: { select: { displayName: true } } } });
    if (!listing) return [{ templateKey: "U28", skip: "The listing does not belong to the event's workspace." }];
    return [plan("U28", await linkedRecipient(tx, listing.createdByUserId, { selfInitiated: true, now: new Date() }), () => ({ recipient_name: firstName(listing.createdBy.displayName), document_purpose: `verification of ${listing.title}`, reference: short("DC", listing.id), status: "under review" }))];
  },
  "listing.verification_verified": async (tx, event) => listingEvidenceReviewed(tx, event, true),
  "listing.verification_rejected": async (tx, event) => listingEvidenceReviewed(tx, event, false),
};

const invitationReference = (invitationId: string) => short("TI", invitationId);
async function invitationProperty(tx: Tx, invitation: { tenantOrganisationId: string; lease: { property: { name: string } } | null }) {
  return invitation.lease?.property.name ?? (await tx.leaseParty.findFirst({ where: { tenantOrganisationId: invitation.tenantOrganisationId }, orderBy: { createdAt: "desc" }, select: { lease: { select: { property: { select: { name: true } } } } } }))?.lease.property.name;
}

/** The lease in the event's own workspace, with the tenants whose own accounts are connected to it. */
async function leaseTenants(tx: Tx, event: DomainEvent) {
  const lease = await tx.lease.findFirst({ where: { id: event.aggregateId, organisationId: event.organisationId }, include: { organisation: { select: { name: true } }, property: { select: { name: true } }, unit: { select: { name: true } }, parties: { include: { tenantOrganisation: { select: { userId: true, user: { select: { displayName: true } } } } } } } });
  return lease && { lease, tenants: lease.parties.map(({ tenantOrganisation }) => tenantOrganisation).filter((tenant) => tenant.userId) };
}

/** An amendment to a lease that is not a draft (draft terms change freely while being prepared). */
async function tenancyUpdated(tx: Tx, event: DomainEvent): Promise<Plan[]> {
  const found = await leaseTenants(tx, event);
  if (!found) return [{ templateKey: "U20", skip: "The lease does not belong to the event's workspace." }];
  const { lease, tenants } = found;
  if (lease.status === "DRAFT") return [{ templateKey: "U20", skip: "The lease is still a draft." }];
  if (!tenants.length) return [{ templateKey: "U20", skip: "No tenant on the lease has connected an account." }];
  return Promise.all(tenants.map(async (tenant) => plan("U20", await linkedRecipient(tx, tenant.userId, { now: new Date() }), () => ({
    recipient_name: firstName(tenant.user?.displayName ?? "there"), property_name: placeName(lease), manager_name: lease.organisation.name, reference: short("TU", event.id),
  }))));
}

/** A lease that ended (terminated, or expired at its end date): the tenancy on it is over. */
async function tenancyEnded(tx: Tx, event: DomainEvent): Promise<Plan[]> {
  const found = await leaseTenants(tx, event);
  if (!found) return [{ templateKey: "U22", skip: "The lease does not belong to the event's workspace." }];
  const { lease, tenants } = found;
  if (lease.status !== "TERMINATED" && lease.status !== "EXPIRED") return [{ templateKey: "U22", skip: "The lease is no longer ended." }];
  if (!tenants.length) return [{ templateKey: "U22", skip: "No tenant on the lease has connected an account." }];
  const effective = lease.status === "EXPIRED" && lease.endDate ? lease.endDate : event.occurredAt;
  return Promise.all(tenants.map(async (tenant) => plan("U22", await linkedRecipient(tx, tenant.userId, { now: new Date() }), () => ({
    recipient_name: firstName(tenant.user?.displayName ?? "there"), property_name: placeName(lease), date: accraDay(effective), contact: lease.organisation.name,
  }))));
}

async function listingReviewed(tx: Tx, event: DomainEvent, toStatus: "PUBLISHED" | "REJECTED"): Promise<Plan[]> {
  if (payloadOf(event).fromStatus !== "PENDING_REVIEW") return [];
  const listing = await tx.listing.findUnique({ where: { id: event.aggregateId }, include: { createdBy: { select: { displayName: true } } } });
  if (!listing) return [{ templateKey: "U11", skip: "The listing no longer exists." }];
  const decision = await tx.listingStatusHistory.findFirst({ where: { listingId: listing.id, toStatus }, orderBy: { createdAt: "desc" }, select: { actorUserId: true } });
  if (decision?.actorUserId === listing.createdByUserId) return [{ templateKey: "U11", skip: "Decided by the listing's own creator." }];
  return [plan("U11", await linkedRecipient(tx, listing.createdByUserId, { now: new Date() }), () => ({ recipient_name: firstName(listing.createdBy.displayName), property_title: listing.title, status: toStatus === "PUBLISHED" ? "published" : "not approved", reference: short("LS", listing.id) }))];
}

async function listingEvidenceReviewed(tx: Tx, event: DomainEvent, verified: boolean): Promise<Plan[]> {
  const listing = await tx.listing.findUnique({ where: { id: event.aggregateId }, include: { createdBy: { select: { displayName: true } } } });
  if (!listing) return [{ templateKey: "U29", skip: "The listing no longer exists." }];
  const note = text(payloadOf(event).note);
  return [plan("U29", await linkedRecipient(tx, listing.createdByUserId, { now: new Date() }), () => ({ recipient_name: firstName(listing.createdBy.displayName), document_purpose: `verification of ${listing.title}`, result: verified ? "verified" : `not verified${note ? ` (${note})` : ""}`, reference: short("DC", listing.id) }))];
}

const NOT_IN_WORKSPACE = "The request does not belong to the event's workspace.";
/** Scoped to the event's own workspace: an event can never reach another workspace's request or tenant. */
async function maintenanceContext(tx: Tx, requestId: string, organisationId: string) {
  return tx.maintenanceRequest.findFirst({ where: { id: requestId, organisationId }, include: { property: { select: { name: true } }, unit: { select: { name: true } }, tenantOrganisation: { select: { userId: true, user: { select: { displayName: true } } } } } });
}
type MaintenanceContext = NonNullable<Awaited<ReturnType<typeof maintenanceContext>>>;
const placeName = (place: { property: { name: string }; unit: { name: string } | null }) => place.unit ? `${place.property.name}, ${place.unit.name}` : place.property.name;
const ticket = (request: MaintenanceContext) => request.referenceNumber ?? short("MR", request.id);
const requesterName = (request: MaintenanceContext) => firstName(request.tenantOrganisation?.user?.displayName ?? "there");
/** Requests the routing rules dispatched: the provider-network messages already keep the tenant informed. */
const automated = async (tx: Tx, requestId: string) => (await tx.workOrder.count({ where: { maintenanceRequestId: requestId, routingRuleId: { not: null } } })) > 0;

async function maintenanceUpdate(tx: Tx, event: DomainEvent, status: string): Promise<Plan[]> {
  const request = await maintenanceContext(tx, event.aggregateId, event.organisationId);
  if (!request) return [{ templateKey: "U25", skip: NOT_IN_WORKSPACE }];
  if (!request.tenantOrganisation) return [{ templateKey: "U25", skip: "The request is not linked to a tenancy." }];
  if (await automated(tx, request.id)) return [{ templateKey: "U25", skip: "Handled by the provider network, which messages the tenant itself." }];
  return [plan("U25", await linkedRecipient(tx, request.tenantOrganisation.userId, { now: new Date() }), () => ({ recipient_name: requesterName(request), ticket: ticket(request), property_name: placeName(request), status }))];
}

export const UTILITY_EVENT_NAMES = Object.keys(handlers);

/** The dispatch ledger's key for a recipient: a hash, never the number itself. */
export const recipientKey = (phone: string) => createHash("sha256").update(whatsappRecipientE164(phone) ?? phone).digest("hex");

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
