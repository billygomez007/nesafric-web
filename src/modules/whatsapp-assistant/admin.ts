import { z } from "zod";
import type { PlatformPrincipal } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { forbidden, notFound } from "@/platform/errors";
import { maskPhone } from "@/platform/identity/phone";
import { PLATFORM_PERMISSIONS, platformRoleHasPermission, type PlatformPermission } from "@/platform/platform-admin/permissions";
import { isUuid } from "@/platform/validation/uuid";
import { canSendWhatsApp, whatsAppAssistantConfig } from "./config";
import { referenceFor } from "./references";
import { queueNotification } from "./store";

/**
 * Platform-admin view of the WhatsApp assistant. Every figure is a count over recorded events or
 * stored rows — nothing is estimated. Personal data is minimised: phone numbers are masked and
 * message bodies are never listed; staff see support summaries the person wrote for them.
 */

function requirePermission(principal: PlatformPrincipal, permission: PlatformPermission) {
  if (principal.status !== "ACTIVE" || !platformRoleHasPermission(principal.role, permission)) throw forbidden();
}

const overviewSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  supportStatus: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]).optional(),
}).strict();

const COUNTED_EVENTS = [
  "workflow_started", "workflow_cancelled", "property_search", "property_search_zero", "property_search_error", "service_search", "service_search_zero",
  "property_inquiry_created", "viewing_requested", "service_quote_requested", "business_registered", "provider_registered",
  "listing_draft_created", "listing_submitted", "listing_published", "media_failed", "outbound_failed", "processing_error", "support_requested",
  "intent_unclear", "rate_limited", "opted_out", "publication_not_visible",
] as const;

export async function getWhatsAppAssistantOverview(principal: PlatformPrincipal, input: unknown = {}) {
  requirePermission(principal, PLATFORM_PERMISSIONS.communicationsRead);
  const { days, supportStatus } = overviewSchema.parse(input);
  const since = new Date(Date.now() - days * 86_400_000);
  const config = whatsAppAssistantConfig();

  const [eventCounts, totalContacts, activeContacts, inProgress, outboundByStatus, whatsappListings, reviewDurations, support, failures, submissions] = await Promise.all([
    db.whatsAppAssistantEvent.groupBy({ by: ["name"], where: { createdAt: { gte: since }, name: { in: [...COUNTED_EVENTS] } }, _count: { _all: true } }),
    db.whatsAppContact.count(),
    db.whatsAppContact.count({ where: { lastInboundAt: { gte: since } } }),
    db.whatsAppAssistantSession.groupBy({ by: ["workflow"], where: { workflow: { not: null } }, _count: { _all: true } }),
    db.whatsAppOutboundMessage.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    db.listing.groupBy({ by: ["status"], where: { sourceChannel: "WHATSAPP" }, _count: { _all: true } }),
    db.listing.findMany({ where: { sourceChannel: "WHATSAPP", publishedAt: { gte: since }, submittedAt: { not: null } }, select: { submittedAt: true, publishedAt: true }, take: 1000 }),
    db.whatsAppSupportRequest.findMany({
      where: supportStatus ? { status: supportStatus } : { status: { not: "RESOLVED" } },
      orderBy: { createdAt: "asc" },
      take: 100,
      include: { contact: { select: { phoneE164: true, waId: true, profileName: true, lastInboundAt: true, userId: true } } },
    }),
    db.whatsAppInboundMessage.findMany({
      where: { status: { in: ["FAILED", "IGNORED"] }, receivedAt: { gte: since } },
      orderBy: { receivedAt: "desc" },
      take: 50,
      select: { id: true, type: true, status: true, lastError: true, attempts: true, receivedAt: true, contact: { select: { phoneE164: true, waId: true } } },
    }),
    Promise.all([
      db.listing.findMany({ where: { sourceChannel: "WHATSAPP" }, orderBy: { updatedAt: "desc" }, take: 20, select: { id: true, title: true, status: true, verificationStatus: true, submittedAt: true, updatedAt: true, marketplaceProfessional: { select: { displayName: true } } } }),
      db.marketplaceProfessional.findMany({ where: { sourceChannel: "WHATSAPP" }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, displayName: true, type: true, verificationStatus: true, createdAt: true } }),
      db.serviceProvider.findMany({ where: { sourceChannel: "WHATSAPP" }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, displayName: true, type: true, verificationStatus: true, createdAt: true, marketplaceProfile: { select: { listed: true } } } }),
    ]),
  ]);

  const events = Object.fromEntries(eventCounts.map(({ name, _count }) => [name, _count._all])) as Record<string, number>;
  const count = (name: string) => events[name] ?? 0;
  const reviewHours = reviewDurations.map(({ submittedAt, publishedAt }) => (publishedAt!.getTime() - submittedAt!.getTime()) / 3_600_000).filter((hours) => hours >= 0);
  const started = count("workflow_started");
  const completed = count("property_inquiry_created") + count("viewing_requested") + count("service_quote_requested") + count("business_registered") + count("provider_registered") + count("listing_submitted") + count("support_requested");
  const masked = (contact: { phoneE164: string | null; waId: string }) => maskPhone(contact.phoneE164 ?? `+${contact.waId}`);

  return {
    configuration: {
      enabled: config.enabled,
      sendingConfigured: canSendWhatsApp(config),
      webhookSecretConfigured: Boolean(config.appSecret),
      verifyTokenConfigured: Boolean(config.verifyToken),
      statusTemplateConfigured: Boolean(config.statusTemplateName),
    },
    period: { days, since },
    metrics: {
      contacts: { total: totalContacts, activeInPeriod: activeContacts },
      workflows: {
        started,
        completed,
        cancelled: count("workflow_cancelled"),
        inProgressNow: inProgress.reduce((sum, row) => sum + row._count._all, 0),
        inProgressByWorkflow: Object.fromEntries(inProgress.map(({ workflow, _count }) => [workflow, _count._all])),
      },
      propertySearches: { total: count("property_search"), zeroResults: count("property_search_zero"), errors: count("property_search_error") },
      serviceSearches: { total: count("service_search"), zeroResults: count("service_search_zero") },
      customerRequests: { inquiries: count("property_inquiry_created"), viewings: count("viewing_requested"), serviceQuotes: count("service_quote_requested") },
      registrations: { businesses: count("business_registered"), serviceProviders: count("provider_registered") },
      listings: {
        draftsCreated: count("listing_draft_created"),
        submitted: count("listing_submitted"),
        published: count("listing_published"),
        byStatus: Object.fromEntries(whatsappListings.map(({ status, _count }) => [status, _count._all])),
        averageReviewHours: reviewHours.length ? Math.round((reviewHours.reduce((sum, hours) => sum + hours, 0) / reviewHours.length) * 10) / 10 : null,
      },
      failures: {
        mediaUploads: count("media_failed"),
        outboundMessages: count("outbound_failed"),
        processing: count("processing_error"),
        publicationNotVisible: count("publication_not_visible"),
        rateLimited: count("rate_limited"),
      },
      outboundByStatus: Object.fromEntries(outboundByStatus.map(({ status, _count }) => [status, _count._all])),
      unclearMessages: count("intent_unclear"),
      optOuts: count("opted_out"),
    },
    support: support.map((request) => ({
      id: request.id,
      reference: request.reference,
      topic: request.topic,
      summary: request.summary,
      workflow: request.workflow,
      status: request.status,
      createdAt: request.createdAt,
      resolvedAt: request.resolvedAt,
      resolutionNote: request.resolutionNote,
      contact: {
        name: request.contact.profileName,
        phone: masked(request.contact),
        hasAccount: Boolean(request.contact.userId),
        canReplyFreely: Boolean(request.contact.lastInboundAt && Date.now() - request.contact.lastInboundAt.getTime() < 24 * 3_600_000),
      },
    })),
    failedMessages: failures.map((failure) => ({ id: failure.id, type: failure.type, status: failure.status, error: failure.lastError, attempts: failure.attempts, receivedAt: failure.receivedAt, phone: masked(failure.contact) })),
    submissions: {
      listings: submissions[0].map((listing) => ({ ...listing, reference: referenceFor("PR", listing.id), professional: listing.marketplaceProfessional?.displayName ?? null })),
      professionals: submissions[1].map((professional) => ({ ...professional, reference: referenceFor("AG", professional.id) })),
      serviceProviders: submissions[2].map((provider) => ({ id: provider.id, displayName: provider.displayName, type: provider.type, verificationStatus: provider.verificationStatus, createdAt: provider.createdAt, listed: Boolean(provider.marketplaceProfile?.listed), reference: referenceFor("SV", provider.id) })),
    },
  };
}

