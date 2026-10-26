import { db } from "@/platform/database/client";
import type { Prisma, ViewingRequestStatus } from "@/platform/database/generated/client";
import { PERMISSIONS } from "@/platform/authorization/permissions";
import { record, requirePropertyOsOrMarketplaceAccess } from "@/modules/listings/service";
import { replyButtons, type WhatsAppInteractive } from "@/modules/conversations/channels/whatsapp-interactive";
import { queueUtilityTemplate } from "@/modules/whatsapp-templates/send";
import { utilityTemplate } from "@/modules/whatsapp-templates/registry";
import { queueOfficialText, whatsappRecipientE164 } from "./outbound";
import { formatViewingTime, parseViewingTime } from "./viewing-time";
import { firstNameFrom } from "./welcome";

/**
 * Viewing negotiation on WhatsApp. A viewing requested in the chat starts with the customer's
 * proposed time; the listing team accepts it, proposes another or declines; the customer answers a
 * counter-proposal the same way. A viewing is confirmed only when one side accepts the other's
 * open proposal (`ViewingProposal`). Every status change goes through the viewing transitions of
 * the listings domain, with an audit event, and is noted as agreed on WhatsApp so the template
 * dispatcher does not send its own copy of what the chat already said.
 */

type Tx = Prisma.TransactionClient;
type Reply = { reply: string; interactive?: WhatsAppInteractive };
type Basis = "ENQUIRY_OPT_IN" | "LINKED_ACCOUNT";

export const WHATSAPP_NEGOTIATION_NOTE = "Agreed on WhatsApp.";
const SLOT_MS = 60 * 60_000;
const FINAL: ViewingRequestStatus[] = ["COMPLETED", "CANCELLED", "NO_SHOW"];
const TRANSITIONS: Record<ViewingRequestStatus, ViewingRequestStatus[]> = {
  REQUESTED: ["CONFIRMED", "RESCHEDULED", "CANCELLED"], CONFIRMED: ["RESCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"], RESCHEDULED: ["CONFIRMED", "CANCELLED"], COMPLETED: [], CANCELLED: [], NO_SHOW: [],
};

