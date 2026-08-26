import { z } from "zod";

const id = z.string().uuid();
const bodyText = z.string().trim().min(1).max(8_000);

export const startWebChatConversationSchema = z.object({
  listingId: id.optional(),
  propertyId: id.optional(),
  subject: z.string().trim().max(200).optional(),
  visitorName: z.string().trim().min(1).max(160).optional(),
  visitorEmail: z.string().trim().email().max(320).optional(),
  visitorPhone: z.string().trim().min(5).max(50).optional(),
  message: bodyText,
}).strict().refine((value) => value.listingId || value.propertyId, {
  path: ["propertyId"],
  message: "A listing or property is required to start a web chat conversation.",
});

export const postWebChatMessageSchema = z.object({
  chatToken: z.string().trim().min(16).max(200),
  body: bodyText,
}).strict();

export const webChatViewingRequestSchema = z.object({
  chatToken: z.string().trim().min(16).max(200),
  preferredTimes: z.array(z.object({
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    timezone: z.string().trim().min(1).max(100),
  }).strict()).min(1).max(5),
  requesterNote: z.string().trim().max(2_000).optional(),
}).strict();

export const inboundChannelMessageSchema = z.object({
  channelAddress: z.string().trim().min(1).max(320),
  toAddress: z.string().trim().min(1).max(320).optional(),
  externalMessageId: z.string().trim().min(1).max(300),
  externalReferenceId: z.string().trim().min(1).max(300).optional(),
  body: bodyText,
  receivedAt: z.coerce.date().optional(),
  senderName: z.string().trim().max(200).optional(),
  providerPayload: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const sendConversationMessageSchema = z.object({
  body: bodyText,
}).strict();

export const assignConversationSchema = z.object({
  assigneeType: z.enum(["AI_EMPLOYEE", "ORG_MEMBER", "UNASSIGNED"]),
  aiEmployeeId: id.optional(),
  organisationMemberId: id.optional(),
  reason: z.string().trim().max(1_000).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.assigneeType === "AI_EMPLOYEE" && !value.aiEmployeeId) {
    ctx.addIssue({ code: "custom", path: ["aiEmployeeId"], message: "An AI employee is required for this assignment." });
  }
  if (value.assigneeType === "ORG_MEMBER" && !value.organisationMemberId) {
    ctx.addIssue({ code: "custom", path: ["organisationMemberId"], message: "An organisation member is required for this assignment." });
  }
});

export const conversationStatusUpdateSchema = z.object({
  status: z.enum(["RESOLVED", "CLOSED", "WAITING_CUSTOMER", "OPEN"]),
  note: z.string().trim().max(1_000).optional(),
}).strict();

export const conversationListSchema = z.object({
  status: z.enum(["OPEN", "AI_ACTIVE", "HUMAN_REQUIRED", "HUMAN_ACTIVE", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"]).optional(),
  channel: z.enum(["WEB_CHAT", "EMAIL", "WHATSAPP", "SMS", "IN_APP"]).optional(),
  propertyId: id.optional(),
  portfolioId: id.optional(),
  aiEmployeeId: id.optional(),
  assignedMemberId: id.optional(),
  bucket: z.enum(["ALL", "UNREAD", "AI_HANDLED", "HUMAN_ASSIGNED", "HANDOFF_REQUIRED", "TENANT", "PROSPECT", "MAINTENANCE", "LEASING", "PROVIDER", "URGENT"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const channelConfigSchema = z.object({
  enabled: z.boolean(),
  providerKey: z.string().trim().max(100).optional(),
  fromAddress: z.string().trim().max(320).optional(),
  webhookVerifyToken: z.string().trim().max(200).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
}).strict();

export const verifyIdentitySchema = z.object({
  tenantOrganisationId: id,
}).strict();
