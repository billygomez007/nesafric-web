import { publiclyEligibleListingIds } from "@/modules/listings/service";
import { updateMarketplaceProfile } from "@/modules/marketplace/service";
import { db } from "@/platform/database/client";
import { dateTimeText, propertyUrl, providerUrl } from "./format";
import { referenceFor } from "./references";
import { queueNotification, recordEvent } from "./store";
import type { WhatsAppNotificationJob } from "./notification-outbox";
import { errorLabel } from "./log";

/**
 * WhatsApp status notifications for decisions made elsewhere (the platform admin review queues, an
 * agent confirming a viewing). Each is keyed by the decision so a retried admin request never
 * sends twice, and each states only what has actually happened — a listing is called "live" only
 * after the public-eligibility check confirms it is visible on the marketplace.
 *
 * Always called after the deciding transaction has committed, and never allowed to fail it:
 * callers use `safely()`.
 */

/** Runs one queued notification (from the outbox job or right after commit). Throws to be retried. */
export async function runWhatsAppNotification(job: WhatsAppNotificationJob) {
  switch (job.kind) {
    case "listing_decision":
      return notifyListingDecision(job.listingId, job.decision, job.note, job.decisionKey);
    case "professional_verification":
      return notifyProfessionalVerification(job.professionalId, job.status, job.reason, job.decisionKey);
    case "provider_identity":
      return notifyProviderIdentityDecision(job.providerId, job.status, job.reason, job.decisionKey);
    case "viewing_update":
      return notifyViewingUpdate(job.viewingRequestId, job.decisionKey);
    case "affiliation_claim":
      return notifyAffiliationClaim(job.agencyId, job.agentProfessionalId);
    case "provider_enquiry":
      return notifyProviderEnquiry(job.enquiryId);
  }
}

/**
 * An agent's claim to work with an agency goes to the agency's own owners/admins (who can add them
 * through the existing team settings). It grants the agent no access to the agency.
 */
async function notifyAffiliationClaim(agencyId: string, agentProfessionalId: string) {
  const [agency, agent] = await Promise.all([
    db.marketplaceProfessional.findUnique({
      where: { id: agencyId },
      select: { displayName: true, members: { where: { status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } }, select: { userId: true } } },
    }),
    db.marketplaceProfessional.findUnique({ where: { id: agentProfessionalId }, select: { displayName: true } }),
  ]);
  if (!agency || !agent) return;
  await notifyUsers(agency.members.map(({ userId }) => userId), `affiliation:${agentProfessionalId}`, `👤 ${agent.displayName} registered on NesAfric and says they work with *${agency.displayName}*. If that's right, add them to your team in your NesAfric business settings. If not, you can ignore this — they have no access to your agency.`);
}

/** Tells a provider on WhatsApp about a new service request, when their account is linked. */
async function notifyProviderEnquiry(enquiryId: string) {
  const enquiry = await db.marketplaceEnquiry.findUnique({ where: { id: enquiryId }, select: { message: true, provider: { select: { administratorUserId: true } } } });
  if (!enquiry) return;
  await notifyUsers([enquiry.provider.administratorUserId], `provider-enquiry:${enquiryId}`, `📩 New service request on NesAfric (${referenceFor("QT", enquiryId)}):\n"${enquiry.message.slice(0, 300)}"\n\nOpen your NesAfric provider inbox to respond.`);
}

async function notifyUsers(userIds: Array<string | null | undefined>, key: string, body: string) {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return 0;
  const contacts = await db.whatsAppContact.findMany({ where: { userId: { in: ids } } });
  for (const contact of contacts) await queueNotification(contact.id, `${key}:${contact.id}`, body);
  return contacts.length;
}

export type ListingDecision = "published" | "changes_requested" | "rejected";

export async function notifyListingDecision(listingId: string, decision: ListingDecision, note: string | null | undefined, decisionKey: string) {
  const listing = await db.listing.findUnique({
    where: { id: listingId },
    select: { id: true, title: true, status: true, updatedAt: true, createdByUserId: true, listingRepresentativeUserId: true, sourceChannel: true },
  });
  if (!listing) return;
  const reference = referenceFor("PR", listing.id);
  const key = `listing-decision:${decisionKey}`;
  let body: string;
  if (decision === "published") {
    const visible = listing.status === "PUBLISHED" && (await publiclyEligibleListingIds([listing.id])).has(listing.id);
    if (!visible) {
      // Approved but not actually visible (e.g. the asset became unavailable): never claim it's live.
      await recordEvent("publication_not_visible", null, { listingId });
      return;
    }
    body = `🎉 Your listing *${listing.title}* has been approved and is now live on NesAfric.\nReference: ${reference}\nView it: ${propertyUrl(listing.id)}`;
    await recordEvent("listing_published", null, { listingId, viaWhatsApp: listing.sourceChannel === "WHATSAPP" });
  } else if (decision === "changes_requested") {
    body = `📝 Your listing *${listing.title}* needs a few changes before it can be published.\nReference: ${reference}\n\nReviewer's note:\n"${note ?? "Please review your listing."}"\n\nReply *edit listing* to update it and resubmit.`;
  } else {
    body = `Your listing *${listing.title}* was not approved.\nReference: ${reference}\n\nReason: "${note ?? "Not provided"}"\n\nYou can edit and resubmit it — reply *edit listing*, or *support* for help.`;
  }
  await notifyUsers([listing.createdByUserId, listing.listingRepresentativeUserId], key, body);
}