/** The reference people see and type: the same short form the templates use. */
export const viewingReference = (id: string) => `VW-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
const COMMAND = /^(accept|propose|decline|cancel)\s+(vw-[0-9a-f]{6})(?:\s+([\s\S]+))?$/i;
const accraDate = (at: Date) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Accra" }).format(at);
const accraClock = (at: Date) => `${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Accra" }).format(at)} GMT`;
const first = (name: string | null | undefined) => firstNameFrom(name) ?? "there";

const viewingInclude = {
  listing: { select: { id: true, title: true, organisationId: true, createdByUserId: true, listingRepresentativeUserId: true } },
  lead: { select: { id: true, name: true, phone: true, assigneeMemberId: true } },
  proposals: { where: { status: "OPEN" as const }, take: 1 },
} satisfies Prisma.ViewingRequestInclude;
type Viewing = Prisma.ViewingRequestGetPayload<{ include: typeof viewingInclude }>;

const loadViewing = (client: Tx | typeof db, id: string) => client.viewingRequest.findUnique({ where: { id }, include: viewingInclude });

/** Viewings whose reference matches (6 hex characters of the id; almost always exactly one). */
async function viewingsByReference(reference: string) {
  const prefix = reference.slice(3).toLowerCase();
  const rows = await db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "ViewingRequest" WHERE replace("id"::text, '-', '') LIKE ${`${prefix}%`} LIMIT 5`;
  return rows.map((row) => row.id);
}

/** The person on the listing side: the lead's assignee, else the listing's representative, else whoever listed it. */
async function listingTeam(client: Tx | typeof db, viewing: Viewing) {
  const assignee = viewing.lead.assigneeMemberId ? await client.organisationMember.findUnique({ where: { id: viewing.lead.assigneeMemberId }, select: { userId: true } }) : null;
  const userId = assignee?.userId ?? viewing.listing.listingRepresentativeUserId ?? viewing.listing.createdByUserId;
  const identity = await client.channelIdentity.findFirst({ where: { channel: "WHATSAPP", userId, verifiedAt: { not: null } }, orderBy: { verifiedAt: "desc" }, include: { user: { select: { displayName: true } } } });
  return { userId, phone: identity?.address ?? null, name: identity?.user?.displayName ?? "" };
}
const customerOf = (viewing: Viewing) => ({ phone: viewing.lead.phone ? whatsappRecipientE164(viewing.lead.phone) : null, name: viewing.lead.name });

/** Free text with buttons inside the 24-hour window; otherwise the approved Utility template, if any. */
async function tell(tx: Tx, to: { phone: string | null; name: string }, key: string, text: string, interactive?: WhatsAppInteractive, template?: { key: string; values: Record<string, string>; basis: Basis }) {
  if (!to.phone) return { messageId: null, reason: "No WhatsApp number." };
  const phone = to.phone;
  return queueOfficialText(tx, {
    phoneE164: phone, displayName: to.name, text, interactive, externalMessageId: `viewing:${key}`, metadata: { viewingNotice: key },
    fallback: template ? async () => {
      const result = await queueUtilityTemplate(tx, { template: utilityTemplate(template.key), recipient: { phone, displayName: to.name, basis: template.basis }, values: template.values, idempotencyKey: key });
      return result.outcome === "QUEUED" ? { messageId: result.messageId } : { messageId: null, reason: result.reason };
    } : undefined,
  });
}

const teamButtons = (text: string, reference: string) => replyButtons(text, [{ id: `accept ${reference.toLowerCase()}`, title: "Accept" }, { id: `propose ${reference.toLowerCase()}`, title: "Propose new time" }, { id: `decline ${reference.toLowerCase()}`, title: "Decline" }]);
const customerButtons = (text: string, reference: string) => replyButtons(text, [{ id: `accept ${reference.toLowerCase()}`, title: "Accept" }, { id: `propose ${reference.toLowerCase()}`, title: "Another time" }, { id: `cancel ${reference.toLowerCase()}`, title: "Cancel viewing" }]);

async function alertTeam(tx: Tx, viewing: Viewing, startsAt: Date, key: string) {
  const team = await listingTeam(tx, viewing);
  const reference = viewingReference(viewing.id);
  const text = `Viewing request ${reference} for ${viewing.listing.title}.\n${first(viewing.lead.name)} would like to view it on ${formatViewingTime(startsAt)}.\nTap Accept, Propose new time or Decline, or reply: accept ${reference}, propose ${reference} saturday 10am, or decline ${reference}.`;
  return tell(tx, team, `${viewing.id}:${key}:team`, text, teamButtons(text, reference), { key: "U31", values: { recipient_name: first(team.name), property_name: viewing.listing.title, reference }, basis: "LINKED_ACCOUNT" });
}

/**
 * Starts the negotiation for a viewing just requested in the chat: the customer's preferred time is
 * the first open proposal, and the listing team is asked about it. Safe to call again.
 */
export async function openViewingNegotiation(viewingId: string) {
  return db.$transaction(async (tx) => {
    const viewing = await loadViewing(tx, viewingId);
    if (!viewing || FINAL.includes(viewing.status)) return { teamReachable: false };
    const team = await listingTeam(tx, viewing);
    if (await tx.viewingProposal.count({ where: { viewingRequestId: viewing.id } })) return { teamReachable: Boolean(team.phone) };
    const preferred = await tx.viewingPreferredTime.findFirst({ where: { viewingRequestId: viewing.id }, orderBy: { startsAt: "asc" } });
    if (!preferred) return { teamReachable: Boolean(team.phone) };
    await tx.viewingProposal.create({ data: { viewingRequestId: viewing.id, proposedBy: "CUSTOMER", startsAt: preferred.startsAt, endsAt: preferred.endsAt, sourceMessageId: "request" } });
    const sent = await alertTeam(tx, viewing, preferred.startsAt, "request");
    return { teamReachable: sent.messageId !== null };
  });
}

/** Status change with the same rules, timestamps, history and events as the listings domain. */
async function applyStatus(tx: Tx, viewing: Viewing, actorUserId: string | undefined, status: ViewingRequestStatus, times?: { startsAt: Date; endsAt: Date }) {
  if (!TRANSITIONS[viewing.status].includes(status)) throw new Error(`Viewing ${viewing.id} cannot move from ${viewing.status} to ${status}.`);
  const now = new Date();
  await tx.viewingRequest.update({
    where: { id: viewing.id },
    data: {
      status, ...(times ? { confirmedStartsAt: times.startsAt, confirmedEndsAt: times.endsAt } : {}),
      ...(status === "CONFIRMED" ? { confirmedAt: now } : status === "RESCHEDULED" ? { rescheduledAt: now } : status === "CANCELLED" ? { cancelledAt: now } : {}),
      history: { create: { actorUserId, fromStatus: viewing.status, toStatus: status, note: WHATSAPP_NEGOTIATION_NOTE } },
    },
  });
  const payload = { listingId: viewing.listingId, leadId: viewing.leadId, fromStatus: viewing.status, toStatus: status, via: "WHATSAPP" };
  await record(tx, viewing.organisationId, actorUserId, "listing.viewing_status_changed", "viewing_request", viewing.id, payload);
  if (status === "CONFIRMED" || status === "RESCHEDULED") await record(tx, viewing.organisationId, actorUserId, `viewing.${status.toLowerCase()}`, "viewing_request", viewing.id, { listingId: viewing.listingId, leadId: viewing.leadId, outcome: null });
}

type Role = "customer" | "team";

/** Who the sender is for this viewing: the customer (by the lead's number) and/or a permitted team member. */
async function rolesFor(viewing: Viewing, phone: string, linkedUserId: string | undefined) {
  const roles = new Set<Role>();
  if (customerOf(viewing).phone === whatsappRecipientE164(`+${phone.replace(/^\+/, "")}`)) roles.add("customer");
  if (linkedUserId) {
    const allowed = await requirePropertyOsOrMarketplaceAccess(linkedUserId, viewing.organisationId, PERMISSIONS.listingViewingManage).then(() => true, () => false);
    if (allowed) roles.add("team");
  }
  return roles;
}

/**
 * accept / propose / decline / cancel with a viewing reference, from either side. Returns null
 * when the message is not one of these (so other commands, such as job "accept", still work).
 */
export async function handleViewingCommand(input: { phone: string; body: string; messageId: string; linkedUserId?: string }, now = new Date()): Promise<Reply | null> {
  const match = COMMAND.exec(input.body.trim());
  if (!match) return null;
  const action = match[1].toLowerCase() as "accept" | "propose" | "decline" | "cancel";
  const reference = match[2].toUpperCase();
  const rest = match[3]?.trim();

  let found: { viewing: Viewing; roles: Set<Role> } | null = null;
  for (const id of await viewingsByReference(reference)) {
    const viewing = await loadViewing(db, id);
    if (!viewing) continue;
    const roles = await rolesFor(viewing, input.phone, input.linkedUserId);
    if (roles.size) { found = { viewing, roles }; break; }
  }
  if (!found) return { reply: `I could not find viewing ${reference} for this number.` };
  const { viewing, roles } = found;
  if (FINAL.includes(viewing.status)) return { reply: `Viewing ${reference} is ${viewing.status.toLowerCase().replace("_", " ")}; nothing was changed.` };
  const open = viewing.proposals[0];
  // The side that answers an open proposal is the other side from whoever made it.
  const answering: Role | undefined = open ? (open.proposedBy === "CUSTOMER" ? "team" : "customer") : undefined;

  if (action === "accept") {
    if (!open) return { reply: `There is no proposed time waiting on viewing ${reference}.` };
    if (!roles.has(answering!)) return { reply: `Viewing ${reference} is waiting for the ${answering === "team" ? "listing team" : "customer"} to answer.` };
    if (open.startsAt <= now) return { reply: `That time (${formatViewingTime(open.startsAt)}) has passed. Propose another: propose ${reference} saturday 10am.` };
    return confirmProposal(viewing.id, open.id, answering!, input.linkedUserId);
  }
  if (action === "propose") {
    const role: Role = roles.has("team") && roles.has("customer") ? (answering ?? "team") : roles.has("team") ? "team" : "customer";
    if (!rest) return { reply: `Send the time you suggest, for example: propose ${reference} saturday 10am, or propose ${reference} 20/12 14:00 (Ghana time).` };
    const startsAt = parseViewingTime(rest, now);
    if (!startsAt) return { reply: `I could not read "${rest.slice(0, 40)}" as a future date and time. Try: propose ${reference} tomorrow 3pm.` };
    return propose(viewing.id, role, startsAt, input.messageId, input.linkedUserId);
  }
  // decline (listing team) and cancel (either side) end the viewing request.
  const role: Role = action === "decline" ? "team" : roles.has("customer") ? "customer" : "team";
  if (!roles.has(role)) return { reply: action === "decline" ? `Only the listing team can decline viewing ${reference}. To cancel it, reply cancel ${reference}.` : `I could not find viewing ${reference} for this number.` };
  return endViewing(viewing.id, role, action, rest, input.linkedUserId);
}

async function confirmProposal(viewingId: string, proposalId: string, role: Role, actorUserId: string | undefined): Promise<Reply> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ViewingRequest" WHERE "id" = ${viewingId}::uuid FOR UPDATE`;
    const viewing = (await loadViewing(tx, viewingId))!;
    const reference = viewingReference(viewing.id);
    const open = viewing.proposals[0];
    if (!open || open.id !== proposalId) return { reply: `Viewing ${reference} changed meanwhile; nothing was confirmed. Reply accept ${reference} again if a time is still proposed.` };
    const status: ViewingRequestStatus = viewing.status === "CONFIRMED" ? "RESCHEDULED" : "CONFIRMED";
    await applyStatus(tx, viewing, role === "team" ? actorUserId : undefined, status, { startsAt: open.startsAt, endsAt: open.endsAt });
    await tx.viewingProposal.update({ where: { id: open.id }, data: { status: "ACCEPTED", respondedAt: new Date(), ...(role === "team" ? { actorUserId } : {}) } });
    const when = formatViewingTime(open.startsAt);
    const customer = customerOf(viewing);
    const team = await listingTeam(tx, viewing);
    const values = { recipient_name: "", property_name: viewing.listing.title, date: accraDate(open.startsAt), time: accraClock(open.startsAt) };
    const templateKey = status === "CONFIRMED" ? "U02" : "U04";
    const key = `${viewing.id}:${open.id}:confirmed`;
    await tell(tx, customer, `${key}:customer`, `Your viewing ${reference} of ${viewing.listing.title} is confirmed for ${when}.\nI'll remind you 2 hours and 1 hour before. Reply cancel ${reference} if you can no longer make it.`, undefined, { key: templateKey, values: { ...values, recipient_name: first(customer.name) }, basis: "ENQUIRY_OPT_IN" });
    await tell(tx, team, `${key}:team`, `Viewing ${reference} of ${viewing.listing.title} with ${first(customer.name)} is confirmed for ${when}.\nI'll remind you 2 hours and 1 hour before.`, undefined, { key: templateKey, values: { ...values, recipient_name: first(team.name) }, basis: "LINKED_ACCOUNT" });
    return { reply: `Confirmed: viewing ${reference} of ${viewing.listing.title} on ${when}. Both sides have been told.` };
  });
}

