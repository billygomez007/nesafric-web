import { randomBytes } from "node:crypto";
import { Prisma, type ConversationChannel, type ConversationStatus } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { AppError, notFound } from "@/platform/errors";
import { enqueueJob } from "@/platform/jobs/runner";
import { hashSessionToken } from "@/platform/auth/session";
import { createMarketplaceLead, createViewingRequest } from "@/modules/listings/service";
import { createAIEmployeeHandoff, receptionistMaintenanceIntake, selectReceptionistForProperty } from "@/modules/ai-employees/service";
import { canAccessPrivateData, resolveTenantIdentity } from "./identity";
import { getChannelAdapter, type ChannelAdapters } from "./channels/registry";
import { assertOperational } from "@/modules/entitlements/service";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";
import {
  assignConversationSchema,
  channelConfigSchema,
  conversationListSchema,
  conversationStatusUpdateSchema,
  inboundChannelMessageSchema,
  postWebChatMessageSchema,
  sendConversationMessageSchema,
  startWebChatConversationSchema,
  webChatViewingRequestSchema,
} from "./schemas";

const json = (value: unknown) => value as Prisma.InputJsonValue;

const conversationDetailInclude = {
  participants: true,
  messages: { orderBy: { createdAt: "asc" as const }, include: { deliveries: true } },
  assignments: { orderBy: { createdAt: "asc" as const } },
  assignedAIEmployee: { select: { id: true, name: true, role: true, status: true } },
  assignedMember: { select: { id: true, user: { select: { id: true, displayName: true } } } },
  tenantOrganisation: { select: { id: true, tenant: { select: { legalName: true } } } },
  property: { select: { id: true, name: true } },
  listing: { select: { id: true, title: true } },
  marketplaceLead: { select: { id: true, status: true, name: true } },
  maintenanceRequest: { select: { id: true, title: true, status: true } },
} satisfies Prisma.ConversationInclude;

async function record(organisationId: string, actorUserId: string | undefined, name: string, aggregateType: string, aggregateId: string, payload: Record<string, unknown> = {}) {
  await db.auditEvent.create({ data: { organisationId, actorUserId, action: name, entityType: aggregateType, entityId: aggregateId, metadata: json(payload) } });
  await db.domainEvent.create({ data: { organisationId, name, aggregateType, aggregateId, payload: json(payload) } });
}

