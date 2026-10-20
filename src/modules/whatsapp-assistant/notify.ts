import { db } from "@/platform/database/client";
import { queueOfficialTemplate } from "./outbound";

/**
 * Tells applicants on WhatsApp about a decision on their application or listing, in addition to
 * the existing emails. Only accounts that verified a WhatsApp number receive it, through the
 * official number's approved NOTIFICATION template (business-initiated messages need one). When
 * the template is not configured, the number opted out (STOP) or nothing is linked, nothing is
 * queued and the reason is returned; queued is not delivered, which the delivery record shows.
 * Never throws: a notification problem must not undo the decision it reports.
 */
export async function notifyOnWhatsApp(userIds: string[], text: string, idempotencyKey: string) {
  const outcomes: Array<{ userId: string; queued: boolean; reason?: string }> = [];
  for (const userId of [...new Set(userIds)]) {
    try {
      const identity = await db.channelIdentity.findFirst({ where: { channel: "WHATSAPP", userId, verifiedAt: { not: null } }, include: { user: { select: { displayName: true } } }, orderBy: { verifiedAt: "desc" } });
      if (!identity) { outcomes.push({ userId, queued: false, reason: "No WhatsApp number is linked." }); continue; }
      const result = await db.$transaction((tx) => queueOfficialTemplate(tx, { phoneE164: identity.address, displayName: identity.user?.displayName ?? "NesAfric user", template: "NOTIFICATION", bodyParameters: [text], body: text, externalMessageId: `decision:${idempotencyKey}:${userId}` }));
      outcomes.push(result.messageId ? { userId, queued: true } : { userId, queued: false, reason: "reason" in result ? result.reason : undefined });
    } catch (error) {
      console.warn(JSON.stringify({ event: "whatsapp.decision_notification_failed", reason: error instanceof Error ? error.name : "unknown" }));
      outcomes.push({ userId, queued: false, reason: "Notification could not be queued." });
    }
  }
  return outcomes;
}

const PROFESSIONAL_TEXT: Record<string, (name: string, reason?: string | null) => string> = {
  VERIFIED: (name) => `${name} is approved on NesAfric. You can now submit property listings for review. Reply list a property to start.`,
  REJECTED: (name, reason) => `${name} was not approved on NesAfric.${reason ? ` Reason: ${reason}` : ""} Reply my applications for details.`,
  SUSPENDED: (name, reason) => `${name} is suspended on NesAfric.${reason ? ` Reason: ${reason}` : ""} Listings can't be submitted while suspended.`,
};

export async function notifyProfessionalDecision(marketplaceProfessionalId: string, status: string, reason: string | null | undefined, eventId: string) {
  const professional = await db.marketplaceProfessional.findUnique({ where: { id: marketplaceProfessionalId }, select: { displayName: true, members: { where: { status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } }, select: { userId: true } } } });
  const text = PROFESSIONAL_TEXT[status];
  if (!professional || !text) return [];
  return notifyOnWhatsApp(professional.members.map((member) => member.userId), text(professional.displayName, reason), `professional:${eventId}`);
}

const PROVIDER_TEXT: Record<string, (name: string) => string> = {
  VERIFIED: (name) => `${name} is approved on NesAfric. Reply list my services to publish your service listing.`,
  REJECTED: (name) => `${name} was not approved on NesAfric. Reply my applications for details.`,
  REQUIRES_MORE_INFORMATION: (name) => `NesAfric needs more information about ${name}. Check your email or the website, then submit again.`,
};

export async function notifyProviderDecision(providerId: string, status: string, eventId: string) {
  const provider = await db.serviceProvider.findUnique({ where: { id: providerId }, select: { displayName: true, administratorUserId: true, individualUserId: true } });
  const text = PROVIDER_TEXT[status];
  if (!provider || !text) return [];
  return notifyOnWhatsApp([provider.administratorUserId, provider.individualUserId].filter((id): id is string => Boolean(id)), text(provider.displayName), `provider:${eventId}`);
}

const LISTING_TEXT: Record<string, (title: string) => string> = {
  PUBLISHED: (title) => `Your listing "${title}" is approved and published on NesAfric.`,
  CHANGES_REQUESTED: (title) => `NesAfric asked for changes to your listing "${title}". Open it on the website to see what to change, then submit again.`,
  REJECTED: (title) => `Your listing "${title}" was not approved on NesAfric. Open it on the website for the reason.`,
};

export async function notifyListingDecision(listingId: string, decision: "PUBLISHED" | "CHANGES_REQUESTED" | "REJECTED", eventId: string) {
  const listing = await db.listing.findUnique({ where: { id: listingId }, select: { title: true, createdByUserId: true, listingRepresentativeUserId: true } });
  if (!listing) return [];
  return notifyOnWhatsApp([listing.createdByUserId, listing.listingRepresentativeUserId].filter((id): id is string => Boolean(id)), LISTING_TEXT[decision](listing.title), `listing:${eventId}`);
}