async function propose(viewingId: string, role: Role, startsAt: Date, messageId: string, actorUserId: string | undefined): Promise<Reply> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ViewingRequest" WHERE "id" = ${viewingId}::uuid FOR UPDATE`;
    const viewing = (await loadViewing(tx, viewingId))!;
    const reference = viewingReference(viewing.id);
    const when = formatViewingTime(startsAt);
    // A redelivered message proposes once.
    if (await tx.viewingProposal.findUnique({ where: { viewingRequestId_sourceMessageId: { viewingRequestId: viewing.id, sourceMessageId: messageId } } })) return { reply: `You proposed ${when} for viewing ${reference}. I'll tell you when they answer.` };
    await tx.viewingProposal.updateMany({ where: { viewingRequestId: viewing.id, status: "OPEN" }, data: { status: "SUPERSEDED", respondedAt: new Date() } });
    const proposal = await tx.viewingProposal.create({ data: { viewingRequestId: viewing.id, proposedBy: role === "team" ? "LISTING_TEAM" : "CUSTOMER", actorUserId: role === "team" ? actorUserId : null, startsAt, endsAt: new Date(startsAt.getTime() + SLOT_MS), sourceMessageId: messageId } });
    const customer = customerOf(viewing);
    if (role === "team") {
      const text = `The listing team suggests another time for your viewing ${reference} of ${viewing.listing.title}: ${when}.\nTap Accept, Another time or Cancel viewing, or reply accept ${reference}, propose ${reference} <time>, or cancel ${reference}.`;
      await tell(tx, customer, `${viewing.id}:${proposal.id}:proposal:customer`, text, customerButtons(text, reference), { key: "U05", values: { recipient_name: first(customer.name), property_name: viewing.listing.title, reference }, basis: "ENQUIRY_OPT_IN" });
    } else {
      await alertTeam(tx, viewing, startsAt, `${proposal.id}:proposal`);
    }
    return { reply: `You proposed ${when} for viewing ${reference}. I'll tell you when ${role === "team" ? first(customer.name) : "the listing team"} answers.` };
  });
}