function mintChatToken() {
  const token = randomBytes(24).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

const RATE_LIMIT_WINDOW_MS = 10 * 60_000;
const RATE_LIMIT_MAX_INBOUND = 30;
const LOOP_GUARD_MAX_CONSECUTIVE_AI_MESSAGES = 3;

async function enforceInboundRateLimit(organisationId: string, conversationId: string) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const count = await db.message.count({ where: { organisationId, conversationId, direction: "INBOUND", createdAt: { gte: since } } });
  if (count >= RATE_LIMIT_MAX_INBOUND) {
    await record(organisationId, undefined, "communication.rate_limited", "conversation", conversationId, { count, windowMs: RATE_LIMIT_WINDOW_MS });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Web chat (public, anonymous-or-authenticated prospect/tenant surface)
// ---------------------------------------------------------------------------

async function resolveWebChatContext(input: { listingId?: string; propertyId?: string }) {
  if (input.listingId) {
    const listing = await db.listing.findFirst({
      where: { id: input.listingId, status: "PUBLISHED", verificationStatus: "VERIFIED" },
      select: { id: true, organisationId: true, propertyId: true, title: true },
    });
    if (!listing) throw notFound();
    return { organisationId: listing.organisationId, propertyId: listing.propertyId, listingId: listing.id, listingTitle: listing.title };
  }
  const property = await db.property.findFirst({ where: { id: input.propertyId, archivedAt: null }, select: { id: true, organisationId: true } });
  if (!property) throw notFound();
  return { organisationId: property.organisationId, propertyId: property.id, listingId: undefined, listingTitle: undefined };
}

export async function startWebChatConversation(input: unknown, context: { userId?: string } = {}) {
  const data = startWebChatConversationSchema.parse(input);
  const target = await resolveWebChatContext(data);
  const identity = await resolveTenantIdentity(target.organisationId, {
    userId: context.userId,
    email: data.visitorEmail,
    phone: data.visitorPhone,
  });
  let marketplaceLeadId: string | undefined;
  if (target.listingId && (data.visitorEmail || data.visitorPhone) && identity.level !== "VERIFIED") {
    const lead = await createMarketplaceLead(target.listingId, context.userId, {
      name: data.visitorName ?? "Website visitor",
      email: data.visitorEmail,
      phone: data.visitorPhone,
      message: data.message,
      marketingConsent: false,
      source: "web_chat",
    }).catch(() => null);
    marketplaceLeadId = lead?.id;
  }
  const { token, tokenHash } = mintChatToken();
  const conversation = await db.$transaction(async (tx) => {
    const created = await tx.conversation.create({
      data: {
        organisationId: target.organisationId,
        channel: "WEB_CHAT",
        status: "OPEN",
        subject: data.subject ?? target.listingTitle ?? "Website enquiry",
        channelAddress: `webchat:${tokenHash.slice(0, 24)}`,
        identityLevel: identity.level,
        propertyId: target.propertyId,
        listingId: target.listingId,
        marketplaceLeadId,
        tenantOrganisationId: identity.tenantOrganisationId ?? undefined,
        webChatTokenHash: tokenHash,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(),
        participants: {
          create: {
            organisationId: target.organisationId,
            type: identity.level === "VERIFIED" ? "TENANT" : "PROSPECT",
            userId: context.userId,
            tenantOrganisationId: identity.tenantOrganisationId ?? undefined,
            displayName: data.visitorName,
            email: data.visitorEmail,
            phone: data.visitorPhone,
            verifiedAt: identity.level === "VERIFIED" ? new Date() : undefined,
          },
        },
        messages: {
          create: {
            organisationId: target.organisationId,
            channel: "WEB_CHAT",
            direction: "INBOUND",
            senderType: identity.level === "VERIFIED" ? "TENANT" : "PROSPECT",
            body: data.message,
          },
        },
      },
    });
    await record(target.organisationId, context.userId, "conversation.created", "conversation", created.id, { channel: "WEB_CHAT", listingId: target.listingId, propertyId: target.propertyId });
    await record(target.organisationId, context.userId, "message.received", "conversation", created.id, { channel: "WEB_CHAT" });
    return created;
  });
  await routeInboundMessage(conversation.id).catch(() => undefined);
  return { conversationId: conversation.id, chatToken: token, marketplaceLeadId };
}

async function requireWebChatConversation(conversationId: string, chatToken: string) {
  const conversation = await db.conversation.findFirst({ where: { id: conversationId, webChatTokenHash: hashSessionToken(chatToken) } });
  if (!conversation) throw new AppError("CHAT_TOKEN_INVALID", 401, "This web chat session is invalid or has expired.");
  return conversation;
}

export async function postWebChatMessage(conversationId: string, input: unknown, context: { userId?: string } = {}) {
  const data = postWebChatMessageSchema.parse(input);
  const conversation = await requireWebChatConversation(conversationId, data.chatToken);
  if (await enforceInboundRateLimit(conversation.organisationId, conversation.id)) {
    throw new AppError("COMMUNICATION_RATE_LIMITED", 429, "Too many messages sent. Please try again shortly.");
  }
  const status: ConversationStatus = conversation.status === "RESOLVED" || conversation.status === "CLOSED" ? "OPEN" : conversation.status;
  await db.$transaction(async (tx) => {
    await tx.message.create({
      data: { organisationId: conversation.organisationId, conversationId: conversation.id, channel: "WEB_CHAT", direction: "INBOUND", senderType: conversation.identityLevel === "VERIFIED" ? "TENANT" : "PROSPECT", body: data.body },
    });
    await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date(), lastInboundAt: new Date(), status } });
    await record(conversation.organisationId, context.userId, "message.received", "conversation", conversation.id, { channel: "WEB_CHAT" });
  });
  await routeInboundMessage(conversation.id).catch(() => undefined);
  return getWebChatConversation(conversationId, data.chatToken);
}

export async function requestWebChatViewing(conversationId: string, input: unknown) {
  const data = webChatViewingRequestSchema.parse(input);
  const conversation = await requireWebChatConversation(conversationId, data.chatToken);
  if (!conversation.listingId || !conversation.marketplaceLeadId) {
    throw new AppError("VIEWING_REQUEST_UNAVAILABLE", 409, "A listing enquiry is required before requesting a viewing.");
  }
  const viewing = await createViewingRequest(conversation.listingId, undefined, {
    leadId: conversation.marketplaceLeadId,
    preferredTimes: data.preferredTimes,
    requesterNote: data.requesterNote,
  });
  await db.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
  return viewing;
}

