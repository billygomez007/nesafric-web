import { randomUUID } from "node:crypto";
import { listUserMarketplaceProfessionals } from "@/modules/marketplace-professionals/service";
import { db } from "@/platform/database/client";
import { completedActions } from "../actions";
import type { Ctx, StartSeed, Workflow } from "../context";
import { dateTimeText, propertyUrl } from "../format";
import { accountExistsForContact, linkedUser } from "../identity";
import type { ReplyOption } from "../messages";
import { matchesReference, parseReference, referenceFor, type ReferenceKind } from "../references";
import { WORKFLOW_TITLES } from "../state";
import { recordEvent } from "../store";

const LISTING_STATUS: Record<string, string> = {
  DRAFT: "Draft (not submitted)", PENDING_REVIEW: "Pending NesAfric review", PUBLISHED: "Published ✅", PAUSED: "Paused",
  RESERVED: "Reserved", RENTED: "Rented / sold", ARCHIVED: "Withdrawn", REJECTED: "Not approved — changes needed",
};
const VERIFICATION: Record<string, string> = {
  UNVERIFIED: "Not yet submitted for verification", PENDING: "Under review", VERIFIED: "Approved ✅", REJECTED: "Not approved",
  SUSPENDED: "Suspended", REQUIRES_MORE_INFORMATION: "More information needed",
};
const LEAD: Record<string, string> = { NEW: "Sent to agent", CONTACTED: "Agent has responded", QUALIFIED: "In progress", VIEWING_SCHEDULED: "Viewing requested", VIEWING_COMPLETED: "Viewing done", CLOSED: "Closed", LOST: "Closed" };
const VIEWING: Record<string, string> = { REQUESTED: "Waiting for the agent to confirm", CONFIRMED: "Confirmed ✅", RESCHEDULED: "Rescheduled", COMPLETED: "Completed", CANCELLED: "Cancelled", NO_SHOW: "Missed" };
const ENQUIRY: Record<string, string> = { NEW: "Sent to provider", VIEWED: "Seen by provider", RESPONDED: "Provider responded", CLOSED: "Closed", CANCELLED: "Cancelled" };

type Item = { kind: ReferenceKind; id: string; line: string; option?: ReplyOption };

