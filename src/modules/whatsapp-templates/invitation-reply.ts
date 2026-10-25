import { db } from "@/platform/database/client";
import { recipientKey } from "./dispatch";

const INVITATION_REPLY_WINDOW_MS = 30 * 24 * 60 * 60_000;

/**
 * U17 asks the tenant to "reply to this message to review and verify your invitation". This is
 * that reply: the first message in the conversation after the invitation explains how to verify.
 * It only explains. The tenancy is connected by the existing steps alone: the number is linked to
 * a NesAfric account with a one-time code, then the landlord's access code is redeemed. The
 * invitation is found from the dispatch ledger for this exact number, so nothing about it is
 * shown to any other number, and the access code is never repeated here.
 */
export async function invitationReply(input: { address: string; conversationId: string; linked: boolean; now?: Date }): Promise<string | null> {
  const now = input.now ?? new Date();
  const dispatch = await db.whatsAppUtilityDispatch.findFirst({
    where: { templateKey: "U17", outcome: "QUEUED", recipientKey: recipientKey(input.address), messageId: { not: null }, createdAt: { gte: new Date(now.getTime() - INVITATION_REPLY_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
  });
  if (!dispatch?.messageId) return null;
  const sent = await db.message.findUnique({ where: { id: dispatch.messageId }, select: { conversationId: true, createdAt: true } });
  if (sent?.conversationId !== input.conversationId) return null;
  // Only the first reply after the invitation; later messages go to the normal assistant.
  const replies = await db.message.count({ where: { conversationId: input.conversationId, direction: "INBOUND", createdAt: { gt: sent.createdAt } } });
  if (replies > 1) return null;

  const event = await db.domainEvent.findUnique({ where: { id: dispatch.domainEventId }, select: { organisationId: true, payload: true } });
  const invitationId = event?.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>).invitationId : undefined;
  if (typeof invitationId !== "string") return null;
  const invitation = await db.tenantAccessInvitation.findUnique({ where: { id: invitationId }, include: { tenantOrganisation: { select: { organisationId: true, userId: true, organisation: { select: { name: true } } } } } });
  if (!invitation || invitation.tenantOrganisation.organisationId !== event?.organisationId) return null;
  if (invitation.redeemedAt || invitation.revokedAt || invitation.expiresAt <= now || invitation.tenantOrganisation.userId) return null;

  const landlord = invitation.tenantOrganisation.organisation.name;
  return [
    `This is about your tenant invitation from ${landlord}. To verify it:`,
    input.linked ? null : "1. Reply link and confirm this number with the one-time code NesAfric sends you.",
    `${input.linked ? "1" : "2"}. Send the tenant access code ${landlord} gave you (it starts with NT-).`,
    "Your tenancy is connected only after these steps. If you were not expecting this invitation, reply STOP.",
  ].filter(Boolean).join("\n");
}