export async function getWebChatConversation(conversationId: string, chatToken: string) {
  const conversation = await requireWebChatConversation(conversationId, chatToken);
  return db.conversation.findUniqueOrThrow({ where: { id: conversation.id }, include: conversationDetailInclude });
}

// ---------------------------------------------------------------------------
// Inbound channel messages (email / whatsapp / sms webhooks + IN_APP)
// ---------------------------------------------------------------------------

export async function receiveInboundChannelMessage(organisationId: string, channel: ConversationChannel, input: unknown) {
  const data = inboundChannelMessageSchema.parse(input);
  const existing = await db.message.findFirst({ where: { organisationId, channel, externalMessageId: data.externalMessageId } });
  if (existing) return { conversationId: existing.conversationId, messageId: existing.id, duplicate: true };

  const identity = await resolveTenantIdentity(organisationId, { email: channel === "EMAIL" ? data.channelAddress : undefined, phone: channel === "WHATSAPP" || channel === "SMS" ? data.channelAddress : undefined });
  let conversation = await db.conversation.findFirst({
    where: { organisationId, channel, channelAddress: data.channelAddress, status: { notIn: ["RESOLVED", "CLOSED"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!conversation) {
    conversation = await db.$transaction(async (tx) => {
      const created = await tx.conversation.create({
        data: {
          organisationId,
          channel,
          status: "OPEN",
          subject: `${channel} conversation`,
          channelAddress: data.channelAddress,
          externalThreadKey: data.externalReferenceId,
          identityLevel: identity.level,
          tenantOrganisationId: identity.tenantOrganisationId ?? undefined,
          participants: {
            create: {
              organisationId,
              type: identity.level === "NONE" ? "ANONYMOUS" : "TENANT",
              tenantOrganisationId: identity.tenantOrganisationId ?? undefined,
              displayName: data.senderName,
              email: channel === "EMAIL" ? data.channelAddress : undefined,
              phone: channel !== "EMAIL" ? data.channelAddress : undefined,
              verifiedAt: identity.level === "VERIFIED" ? new Date() : undefined,
            },
          },
        },
      });
      await record(organisationId, undefined, "conversation.created", "conversation", created.id, { channel });
      return created;
    });
  }

  const rateLimited = await enforceInboundRateLimit(organisationId, conversation.id);
  const message = await db.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        organisationId,
        conversationId: conversation!.id,
        channel,
        direction: "INBOUND",
        senderType: identity.level === "VERIFIED" ? "TENANT" : identity.level === "CLAIMED" ? "PROSPECT" : "PROSPECT",
        body: data.body,
        externalMessageId: data.externalMessageId,
        externalReferenceId: data.externalReferenceId,
        metadata: data.providerPayload ? json(data.providerPayload) : undefined,
      },
    });
    await tx.conversation.update({
      where: { id: conversation!.id },
      data: {
        lastMessageAt: new Date(),
        lastInboundAt: new Date(),
        identityLevel: identity.level === "VERIFIED" || conversation!.identityLevel !== "VERIFIED" ? identity.level : conversation!.identityLevel,
        tenantOrganisationId: identity.tenantOrganisationId ?? conversation!.tenantOrganisationId,
      },
    });
    await record(organisationId, undefined, "message.received", "conversation", conversation!.id, { channel, rateLimited });
    return created;
  });

  if (!rateLimited) await routeInboundMessage(conversation.id).catch(() => undefined);
  return { conversationId: conversation.id, messageId: message.id, duplicate: false };
}

// ---------------------------------------------------------------------------
// AI receptionist routing (internal)
// ---------------------------------------------------------------------------

const HUMAN_REQUEST_PATTERN = /\b(human|agent|representative|real person|someone else|speak to (a|the) (manager|staff))\b/i;
const PRIVATE_DATA_PATTERN = /\b(rent|balance|owe|lease|payment|deposit|account)\b/i;
const MAINTENANCE_PATTERN = /\b(leak|broken|repair|fix|maintenance|not working|electrical|plumbing|no water|no power)\b/i;

async function escalateToHuman(organisationId: string, conversationId: string, aiEmployeeId: string | null, actorUserId: string | null, reason: string, urgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL") {
  await db.conversation.update({ where: { id: conversationId }, data: { status: "HUMAN_REQUIRED" } });
  await db.conversationAssignment.create({ data: { organisationId, conversationId, assigneeType: "UNASSIGNED", reason, actorUserId: actorUserId ?? undefined } });
  if (aiEmployeeId && actorUserId) {
    await createAIEmployeeHandoff(actorUserId, organisationId, aiEmployeeId, { conversationId, reason, urgency, contextSummary: reason }).catch(() => undefined);
  }
  await record(organisationId, actorUserId ?? undefined, "conversation.handoff_requested", "conversation", conversationId, { reason, urgency });
}