export async function notifyProfessionalVerification(professionalId: string, status: string, reason: string | null | undefined, decisionKey: string) {
  const professional = await db.marketplaceProfessional.findUnique({
    where: { id: professionalId },
    select: { id: true, displayName: true, createdByUserId: true, members: { where: { status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } }, select: { userId: true } } },
  });
  if (!professional) return;
  const reference = referenceFor("AG", professional.id);
  const body = status === "VERIFIED"
    ? `✅ *${professional.displayName}* has been verified by NesAfric.\nReference: ${reference}\nYour profile now shows as verified. Reply *list a property* to add listings.`
    : status === "REJECTED"
      ? `Your registration for *${professional.displayName}* was not approved.\nReference: ${reference}\nReason: "${reason ?? "Not provided"}"\nReply *support* if you'd like help.`
      : status === "SUSPENDED"
        ? `*${professional.displayName}* has been suspended on NesAfric.\nReference: ${reference}\nReason: "${reason ?? "Not provided"}"\nReply *support* for help.`
        : null;
  if (!body) return;
  await notifyUsers([professional.createdByUserId, ...professional.members.map(({ userId }) => userId)], `professional-verification:${decisionKey}`, body);
}

/**
 * Provider identity decision. A WhatsApp-registered provider was kept unlisted until now; on
 * approval its public profile is listed on the owner's behalf (they asked to be listed when they
 * registered), and the message includes the real public URL only if listing succeeded.
 */
export async function notifyProviderIdentityDecision(providerId: string, status: string, reason: string | null | undefined, decisionKey: string) {
  const provider = await db.serviceProvider.findUnique({
    where: { id: providerId },
    select: { id: true, slug: true, displayName: true, administratorUserId: true, verificationStatus: true, sourceChannel: true, marketplaceProfile: { select: { listed: true } } },
  });
  if (!provider) return;
  const reference = referenceFor("SV", provider.id);
  let body: string;
  if (status === "VERIFIED") {
    let listed = Boolean(provider.marketplaceProfile?.listed);
    if (!listed && provider.verificationStatus === "VERIFIED" && provider.sourceChannel === "WHATSAPP" && provider.marketplaceProfile) {
      try {
        await updateMarketplaceProfile(provider.administratorUserId, provider.id, { listed: true });
        listed = true;
      } catch (error) {
        console.error("[whatsapp-assistant] could not list approved provider", { providerId, error: errorLabel(error) });
      }
    }
    body = listed
      ? `✅ Your service profile *${provider.displayName}* has been approved and is now public on NesAfric.\nReference: ${reference}\nView it: ${providerUrl(provider)}`
      : `✅ Your identity has been verified for *${provider.displayName}*.\nReference: ${reference}\nFinish your public profile on NesAfric to appear in search.`;
  } else if (status === "REQUIRES_MORE_INFORMATION") {
    body = `📝 NesAfric needs more information to verify *${provider.displayName}*.\nReference: ${reference}\nNote: "${reason ?? ""}"\nReply *support* if you need help.`;
  } else if (status === "REJECTED") {
    body = `Your service profile *${provider.displayName}* was not approved.\nReference: ${reference}\nReason: "${reason ?? "Not provided"}"\nReply *support* if you'd like help.`;
  } else return;
  await notifyUsers([provider.administratorUserId], `provider-identity:${decisionKey}`, body);
}

/** Tells a WhatsApp customer when the agent confirms, reschedules or cancels their viewing. */
export async function notifyViewingUpdate(viewingRequestId: string, decisionKey: string) {
  const viewing = await db.viewingRequest.findUnique({
    where: { id: viewingRequestId },
    select: { id: true, status: true, confirmedStartsAt: true, updatedAt: true, listing: { select: { id: true, title: true } }, lead: { select: { source: true, phone: true } } },
  });
  if (!viewing || viewing.lead.source !== "whatsapp" || !viewing.lead.phone) return;
  const body = viewing.status === "CONFIRMED" && viewing.confirmedStartsAt
    ? `📅 Your viewing of *${viewing.listing.title}* is confirmed for ${dateTimeText(viewing.confirmedStartsAt)}.\nReference: ${referenceFor("VW", viewing.id)}\nDetails: ${propertyUrl(viewing.listing.id)}`
    : viewing.status === "RESCHEDULED"
      ? `📅 The agent would like to reschedule your viewing of *${viewing.listing.title}*. They'll contact you to agree a new time.\nReference: ${referenceFor("VW", viewing.id)}`
      : viewing.status === "CANCELLED"
        ? `Your viewing of *${viewing.listing.title}* has been cancelled.\nReference: ${referenceFor("VW", viewing.id)}\nReply *menu* to find other properties.`
        : null;
  if (!body) return;
  const contacts = await db.whatsAppContact.findMany({ where: { phoneE164: viewing.lead.phone } });
  for (const contact of contacts) await queueNotification(contact.id, `viewing:${decisionKey}:${contact.id}`, body);
}