async function endViewing(viewingId: string, role: Role, action: "decline" | "cancel", reason: string | undefined, actorUserId: string | undefined): Promise<Reply> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ViewingRequest" WHERE "id" = ${viewingId}::uuid FOR UPDATE`;
    const viewing = (await loadViewing(tx, viewingId))!;
    const reference = viewingReference(viewing.id);
    if (FINAL.includes(viewing.status)) return { reply: `Viewing ${reference} is already ${viewing.status.toLowerCase()}.` };
    await applyStatus(tx, viewing, role === "team" ? actorUserId : undefined, "CANCELLED");
    await tx.viewingProposal.updateMany({ where: { viewingRequestId: viewing.id, status: "OPEN" }, data: { status: action === "decline" ? "DECLINED" : "WITHDRAWN", respondedAt: new Date() } });
    const customer = customerOf(viewing);
    const scheduled = viewing.confirmedStartsAt ?? viewing.proposals[0]?.startsAt;
    const note = reason ? ` Reason given: ${reason.slice(0, 200)}` : "";
    if (role === "team") {
      await tell(tx, customer, `${viewing.id}:cancelled:customer`, `Sorry, the listing team cannot do a viewing of ${viewing.listing.title} (${reference}).${note}\nReply find a property to see other homes, or support for help.`, undefined, scheduled ? { key: "U06", values: { recipient_name: first(customer.name), property_name: viewing.listing.title, scheduled_for: `${accraDate(scheduled)}, ${accraClock(scheduled)}` }, basis: "ENQUIRY_OPT_IN" } : undefined);
    } else {
      const team = await listingTeam(tx, viewing);
      await tell(tx, team, `${viewing.id}:cancelled:team`, `${first(customer.name)} cancelled viewing ${reference} of ${viewing.listing.title}.${note}`, undefined, scheduled ? { key: "U06", values: { recipient_name: first(team.name), property_name: viewing.listing.title, scheduled_for: `${accraDate(scheduled)}, ${accraClock(scheduled)}` }, basis: "LINKED_ACCOUNT" } : undefined);
    }
    return { reply: `Viewing ${reference} is cancelled. ${role === "team" ? first(customer.name) : "The listing team"} has been told.` };
  });
}