async function sendAIReply(organisationId: string, conversationId: string, aiEmployeeId: string, body: string) {
  return recordOutboundMessage(organisationId, conversationId, { senderType: "AI_EMPLOYEE", aiEmployeeId, body });
}

export async function routeInboundMessage(conversationId: string) {
  const conversation = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) return;
  if (conversation.status === "RESOLVED" || conversation.status === "CLOSED" || conversation.status === "HUMAN_ACTIVE" || conversation.assignedMemberId) return;

  const trailing = await db.message.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: LOOP_GUARD_MAX_CONSECUTIVE_AI_MESSAGES + 1 });
  if (trailing.length > LOOP_GUARD_MAX_CONSECUTIVE_AI_MESSAGES && trailing.slice(0, LOOP_GUARD_MAX_CONSECUTIVE_AI_MESSAGES).every((message) => message.senderType === "AI_EMPLOYEE")) {
    await escalateToHuman(conversation.organisationId, conversation.id, conversation.assignedAIEmployeeId, null, "Automated response loop detected; escalating for human review.", "MEDIUM");
    return;
  }

  const employee = await selectReceptionistForProperty(conversation.organisationId, conversation.propertyId);
  if (!employee) {
    await escalateToHuman(conversation.organisationId, conversation.id, null, null, "No active AI receptionist is configured to handle this conversation.", "MEDIUM");
    return;
  }

  const wasUnassigned = conversation.assignedAIEmployeeId === null;
  const claim = await db.conversation.updateMany({
    where: { id: conversation.id, status: { notIn: ["RESOLVED", "CLOSED", "HUMAN_ACTIVE"] }, OR: [{ assignedAIEmployeeId: null }, { assignedAIEmployeeId: employee.id }] },
    data: { assignedAIEmployeeId: employee.id, status: "AI_ACTIVE" },
  });
  const fresh = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
  if (fresh.assignedAIEmployeeId !== employee.id) return; // another employee or a human already owns this conversation.
  if (claim.count > 0 && wasUnassigned) {
    await db.conversationAssignment.create({ data: { organisationId: conversation.organisationId, conversationId: conversation.id, assigneeType: "AI_EMPLOYEE", aiEmployeeId: employee.id, reason: "Deterministic AI receptionist routing." } });
    await record(conversation.organisationId, undefined, "conversation.assigned_to_ai", "conversation", conversation.id, { aiEmployeeId: employee.id });
  }

  const configuration = await db.aIAutonomyConfiguration.findUnique({ where: { organisationId: conversation.organisationId } });
  const actorUserId = configuration?.automationActorUserId ?? null;
  if (!configuration?.enabled || configuration.automationPaused || !actorUserId) {
    await escalateToHuman(conversation.organisationId, conversation.id, employee.id, actorUserId, "AI automation is not configured for autonomous conversation handling.", "MEDIUM");
    return;
  }

  const lastInbound = await db.message.findFirst({ where: { conversationId: conversation.id, direction: "INBOUND" }, orderBy: { createdAt: "desc" } });
  const body = lastInbound?.body ?? "";

  if (HUMAN_REQUEST_PATTERN.test(body)) {
    await sendAIReply(conversation.organisationId, conversation.id, employee.id, "Connecting you with a team member now.");
    await escalateToHuman(conversation.organisationId, conversation.id, employee.id, actorUserId, "Customer requested a human.", "MEDIUM");
    return;
  }

  if (PRIVATE_DATA_PATTERN.test(body) && !canAccessPrivateData(conversation.identityLevel)) {
    await sendAIReply(conversation.organisationId, conversation.id, employee.id, "I can share account details once you sign in and verify your identity. Please log in to your tenant account and message again.");
    return;
  }

  if (PRIVATE_DATA_PATTERN.test(body) && conversation.tenantOrganisationId) {
    if (employee.toolPermissions.some(({ toolKey }) => toolKey === "tenants.history")) {
      try {
        const { executeEmployeeReadTool } = await import("@/modules/ai-employees/service");
        await executeEmployeeReadTool(actorUserId, conversation.organisationId, employee.id, "tenants.history", { id: conversation.tenantOrganisationId });
        await sendAIReply(conversation.organisationId, conversation.id, employee.id, "I've reviewed your lease and payment account. Our team will confirm the specific figures with you shortly, or ask me a more specific question.");
        await createEnquiryActivity(conversation.organisationId, employee.id, conversation.id, "verified-account-enquiry");
        return;
      } catch {
        await escalateToHuman(conversation.organisationId, conversation.id, employee.id, actorUserId, "Unable to safely resolve verified tenant account details.", "MEDIUM");
        return;
      }
    }
  }

  if (MAINTENANCE_PATTERN.test(body)) {
    if (!canAccessPrivateData(conversation.identityLevel) || !conversation.tenantOrganisationId || !conversation.propertyId) {
      await sendAIReply(conversation.organisationId, conversation.id, employee.id, "To report a maintenance issue I first need to verify your tenancy. Please sign in and send this message again, or ask to speak with a team member.");
      await escalateToHuman(conversation.organisationId, conversation.id, employee.id, actorUserId, "Unverified maintenance report requires human confirmation.", "MEDIUM");
      return;
    }
    if (employee.toolPermissions.some(({ toolKey }) => toolKey === "maintenance.create")) {
      try {
        await receptionistMaintenanceIntake(actorUserId, conversation.organisationId, employee.id, {
          propertyId: conversation.propertyId,
          unitId: conversation.unitId ?? undefined,
          title: body.slice(0, 120),
          description: body,
          category: "other",
          priority: "NORMAL",
          customerRequestedHuman: false,
          idempotencyKey: `conversation-maintenance-${lastInbound?.id ?? conversation.id}`,
        });
        await sendAIReply(conversation.organisationId, conversation.id, employee.id, "I've logged a maintenance request for this and our team will follow up.");
        await createEnquiryActivity(conversation.organisationId, employee.id, conversation.id, "maintenance-intake");
        return;
      } catch (error) {
        if (error instanceof AppError && error.code === "AI_EMPLOYEE_DUPLICATE_ACTION") return;
        await escalateToHuman(conversation.organisationId, conversation.id, employee.id, actorUserId, "Maintenance intake needs human confirmation.", "HIGH");
        return;
      }
    }
  }

  await sendAIReply(
    conversation.organisationId,
    conversation.id,
    employee.id,
    conversation.marketplaceLeadId
      ? "Thanks for your interest! A member of our team will follow up shortly. Let me know if you'd like to request a viewing."
      : "Thanks for reaching out. How can I help you today?",
  );
  await createEnquiryActivity(conversation.organisationId, employee.id, conversation.id, `general-${lastInbound?.id ?? conversation.id}`);
}