const supportUpdateSchema = z.object({
  status: z.enum(["IN_PROGRESS", "RESOLVED"]).optional(),
  note: z.string().trim().min(1).max(2000).optional(),
  reply: z.string().trim().min(1).max(1500).optional(),
}).strict().refine((value) => value.status || value.reply, "A status or a reply is required.");

/**
 * A support agent replies to the person on WhatsApp and/or moves the request along. The reply goes
 * through the same window/template/opt-out rules as every notification, and the action is audited.
 */
export async function updateWhatsAppSupportRequest(principal: PlatformPrincipal, requestId: string, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.whatsAppSupportManage);
  if (!isUuid(requestId)) throw notFound();
  const data = supportUpdateSchema.parse(input);
  const request = await db.whatsAppSupportRequest.findUnique({ where: { id: requestId } });
  if (!request) throw notFound();
  let delivery: { skipped: boolean; reason: string | null } | null = null;
  if (data.reply) {
    delivery = await queueNotification(request.contactId, `support-reply:${request.id}:${Date.now()}`, `💬 NesAfric support (${request.reference}):\n${data.reply}`);
  }
  const updated = await db.$transaction(async (tx) => {
    const next = await tx.whatsAppSupportRequest.update({
      where: { id: requestId },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.note ? { resolutionNote: data.note } : {}),
        ...(data.status === "RESOLVED" ? { resolvedAt: new Date(), resolvedByUserId: principal.userId } : {}),
      },
    });
    await tx.platformAuditEvent.create({
      data: {
        platformPrincipalId: principal.id,
        action: data.status === "RESOLVED" ? "platform_admin.whatsapp_support_resolved" : data.reply ? "platform_admin.whatsapp_support_replied" : "platform_admin.whatsapp_support_updated",
        entityType: "whatsapp_support_request",
        entityId: requestId,
        metadata: { fromStatus: request.status, toStatus: next.status, replied: Boolean(data.reply), replySkipped: delivery?.skipped ?? null },
      },
    });
    return next;
  });
  return { request: updated, delivery };
}