// ---------------------------------------------------------------------------------------------
// Reminders and the after-viewing check
// ---------------------------------------------------------------------------------------------

const REMINDERS_MIN = [120, 60];
const LATE_LIMIT_MS = 30 * 60_000;
const FOLLOW_UP_AFTER_MS = 2 * 60 * 60_000;
const BOOKED: ViewingRequestStatus[] = ["CONFIRMED", "RESCHEDULED"];

/**
 * Queues reminder jobs for booked viewings: 2 hours and 1 hour before (each sent at most once per
 * agreed time, and not if more than 30 minutes late), and a check 2 hours after. Runs with the
 * scheduled work every few minutes; the job key makes repeats harmless.
 */
export async function scheduleViewingReminders(now = new Date()) {
  const viewings = await db.viewingRequest.findMany({
    where: { status: { in: BOOKED }, confirmedStartsAt: { gt: new Date(now.getTime() - FOLLOW_UP_AFTER_MS - 24 * 60 * 60_000), lt: new Date(now.getTime() + 2 * 60 * 60_000 + 5 * 60_000) }, proposals: { some: { status: "ACCEPTED" } } },
    select: { id: true, organisationId: true, confirmedStartsAt: true },
  });
  let queued = 0;
  for (const viewing of viewings) {
    const startsAt = viewing.confirmedStartsAt!;
    const due = [
      ...REMINDERS_MIN.map((minutes) => ({ kind: `${minutes}m`, at: startsAt.getTime() - minutes * 60_000, until: Math.min(startsAt.getTime() - minutes * 60_000 + LATE_LIMIT_MS, startsAt.getTime()) })),
      { kind: "follow-up", at: startsAt.getTime() + FOLLOW_UP_AFTER_MS, until: startsAt.getTime() + FOLLOW_UP_AFTER_MS + 24 * 60 * 60_000 },
    ].filter((item) => now.getTime() >= item.at && now.getTime() < item.until);
    for (const item of due) {
      const idempotencyKey = `whatsapp-viewing-reminder:${viewing.id}:${item.kind}:${startsAt.toISOString()}`;
      const created = await db.backgroundJob.createMany({ data: [{ organisationId: viewing.organisationId, type: "whatsapp-viewing-reminder", idempotencyKey, payload: { organisationId: viewing.organisationId, viewingRequestId: viewing.id, kind: item.kind, startsAt: startsAt.toISOString() }, maxAttempts: 5 }], skipDuplicates: true });
      queued += created.count;
    }
  }
  return { queued };
}