async function createEnquiryActivity(organisationId: string, aiEmployeeId: string, conversationId: string, idempotencySuffix: string) {
  await db.aIEmployeeActivity.createMany({
    data: {
      organisationId,
      aiEmployeeId,
      type: "ENQUIRY",
      status: "COMPLETED",
      reason: "Automated conversation response.",
      affectedEntities: [{ type: "conversation", id: conversationId }],
      idempotencyKey: `conversation-enquiry-${idempotencySuffix}`,
      completedAt: new Date(),
    },
    skipDuplicates: true,
  });
}

// ---------------------------------------------------------------------------
// Outbound messages + delivery
// ---------------------------------------------------------------------------

async function recordOutboundMessage(organisationId: string, conversationId: string, input: { senderType: "AI_EMPLOYEE" | "ORG_MEMBER"; aiEmployeeId?: string; authoredByUserId?: string; body: string }) {
  const conversation = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  const message = await db.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        organisationId,
        conversationId,
        channel: conversation.channel,
        direction: "OUTBOUND",
        senderType: input.senderType,
        aiEmployeeId: input.aiEmployeeId,
        authoredByUserId: input.authoredByUserId,
        body: input.body,
      },
    });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), lastOutboundAt: new Date() } });
    await record(organisationId, input.authoredByUserId, "message.sent", "conversation", conversationId, { channel: conversation.channel, senderType: input.senderType });
    return created;
  });

  if (conversation.channel === "WEB_CHAT" || conversation.channel === "IN_APP") {
    const adapter = getChannelAdapter(conversation.channel);
    const result = await adapter.send({ organisationId, conversationId, messageId: message.id, channel: conversation.channel, recipientAddress: conversation.channelAddress, fromAddress: null, body: input.body });
    await db.messageDelivery.create({ data: { organisationId, messageId: message.id, channel: conversation.channel, status: result.status, providerReference: result.providerReference, recipientAddress: conversation.channelAddress, sentAt: new Date(), deliveredAt: result.status === "DELIVERED" ? new Date() : undefined, idempotencyKey: `message-delivery:${message.id}` } });
    return message;
  }

  const channelConfig = await db.communicationChannelConfig.findUnique({ where: { organisationId_channel: { organisationId, channel: conversation.channel } } });
  const recipientAddress = conversation.channelAddress;
  const delivery = await db.messageDelivery.create({
    data: { organisationId, messageId: message.id, channel: conversation.channel, status: "QUEUED", recipientAddress, idempotencyKey: `message-delivery:${message.id}` },
  });
  if (!channelConfig?.enabled) {
    await db.messageDelivery.update({ where: { id: delivery.id }, data: { status: "SKIPPED", failureReason: `${conversation.channel} channel is disabled for this organisation.` } });
    return message;
  }
  await enqueueJob({ organisationId, type: "conversation-message-delivery", idempotencyKey: `conversation-message-delivery:${delivery.id}`, payload: { organisationId, deliveryId: delivery.id } });
  return message;
}