/** Everything this person can see: only records they own, created, or requested from this number. */
async function collectItems(ctx: Ctx): Promise<Item[]> {
  const items: Item[] = [];
  const user = await linkedUser(ctx.contact);
  if (!user && (await accountExistsForContact(ctx.contact))) {
    items.push({ kind: "SP", id: "link", line: "🔗 This number has a NesAfric account that isn't linked to WhatsApp. Reply *link account* to see its listings and applications here." });
  }
  if (user) {
    const professionals = await listUserMarketplaceProfessionals(user.id);
    for (const professional of professionals) {
      items.push({ kind: "AG", id: professional.id, line: `🏢 *${professional.displayName}* (${referenceFor("AG", professional.id)})\n   Verification: ${VERIFICATION[professional.verificationStatus] ?? professional.verificationStatus}` });
    }
    const providers = await db.serviceProvider.findMany({
      where: { administratorUserId: user.id, archivedAt: null },
      select: { id: true, displayName: true, verificationStatus: true, suspendedAt: true, marketplaceProfile: { select: { listed: true } } },
      take: 5,
    });
    for (const provider of providers) {
      const visibility = provider.suspendedAt ? "Suspended" : provider.marketplaceProfile?.listed ? "Public on NesAfric" : "Not public yet";
      items.push({ kind: "SV", id: provider.id, line: `🛠 *${provider.displayName}* (${referenceFor("SV", provider.id)})\n   Verification: ${VERIFICATION[provider.verificationStatus] ?? provider.verificationStatus} · ${visibility}` });
    }
    const listings = await db.listing.findMany({
      where: {
        OR: [
          { createdByUserId: user.id },
          { marketplaceProfessionalId: { in: professionals.filter(({ myRole }) => myRole !== "AGENT").map(({ id }) => id) } },
        ],
        status: { not: "ARCHIVED" },
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: { id: true, title: true, status: true, statusHistory: { where: { note: { not: null } }, orderBy: { createdAt: "desc" }, take: 1, select: { note: true, toStatus: true, actorUserId: true } } },
    });
    for (const listing of listings) {
      const returned = listing.status === "REJECTED" || (listing.status === "DRAFT" && listing.statusHistory[0]?.toStatus === "DRAFT" && listing.statusHistory[0]?.actorUserId !== user.id);
      const note = returned && listing.statusHistory[0]?.note ? `\n   Reviewer: "${listing.statusHistory[0].note}"` : "";
      const status = returned && listing.status === "DRAFT" ? "Changes requested" : LISTING_STATUS[listing.status] ?? listing.status;
      items.push({
        kind: "PR",
        id: listing.id,
        line: `🏠 *${listing.title}* (${referenceFor("PR", listing.id)})\n   ${status}${listing.status === "PUBLISHED" ? `\n   ${propertyUrl(listing.id)}` : ""}${note}`,
        option: ["DRAFT", "REJECTED", "PAUSED", "PUBLISHED"].includes(listing.status) ? { id: `st:listing:${listing.id}`, title: returned ? `Fix ${referenceFor("PR", listing.id)}` : `Manage ${referenceFor("PR", listing.id)}`, description: listing.title } : undefined,
      });
    }
  }
  const actions = await completedActions(ctx.contact.id, ["lead", "viewing", "service_enquiry"], 20);
  const ids = (kind: string) => actions.filter((action) => action.kind === kind).map(({ resultId }) => resultId!);
  const [leads, viewings, enquiries] = await Promise.all([
    db.marketplaceLead.findMany({ where: { id: { in: ids("lead") } }, select: { id: true, status: true, listing: { select: { title: true } } }, orderBy: { createdAt: "desc" }, take: 5 }),
    db.viewingRequest.findMany({ where: { id: { in: ids("viewing") } }, select: { id: true, status: true, confirmedStartsAt: true, listing: { select: { title: true } } }, orderBy: { createdAt: "desc" }, take: 5 }),
    db.marketplaceEnquiry.findMany({ where: { id: { in: ids("service_enquiry") } }, select: { id: true, status: true, provider: { select: { displayName: true } } }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  for (const lead of leads) items.push({ kind: "IQ", id: lead.id, line: `💬 Inquiry: ${lead.listing.title} (${referenceFor("IQ", lead.id)})\n   ${LEAD[lead.status] ?? lead.status}` });
  for (const viewing of viewings) items.push({ kind: "VW", id: viewing.id, line: `📅 Viewing: ${viewing.listing.title} (${referenceFor("VW", viewing.id)})\n   ${VIEWING[viewing.status] ?? viewing.status}${viewing.status === "CONFIRMED" && viewing.confirmedStartsAt ? ` — ${dateTimeText(viewing.confirmedStartsAt)}` : ""}` });
  for (const enquiry of enquiries) items.push({ kind: "QT", id: enquiry.id, line: `🧰 Request to ${enquiry.provider.displayName} (${referenceFor("QT", enquiry.id)})\n   ${ENQUIRY[enquiry.status] ?? enquiry.status}` });
  const support = await db.whatsAppSupportRequest.findMany({ where: { contactId: ctx.contact.id, status: { not: "RESOLVED" } }, orderBy: { createdAt: "desc" }, take: 3 });
  for (const request of support) items.push({ kind: "SP", id: request.id, line: `🆘 Support request ${request.reference}\n   ${request.status === "OPEN" ? "Waiting for our team" : "Our team is on it"}` });
  return items;
}

export const status: Workflow = {
  key: "status",

  async start(ctx: Ctx, seed: StartSeed) {
    ctx.go("status", "list", {});
    const reference = seed.text ? parseReference(seed.text) : null;
    let items = await collectItems(ctx);
    await recordEvent("status_checked", ctx.contact.id, { reference: Boolean(reference) });
    if (reference) {
      items = items.filter((item) => (item.kind === reference.kind || (reference.kind === "SP" && item.kind === "SP")) && (item.kind === "SP" ? item.line.includes(`NES-SP-${reference.prefix.toUpperCase()}`) : matchesReference(item.id, reference.prefix)));
      if (!items.length) {
        ctx.say("I couldn't find that reference among your applications, listings or requests from this WhatsApp number.");
        return ctx.finish();
      }
    }
    if (!items.length) {
      ctx.say("You don't have any applications, listings or requests with NesAfric from this WhatsApp number yet.");
      ctx.finish();
      return;
    }
    ctx.say(`*Your NesAfric activity:*\n\n${items.map(({ line }) => line).join("\n\n")}`);
    const options = items.flatMap(({ option }) => (option ? [option] : [])).slice(0, 9);
    if (options.length) {
      ctx.ask("Choose an item to update it, or go back to the menu.", [...options, { id: "menu", title: "Main menu" }], "Options");
      return;
    }
    ctx.finish();
  },

  async handle(ctx: Ctx) {
    const choice = ctx.choice;
    if (choice?.startsWith("st:listing:")) {
      ctx.handoff = { workflow: "listing", seed: { preset: `edit:${choice.slice("st:listing:".length)}` } };
      return;
    }
    return status.start(ctx, { text: ctx.text });
  },

  async reprompt(ctx: Ctx) {
    return status.start(ctx, {});
  },
};

// ------------------------------------------------------------------------------------------------
// Human support
// ------------------------------------------------------------------------------------------------

export async function createSupportRequest(input: { contactId: string; userId: string | null; topic: string; summary: string; workflow?: string | null }) {
  const id = randomUUID();
  return db.whatsAppSupportRequest.create({
    data: {
      id,
      reference: referenceFor("SP", id),
      contactId: input.contactId,
      userId: input.userId,
      topic: input.topic.slice(0, 80),
      summary: input.summary.slice(0, 4000),
      workflow: input.workflow ?? null,
    },
  });
}

export const support: Workflow = {
  key: "support",

  async start(ctx: Ctx) {
    // Keep a pointer to whatever the person was doing so staff see the context (never its data).
    const context = ctx.state.paused?.workflow ?? (ctx.state.workflow && ctx.state.workflow !== "support" ? ctx.state.workflow : null);
    ctx.go("support", "describe", { context });
    ctx.prompt("I'll pass you to the NesAfric team. Briefly, what do you need help with?");
  },

  async handle(ctx: Ctx) {
    const text = ctx.text;
    if (text.length < 3) return support.reprompt(ctx);
    const context = ctx.data<{ context?: string | null }>().context ?? null;
    const request = await createSupportRequest({
      contactId: ctx.contact.id,
      userId: ctx.contact.userId,
      topic: "customer_request",
      summary: text,
      workflow: context,
    });
    await recordEvent("support_requested", ctx.contact.id, { workflow: context });
    ctx.say(`🙋 Thanks — a member of the NesAfric team will reply here as soon as possible.\nReference: ${request.reference}${context ? `\n(We've noted you were in the middle of a ${WORKFLOW_TITLES[context as keyof typeof WORKFLOW_TITLES] ?? "request"}.)` : ""}`);
    ctx.finish();
  },

  async reprompt(ctx: Ctx) {
    ctx.prompt("Please describe what you need help with in a sentence or two.");
  },
};