/** Sends one reminder or the after-viewing check, after re-checking the booking. */
export async function sendViewingReminder(payload: Record<string, unknown>, now = new Date()) {
  const viewingId = String(payload.viewingRequestId);
  const kind = String(payload.kind);
  const startsAt = new Date(String(payload.startsAt));
  await db.$transaction(async (tx) => {
    const viewing = await loadViewing(tx, viewingId);
    // Moved, cancelled or completed since this was queued: nothing to remind about.
    if (!viewing || !BOOKED.includes(viewing.status) || viewing.confirmedStartsAt?.getTime() !== startsAt.getTime()) return;
    const reference = viewingReference(viewing.id);
    const when = formatViewingTime(startsAt);
    const customer = customerOf(viewing);
    const key = `${viewing.id}:${kind}:${startsAt.toISOString()}`;
    if (kind === "follow-up") {
      const text = `Did your viewing ${reference} of ${viewing.listing.title} on ${when} take place?`;
      // Only inside the conversation window: there is no approved template for this question.
      await tell(tx, customer, `${key}:customer`, text, replyButtons(text, [{ id: `viewed ${reference.toLowerCase()} yes`, title: "Yes, it happened" }, { id: `viewed ${reference.toLowerCase()} no`, title: "No, it didn't" }]));
      return;
    }
    if (startsAt.getTime() <= now.getTime()) return;
    const team = await listingTeam(tx, viewing);
    const values = { property_name: viewing.listing.title, date: accraDate(startsAt), time: accraClock(startsAt) };
    const lead = kind === "120m" ? "in 2 hours" : "in 1 hour";
    await tell(tx, customer, `${key}:customer`, `Reminder: your viewing ${reference} of ${viewing.listing.title} is ${lead}, at ${when}. Reply cancel ${reference} if you can no longer make it.`, undefined, { key: "U03", values: { ...values, recipient_name: first(customer.name) }, basis: "ENQUIRY_OPT_IN" });
    await tell(tx, team, `${key}:team`, `Reminder: viewing ${reference} of ${viewing.listing.title} with ${first(customer.name)} is ${lead}, at ${when}.`, undefined, { key: "U03", values: { ...values, recipient_name: first(team.name) }, basis: "LINKED_ACCOUNT" });
  });
}

const VIEWED = /^viewed\s+(vw-[0-9a-f]{6})\s+(yes|no)$/i;

/**
 * The customer's answer to the after-viewing check. It is recorded on the enquiry and passed to the
 * listing team; only the team marks the viewing completed or a no-show.
 */
export async function handleViewingOutcome(input: { phone: string; body: string }): Promise<Reply | null> {
  const match = VIEWED.exec(input.body.trim());
  if (!match) return null;
  const reference = match[1].toUpperCase();
  const happened = match[2].toLowerCase() === "yes";
  for (const id of await viewingsByReference(reference)) {
    const result = await db.$transaction(async (tx) => {
      const viewing = await loadViewing(tx, id);
      if (!viewing || !(await rolesFor(viewing, input.phone, undefined)).has("customer")) return null;
      const already = await tx.marketplaceLeadActivity.findFirst({ where: { leadId: viewing.leadId, type: "lead.viewing_feedback", metadata: { path: ["viewingRequestId"], equals: viewing.id } } });
      if (!already) {
        await tx.marketplaceLeadActivity.create({ data: { leadId: viewing.leadId, type: "lead.viewing_feedback", note: happened ? "The customer says the viewing took place." : "The customer says the viewing did not take place.", metadata: { viewingRequestId: viewing.id, happened, via: "WHATSAPP" } } });
        const team = await listingTeam(tx, viewing);
        await tell(tx, team, `${viewing.id}:feedback:team`, `${first(viewing.lead.name)} says viewing ${reference} of ${viewing.listing.title} ${happened ? "took place" : "did not take place"}. Please record the outcome in NesAfric.`);
      }
      return { reply: happened ? "Thank you. I've let the listing team know. Reply inquire or view on another property, or menu for more options." : "Thank you for telling me. I've let the listing team know. Reply propose " + reference + " <time> if you'd like another viewing, or menu." };
    });
    if (result) return result;
  }
  return { reply: `I could not find viewing ${reference} for this number.` };
}