export async function deliverConversationMessage(organisationId: string, deliveryId: string, adapters: ChannelAdapters | undefined = undefined) {
  const delivery = await db.messageDelivery.findFirst({ where: { id: deliveryId, organisationId }, include: { message: true } });
  if (!delivery) throw notFound();
  if (["SENT", "DELIVERED", "SKIPPED"].includes(delivery.status)) return delivery;
  const claimed = await db.messageDelivery.updateMany({ where: { id: deliveryId, organisationId, status: { in: ["QUEUED", "FAILED"] } }, data: { status: "SENDING", attempts: { increment: 1 }, lastAttemptAt: new Date(), failedAt: null, failureReason: null } });
  if (!claimed.count) return db.messageDelivery.findFirstOrThrow({ where: { id: deliveryId, organisationId } });

  const conversation = await db.conversation.findUniqueOrThrow({ where: { id: delivery.message.conversationId } });
  const channelConfig = await db.communicationChannelConfig.findUnique({ where: { organisationId_channel: { organisationId, channel: delivery.channel } } });
  const adapter = getChannelAdapter(delivery.channel, adapters);
  try {
    const result = await adapter.send({
      organisationId,
      conversationId: conversation.id,
      messageId: delivery.message.id,
      channel: delivery.channel,
      recipientAddress: delivery.recipientAddress ?? conversation.channelAddress,
      fromAddress: channelConfig?.fromAddress ?? null,
      body: delivery.message.body,
      externalReferenceId: delivery.message.externalReferenceId,
      providerKey: channelConfig?.providerKey,
      config: (channelConfig?.config as Record<string, unknown>) ?? {},
    });
    if (result.status === "FAILED") {
      return db.$transaction(async (tx) => {
        const failed = await tx.messageDelivery.update({ where: { id: deliveryId }, data: { status: "FAILED", failedAt: new Date(), failureReason: result.failureReason ?? "Delivery failed." } });
        await record(organisationId, undefined, "message.delivery_failed", "conversation", conversation.id, { channel: delivery.channel, reason: result.failureReason });
        return failed;
      });
    }
    return db.$transaction(async (tx) => {
      const sent = await tx.messageDelivery.update({ where: { id: deliveryId }, data: { status: result.status, providerReference: result.providerReference, sentAt: new Date(), deliveredAt: result.status === "DELIVERED" ? new Date() : undefined } });
      await record(organisationId, undefined, "message.sent", "conversation", conversation.id, { channel: delivery.channel, providerReference: result.providerReference ?? null });
      return sent;
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown delivery failure.";
    await db.$transaction(async (tx) => {
      await tx.messageDelivery.update({ where: { id: deliveryId }, data: { status: "FAILED", failedAt: new Date(), failureReason: reason } });
      await record(organisationId, undefined, "message.delivery_failed", "conversation", conversation.id, { channel: delivery.channel, reason });
    });
    throw error;
  }
}

export async function retryConversationMessageDelivery(userId: string, organisationId: string, deliveryId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.conversationManage);
  const delivery = await db.messageDelivery.findFirst({ where: { id: deliveryId, organisationId } });
  if (!delivery) throw notFound();
  if (delivery.status !== "FAILED") throw new AppError("DELIVERY_NOT_RETRYABLE", 409, "Only failed message deliveries can be retried.");
  await db.messageDelivery.update({ where: { id: deliveryId }, data: { status: "QUEUED", failedAt: null, failureReason: null } });
  await enqueueJob({ organisationId, type: "conversation-message-delivery", idempotencyKey: `conversation-message-delivery-retry:${deliveryId}:${Date.now()}`, payload: { organisationId, deliveryId } });
  return db.messageDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
}

// ---------------------------------------------------------------------------
// Authenticated staff operations
// ---------------------------------------------------------------------------

function bucketFilter(bucket: string | undefined): Prisma.ConversationWhereInput {
  switch (bucket) {
    case "UNREAD": return { OR: [{ lastOutboundAt: null }, { lastInboundAt: { not: null } }], status: { notIn: ["RESOLVED", "CLOSED"] } };
    case "AI_HANDLED": return { assignedAIEmployeeId: { not: null } };
    case "HUMAN_ASSIGNED": return { assignedMemberId: { not: null } };
    case "HANDOFF_REQUIRED": return { status: "HUMAN_REQUIRED" };
    case "TENANT": return { tenantOrganisationId: { not: null } };
    case "PROSPECT": return { marketplaceLeadId: { not: null } };
    case "MAINTENANCE": return { maintenanceRequestId: { not: null } };
    case "LEASING": return { OR: [{ leaseId: { not: null } }, { listingId: { not: null } }] };
    case "PROVIDER": return { serviceProviderId: { not: null } };
    case "URGENT": return { status: "HUMAN_REQUIRED" };
    default: return {};
  }
}

export async function listConversationInbox(userId: string, organisationId: string, query: unknown = {}) {
  await requirePermission(userId, organisationId, PERMISSIONS.conversationRead);
  const filters = conversationListSchema.parse(query);
  const where: Prisma.ConversationWhereInput = {
    organisationId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.channel ? { channel: filters.channel } : {}),
    ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
    ...(filters.portfolioId ? { property: { portfolioId: filters.portfolioId } } : {}),
    ...(filters.aiEmployeeId ? { assignedAIEmployeeId: filters.aiEmployeeId } : {}),
    ...(filters.assignedMemberId ? { assignedMemberId: filters.assignedMemberId } : {}),
    ...bucketFilter(filters.bucket),
  };
  const [total, items] = await Promise.all([
    db.conversation.count({ where }),
    db.conversation.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      include: {
        assignedAIEmployee: { select: { id: true, name: true } },
        assignedMember: { select: { id: true, user: { select: { displayName: true } } } },
        tenantOrganisation: { select: { id: true, tenant: { select: { legalName: true } } } },
        property: { select: { id: true, name: true } },
        marketplaceLead: { select: { id: true, name: true } },
      },
    }),
  ]);
  return { items, pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) } };
}

export async function getConversationDetail(userId: string, organisationId: string, conversationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.conversationRead);
  const conversation = await db.conversation.findFirst({ where: { id: conversationId, organisationId }, include: conversationDetailInclude });
  if (!conversation) throw notFound();
  const handoffs = await db.aIEmployeeHandoff.findMany({ where: { organisationId, conversationId }, orderBy: { createdAt: "desc" } });
  return { ...conversation, handoffs };
}

export async function sendConversationMessage(userId: string, organisationId: string, conversationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.conversationManage);
  // Representative entitlement check (item 2): outbound channel messages are metered per billing period.
  await assertOperational(organisationId, ENTITLEMENTS.messagesMonthlyMax.key);
  const data = sendConversationMessageSchema.parse(input);
  const conversation = await db.conversation.findFirst({ where: { id: conversationId, organisationId } });
  if (!conversation) throw notFound();
  await db.conversation.update({ where: { id: conversationId }, data: { status: "HUMAN_ACTIVE", assignedMemberId: conversation.assignedMemberId ?? undefined } });
  return recordOutboundMessage(organisationId, conversationId, { senderType: "ORG_MEMBER", authoredByUserId: userId, body: data.body });
}

export async function assignConversation(userId: string, organisationId: string, conversationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.conversationAssign);
  const data = assignConversationSchema.parse(input);
  const conversation = await db.conversation.findFirst({ where: { id: conversationId, organisationId } });
  if (!conversation) throw notFound();
  if (data.assigneeType === "ORG_MEMBER") {
    const member = await db.organisationMember.findFirst({ where: { id: data.organisationMemberId, organisationId, status: "ACTIVE", archivedAt: null } });
    if (!member) throw new AppError("CONVERSATION_ASSIGNEE_INVALID", 422, "The assignee is not an active organisation member.");
  }
  if (data.assigneeType === "AI_EMPLOYEE") {
    const employee = await db.aIEmployee.findFirst({ where: { id: data.aiEmployeeId, organisationId, status: "ACTIVE", archivedAt: null } });
    if (!employee) throw new AppError("CONVERSATION_ASSIGNEE_INVALID", 422, "The AI employee is not active for this organisation.");
  }
  const nextStatus: ConversationStatus = data.assigneeType === "ORG_MEMBER" ? "HUMAN_ACTIVE" : data.assigneeType === "AI_EMPLOYEE" ? "AI_ACTIVE" : "OPEN";
  return db.$transaction(async (tx) => {
    const updated = await tx.conversation.update({
      where: { id: conversationId },
      data: {
        status: nextStatus,
        assignedMemberId: data.assigneeType === "ORG_MEMBER" ? data.organisationMemberId : null,
        assignedAIEmployeeId: data.assigneeType === "AI_EMPLOYEE" ? data.aiEmployeeId : null,
      },
    });
    await tx.conversationAssignment.create({ data: { organisationId, conversationId, assigneeType: data.assigneeType, aiEmployeeId: data.aiEmployeeId, organisationMemberId: data.organisationMemberId, reason: data.reason, actorUserId: userId } });
    await record(organisationId, userId, data.assigneeType === "ORG_MEMBER" ? "conversation.assigned_to_human" : "conversation.assigned_to_ai", "conversation", conversationId, { assigneeType: data.assigneeType, aiEmployeeId: data.aiEmployeeId, organisationMemberId: data.organisationMemberId });
    return updated;
  });
}

export async function updateConversationStatus(userId: string, organisationId: string, conversationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.conversationManage);
  const data = conversationStatusUpdateSchema.parse(input);
  const conversation = await db.conversation.findFirst({ where: { id: conversationId, organisationId } });
  if (!conversation) throw notFound();
  return db.$transaction(async (tx) => {
    const updated = await tx.conversation.update({
      where: { id: conversationId },
      data: {
        status: data.status,
        resolvedAt: data.status === "RESOLVED" ? new Date() : conversation.resolvedAt,
        closedAt: data.status === "CLOSED" ? new Date() : conversation.closedAt,
      },
    });
    await record(organisationId, userId, data.status === "RESOLVED" ? "conversation.resolved" : "conversation.status_changed", "conversation", conversationId, { status: data.status, note: data.note });
    return updated;
  });
}

export async function verifyConversationIdentity(userId: string, organisationId: string, conversationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.conversationManage);
  const { verifyIdentitySchema } = await import("./schemas");
  const data = verifyIdentitySchema.parse(input);
  const conversation = await db.conversation.findFirst({ where: { id: conversationId, organisationId } });
  if (!conversation) throw notFound();
  const tenantOrganisation = await db.tenantOrganisation.findFirst({ where: { id: data.tenantOrganisationId, organisationId, archivedAt: null } });
  if (!tenantOrganisation) throw new AppError("TENANT_NOT_FOUND", 422, "The tenant record does not belong to this organisation.");
  return db.$transaction(async (tx) => {
    const updated = await tx.conversation.update({ where: { id: conversationId }, data: { identityLevel: "VERIFIED", tenantOrganisationId: tenantOrganisation.id } });
    await record(organisationId, userId, "identity.verified", "conversation", conversationId, { tenantOrganisationId: tenantOrganisation.id });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Organisation communication channel settings
// ---------------------------------------------------------------------------

export async function listChannelConfigs(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.conversationRead);
  return db.communicationChannelConfig.findMany({ where: { organisationId }, orderBy: { channel: "asc" } });
}

/** Unauthenticated webhook-boundary lookup: resolves the configured secret/config for signature verification. */
export async function getWebhookChannelConfig(organisationId: string, channel: ConversationChannel) {
  return db.communicationChannelConfig.findUnique({ where: { organisationId_channel: { organisationId, channel } } });
}

export async function upsertChannelConfig(userId: string, organisationId: string, channel: ConversationChannel, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.communicationChannelManage);
  const data = channelConfigSchema.parse(input);
  return db.$transaction(async (tx) => {
    const config = await tx.communicationChannelConfig.upsert({
      where: { organisationId_channel: { organisationId, channel } },
      update: { enabled: data.enabled, providerKey: data.providerKey, fromAddress: data.fromAddress, webhookVerifyToken: data.webhookVerifyToken, config: json(data.config) },
      create: { organisationId, channel, enabled: data.enabled, providerKey: data.providerKey, fromAddress: data.fromAddress, webhookVerifyToken: data.webhookVerifyToken, config: json(data.config) },
    });
    await record(organisationId, userId, "communication_channel.updated", "communication_channel", config.id, { channel, enabled: data.enabled });
    return config;
  });
}
