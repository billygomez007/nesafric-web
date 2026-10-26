import { db } from "@/platform/database/client";
import type { PlatformPrincipal, User } from "@/platform/database/generated/client";
import { verifyPassword } from "@/platform/auth/passwords";
import { AppError } from "@/platform/errors";
import { replyButtons, type WhatsAppInteractive } from "@/modules/conversations/channels/whatsapp-interactive";
import { getVerificationQueueForPlatform, recordPlatformAudit, rejectListingForPlatform, requestListingChangesForPlatform, verifyAndPublishListingForPlatform } from "@/modules/platform-admin/service";
import { reviewMarketplaceVerification } from "@/modules/marketplace-professionals/service";
import { listPendingProviderIdentityReviews, reviewProviderIdentity } from "@/modules/providers/service";
import { getSignedStorageAccess } from "@/modules/documents/service";
import { officialWhatsAppOrganisationId } from "./identity";
import { queueOfficialText } from "./outbound";
import { initialState, type AssistantState } from "./schemas";

/**
 * Platform administration from WhatsApp, for platform principals an operator linked with
 * `scripts/whatsapp-admin.ts` (which also sets their PIN). For anyone else "admin" means nothing.
 * Each action calls the same service as the web admin, with the same permissions and audit. A PIN
 * unlocks admin for 12 hours; 5 wrong PINs lock it for 30 minutes; every change is read back and
 * needs "confirm".
 */

type Reply = { state: AssistantState; reply: string; interactive?: WhatsAppInteractive; redactInbound?: boolean; replyMetadata?: Record<string, unknown> };
type Admin = { user: User; principal: PlatformPrincipal };
type Entity = "listing" | "professional" | "provider" | "conversation";
type Pending = NonNullable<NonNullable<AssistantState["admin"]>["pending"]>;

const UNLOCK_MS = 12 * 60 * 60_000;
const LOCK_MS = 30 * 60_000;
const MAX_PIN_FAILURES = 5;
const PREFIX: Record<Entity, string> = { listing: "L", professional: "P", provider: "S", conversation: "C" };
const TABLE: Record<Entity, string> = { listing: "Listing", professional: "MarketplaceProfessional", provider: "ServiceProvider", conversation: "Conversation" };
const ENTITY_OF: Record<string, Entity> = { L: "listing", P: "professional", S: "provider", C: "conversation" };

export const adminRef = (entity: Entity, id: string) => `${PREFIX[entity]}-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
const ago = (at: Date, now: Date) => { const hours = Math.round((now.getTime() - at.getTime()) / 3_600_000); return hours < 1 ? "just now" : hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`; };
const clip = (text: string | null | undefined, max: number) => { const value = (text ?? "").replace(/\s+/g, " ").trim(); return value.length > max ? `${value.slice(0, max - 1)}…` : value; };

/** The admin behind this linked account, or null (not a principal, inactive, or no WhatsApp PIN set). */
export async function whatsappAdmin(userId: string | undefined): Promise<Admin | null> {
  if (!userId) return null;
  const principal = await db.platformPrincipal.findUnique({ where: { userId }, include: { user: true } });
  if (!principal || principal.status !== "ACTIVE" || !principal.whatsappPinHash) return null;
  const { user, ...rest } = principal;
  return { user, principal: rest as PlatformPrincipal };
}

async function resolveRef(ref: string): Promise<{ entity: Entity; id: string } | null> {
  const match = /^([lpsc])-([0-9a-f]{6})$/i.exec(ref);
  if (!match) return null;
  const entity = ENTITY_OF[match[1].toUpperCase()];
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(`SELECT "id" FROM "${TABLE[entity]}" WHERE replace("id"::text, '-', '') LIKE $1 LIMIT 2`, `${match[2].toLowerCase()}%`);
  return rows.length === 1 ? { entity, id: rows[0].id } : null;
}

const menu = (state: AssistantState, lead = ""): Reply => {
  const body = `${lead}🛡️ *NesAfric admin*\nTap "Admin menu", or type a command:\n• admin queue — registrations and listings to review\n• admin support — customers waiting for a person\n• admin lock — lock admin now`;
  return { state, reply: body, interactive: { type: "list", body: body.slice(0, 1024), button: "Admin menu", sections: [{ title: "Admin", rows: [{ id: "admin queue", title: "Review queue", description: "Agents, companies, providers, listings" }, { id: "admin support", title: "Support inbox", description: "Customers waiting for a person" }, { id: "admin lock", title: "Lock admin" }] }] } };
};

const adminState = (state: AssistantState, admin: NonNullable<AssistantState["admin"]>): AssistantState => ({ ...state, workflow: "admin", admin });
const leave = (state: AssistantState): AssistantState => ({ ...initialState(), lastRequest: state.lastRequest });

export async function advanceAdmin(input: { phone: string; body: string; kind: string; messageId: string; state: AssistantState; linkedUserId?: string }, now = new Date()): Promise<Reply | null> {
  const command = input.body.trim().replace(/\s+/g, " ");
  const lower = command.toLowerCase();
  const inAdmin = input.state.workflow === "admin";
  if (!inAdmin && !/^admin(\s|$)/.test(lower)) return null;
  const admin = await whatsappAdmin(input.linkedUserId);
  // Not an admin (or no longer one): "admin" is not a command here, and a stale admin state is dropped.
  if (!admin) return inAdmin ? { state: leave(input.state), reply: "Reply menu to see what I can help with." } : null;
  const { principal } = admin;
  const state = input.state;
  const current = state.admin ?? { awaitingPin: false };

  if (principal.whatsappPinLockedUntil && principal.whatsappPinLockedUntil > now) {
    return { state: leave(state), reply: `Admin is locked until ${principal.whatsappPinLockedUntil.toISOString().slice(11, 16)} UTC after too many wrong PINs.`, redactInbound: current.awaitingPin };
  }

  if (current.awaitingPin) {
    if (lower === "cancel" || lower === "menu") return { state: leave(state), reply: "Admin cancelled.", redactInbound: true };
    if (!/^\d{6}$/.test(command)) return { state, reply: "Send your 6-digit admin PIN, or cancel.", redactInbound: true };
    const ok = await verifyPassword(principal.whatsappPinHash!, command).catch(() => false);
    if (!ok) {
      const failures = principal.whatsappPinFailures + 1;
      const locked = failures >= MAX_PIN_FAILURES;
      await db.platformPrincipal.update({ where: { id: principal.id }, data: { whatsappPinFailures: locked ? 0 : failures, ...(locked ? { whatsappPinLockedUntil: new Date(now.getTime() + LOCK_MS) } : {}) } });
      await recordPlatformAudit(principal, locked ? "platform_admin.whatsapp_admin_locked" : "platform_admin.whatsapp_pin_failed", "platform_principal", principal.id, undefined, { failures });
      return locked ? { state: leave(state), reply: "Too many wrong PINs. Admin is locked for 30 minutes.", redactInbound: true } : { state, reply: `Wrong PIN. ${MAX_PIN_FAILURES - failures} tries left.`, redactInbound: true };
    }
    await db.platformPrincipal.update({ where: { id: principal.id }, data: { whatsappPinFailures: 0, whatsappUnlockedUntil: new Date(now.getTime() + UNLOCK_MS) } });
    await recordPlatformAudit(principal, "platform_admin.whatsapp_admin_unlocked", "platform_principal", principal.id);
    const unlocked = adminState(state, { awaitingPin: false });
    const then = current.then && current.then.toLowerCase() !== "admin" ? await run(current.then, unlocked, admin, input, now) : menu(unlocked, "✅ Admin unlocked for 12 hours.\n\n");
    return { ...then, redactInbound: true };
  }

  if (lower === "admin lock") {
    await db.platformPrincipal.update({ where: { id: principal.id }, data: { whatsappUnlockedUntil: null } });
    await recordPlatformAudit(principal, "platform_admin.whatsapp_admin_locked_by_user", "platform_principal", principal.id);
    return { state: leave(state), reply: "🔒 Admin locked. Send admin and your PIN to unlock." };
  }
  if (!principal.whatsappUnlockedUntil || principal.whatsappUnlockedUntil <= now) {
    return { state: adminState(state, { awaitingPin: true, then: inAdmin && !/^admin(\s|$)/.test(lower) ? undefined : command }), reply: "🛡️ Enter your 6-digit admin PIN. NesAfric staff will never ask you for it." };
  }
  return run(command, adminState(state, current), admin, input, now);
}

/** One unlocked admin message: a confirmation, or a command. */
async function run(command: string, state: AssistantState, admin: Admin, input: { phone: string; messageId: string }, now: Date): Promise<Reply> {
  const lower = command.toLowerCase();
  const pending = state.admin?.pending;
  if (pending && lower === "confirm") return execute(pending, { ...state, admin: { awaitingPin: false } }, admin, input);
  if (pending && lower === "cancel") return menu({ ...state, admin: { awaitingPin: false } }, "Cancelled. Nothing was changed.\n\n");
  if (lower === "cancel" || lower === "exit" || lower === "menu" && !lower.startsWith("admin")) return { state: leave(state), reply: "Left admin. Reply admin to come back." };
  const [, verb = "", ref = "", ...words] = command.split(" ");
  const text = words.join(" ").trim();
  switch (verb.toLowerCase()) {
    case "":
    case "menu": return menu(state);
    case "queue": return queue(state, admin, now);
    case "view": return view(ref, state, admin);
    case "approve": case "changes": case "reject": return decide(verb.toLowerCase() as "approve" | "changes" | "reject", ref, text, state);
    case "support": return support(state, now);
    case "open": return open(ref, state);
    case "reply": case "done": return converse(verb.toLowerCase() as "reply" | "done", ref, text, state);
    default: return menu(state, `I don't know "admin ${verb}".\n\n`);
  }
}

async function queue(state: AssistantState, admin: Admin, now: Date): Promise<Reply> {
  const [platform, providers] = await Promise.all([getVerificationQueueForPlatform(admin.principal), listPendingProviderIdentityReviews(admin.user)]);
  const { listings, professionals } = platform;
  const items = [
    ...professionals.map((item) => ({ ref: adminRef("professional", item.id), title: item.displayName, kind: item.type === "INDIVIDUAL_AGENT" ? "Agent" : "Company", at: item.updatedAt ?? item.createdAt })),
    ...providers.map((item) => ({ ref: adminRef("provider", item.id), title: item.displayName, kind: "Service provider", at: item.updatedAt })),
    ...listings.map((item) => ({ ref: adminRef("listing", item.id), title: item.title, kind: "Listing", at: new Date(item.submittedAt ?? item.createdAt) })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  if (!items.length) return menu(state, "✅ Nothing is waiting for review.\n\n");
  const shown = items.slice(0, 10);
  const body = `📋 *Review queue*: ${items.length} waiting (oldest first)\n${shown.map((item) => `• ${item.ref} ${item.kind}: ${clip(item.title, 40)} (${ago(item.at, now)})`).join("\n")}\n\nTap one to open it, or type admin view <ref>.`;
  return { state, reply: body, interactive: { type: "list", body: body.slice(0, 1024), button: "Open an item", sections: [{ title: "Waiting for review", rows: shown.map((item) => ({ id: `admin view ${item.ref}`, title: `${item.ref} ${item.kind}`.slice(0, 24), description: clip(item.title, 72) })) }] } };
}

async function signedLinks(admin: Admin, storageObjectIds: Array<{ label: string; id: string }>) {
  const links: string[] = [];
  for (const document of storageObjectIds) {
    const access = await getSignedStorageAccess(admin.user.id, null, document.id).catch(() => null);
    links.push(`${document.label}: ${access?.url ?? "could not open"}`);
  }
  return links;
}

async function view(ref: string, state: AssistantState, admin: Admin): Promise<Reply> {
  const target = await resolveRef(ref);
  if (!target || target.entity === "conversation") return { state, reply: `I could not find ${ref.toUpperCase() || "that item"}. Reply admin queue for the list.` };
  const label = ref.toUpperCase();
  let lines: string[] = [];
  let links: string[] = [];
  if (target.entity === "professional") {
    const item = await db.marketplaceProfessional.findUniqueOrThrow({ where: { id: target.id }, include: { verificationDocuments: { include: { storageObject: { select: { id: true } } }, orderBy: { createdAt: "asc" } } } });
    lines = [`🏢 *${item.displayName}* (${label})`, `Type: ${item.type.replaceAll("_", " ").toLowerCase()}`, `Verification: ${item.verificationStatus.toLowerCase()} · Status: ${item.status.toLowerCase()}`, item.contactPhone ? `Phone: ${item.contactPhone}` : "", item.contactEmail ? `Email: ${item.contactEmail}` : "", item.serviceAreas.length ? `Areas: ${clip(item.serviceAreas.join(", "), 120)}` : "", item.description ? `About: ${clip(item.description, 200)}` : ""];
    links = await signedLinks(admin, item.verificationDocuments.map((document) => ({ label: document.type.replaceAll("_", " ").toLowerCase(), id: document.storageObject.id })));
  } else if (target.entity === "provider") {
    const item = await db.serviceProvider.findUniqueOrThrow({ where: { id: target.id } });
    lines = [`🛠️ *${item.displayName}* (${label})`, item.legalName ? `Legal name: ${item.legalName}` : "", `Verification: ${String(item.verificationStatus).toLowerCase()}`];
  } else {
    const item = await db.listing.findUniqueOrThrow({ where: { id: target.id }, include: { media: { where: { type: "PHOTO" }, orderBy: { sortOrder: "asc" }, take: 3 } } });
    lines = [`🏠 *${item.title}* (${label})`, `${item.listingType === "RENT" ? "For rent" : "For sale"} · ${item.category.toLowerCase()}`, `Status: ${item.status.toLowerCase()} · Verification: ${item.verificationStatus.toLowerCase()}`, [item.locality, item.city, item.region].filter(Boolean).join(", "), `Price: ${item.currencyCode} ${(Number(item.rentAmountMinor ?? item.askingAmountMinor ?? 0) / 100).toLocaleString("en-GB")}${item.frequency ? ` ${item.frequency.toLowerCase()}` : ""}`, clip(item.publicDescription, 200)];
    links = item.media.map((media, index) => `Photo ${index + 1}: ${media.publicUrl}`);
  }
  const body = [...lines.filter(Boolean), ...(links.length ? ["", "Documents and photos (links expire in 5 minutes):", ...links] : [])].join("\n");
  const buttons = [{ id: `admin approve ${label}`, title: "Approve" }, ...(target.entity !== "professional" ? [{ id: `admin changes ${label}`, title: target.entity === "listing" ? "Request changes" : "Ask for more info" }] : []), { id: `admin reject ${label}`, title: "Reject" }];
  const summary = lines.filter(Boolean).slice(0, 3).join("\n");
  return {
    state, reply: body,
    // The links are removed from the stored transcript as soon as the message is sent.
    replyMetadata: links.length ? { redactAfterSend: `${summary}\n(Document links were sent and removed from the transcript.)` } : undefined,
    interactive: body.length <= 1024 ? replyButtons(body, buttons) : undefined,
  };
}

async function decide(action: "approve" | "changes" | "reject", ref: string, note: string, state: AssistantState): Promise<Reply> {
  const target = await resolveRef(ref);
  const label = ref.toUpperCase();
  if (!target || target.entity === "conversation") return { state, reply: `I could not find ${label || "that item"}. Reply admin queue for the list.` };
  if (action === "changes" && target.entity === "professional") return { state, reply: `Agent and company registrations are approved or rejected. To ask for something, reply admin reject ${label} <what is missing>.` };
  if (action !== "approve" && note.length < 3) return { state, reply: `Add the reason after the reference, for example: admin ${action} ${label} The Ghana Card photo is unreadable.` };
  let name = "";
  let expectedUpdatedAt: string | undefined;
  let expectedStatus: string | undefined;
  if (target.entity === "listing") { const item = await db.listing.findUniqueOrThrow({ where: { id: target.id }, select: { title: true, updatedAt: true } }); name = item.title; expectedUpdatedAt = item.updatedAt.toISOString(); }
  if (target.entity === "professional") { const item = await db.marketplaceProfessional.findUniqueOrThrow({ where: { id: target.id }, select: { displayName: true, verificationStatus: true } }); name = item.displayName; expectedStatus = item.verificationStatus; }
  if (target.entity === "provider") name = (await db.serviceProvider.findUniqueOrThrow({ where: { id: target.id }, select: { displayName: true } })).displayName;
  const what = action === "approve" ? (target.entity === "listing" ? "verify and PUBLISH listing" : "APPROVE") : action === "changes" ? (target.entity === "listing" ? "send back for changes" : "ask for more information from") : "REJECT";
  const summary = `${what} ${name} (${label})${note ? `\nNote to them: ${clip(note, 300)}` : ""}`;
  const pending: Pending = { action, entity: target.entity, id: target.id, ref: label, summary, note: note || undefined, expectedUpdatedAt, expectedStatus };
  const body = `Please confirm: ${summary}\n\nThey will be told. Reply confirm, or cancel.`;
  return { state: { ...state, admin: { awaitingPin: false, pending } }, reply: body, interactive: replyButtons(body.slice(0, 1024), [{ id: "confirm", title: "Confirm" }, { id: "cancel", title: "Cancel" }]) };
}

async function support(state: AssistantState, now: Date): Promise<Reply> {
  const officialId = officialWhatsAppOrganisationId();
  const waiting = officialId ? await db.conversation.findMany({ where: { organisationId: officialId, channel: "WHATSAPP", status: { in: ["HUMAN_REQUIRED", "HUMAN_ACTIVE"] } }, orderBy: { lastInboundAt: "desc" }, take: 10, include: { participants: { take: 1, select: { displayName: true } }, messages: { where: { direction: "INBOUND" }, orderBy: { createdAt: "desc" }, take: 1, select: { body: true } } } }) : [];
  if (!waiting.length) return menu(state, "✅ No customer is waiting for a person.\n\n");
  const body = `💬 *Support inbox*: ${waiting.length} waiting\n${waiting.map((item) => `• ${adminRef("conversation", item.id)} ${clip(item.participants[0]?.displayName ?? "Customer", 24)} (+${item.channelAddress}) ${item.lastInboundAt ? ago(item.lastInboundAt, now) : ""}: "${clip(item.messages[0]?.body, 60)}"`).join("\n")}\n\nTap one to open it. Reply with: admin reply <ref> <message>. When finished: admin done <ref>.`;
  return { state, reply: body, interactive: { type: "list", body: body.slice(0, 1024), button: "Open a chat", sections: [{ title: "Waiting for a person", rows: waiting.map((item) => ({ id: `admin open ${adminRef("conversation", item.id)}`, title: `${adminRef("conversation", item.id)} ${clip(item.participants[0]?.displayName ?? "Customer", 14)}`.slice(0, 24), description: clip(item.messages[0]?.body, 72) || "No message" })) }] } };
}

async function open(ref: string, state: AssistantState): Promise<Reply> {
  const target = await resolveRef(ref);
  const label = ref.toUpperCase();
  if (!target || target.entity !== "conversation") return { state, reply: `I could not find chat ${label || ""}. Reply admin support for the list.` };
  const conversation = await db.conversation.findUniqueOrThrow({ where: { id: target.id }, include: { messages: { orderBy: { createdAt: "desc" }, take: 8, select: { direction: true, body: true, createdAt: true } } } });
  const transcript = conversation.messages.reverse().map((message) => `${message.direction === "INBOUND" ? "👤" : "🤖"} ${message.createdAt.toISOString().slice(5, 16).replace("T", " ")}: ${clip(message.body, 140)}`).join("\n");
  const body = `💬 Chat ${label} with +${conversation.channelAddress} (${conversation.status.toLowerCase().replace("_", " ")})\n${transcript}\n\nReply: admin reply ${label} <your message>. Finished: admin done ${label}.`;
  return { state, reply: body.slice(0, 4000) };
}

async function converse(action: "reply" | "done", ref: string, text: string, state: AssistantState): Promise<Reply> {
  const target = await resolveRef(ref);
  const label = ref.toUpperCase();
  if (!target || target.entity !== "conversation") return { state, reply: `I could not find chat ${label || ""}. Reply admin support for the list.` };
  if (action === "reply" && text.length < 1) return { state, reply: `Type your message after the reference: admin reply ${label} Hello, how can we help?` };
  const conversation = await db.conversation.findUniqueOrThrow({ where: { id: target.id }, select: { channelAddress: true } });
  const summary = action === "reply" ? `send to +${conversation.channelAddress} (${label}):\n"${clip(text, 600)}"` : `hand chat ${label} back to the assistant and tell the customer`;
  const pending: Pending = { action, entity: "conversation", id: target.id, ref: label, summary, note: action === "reply" ? text.slice(0, 2000) : undefined };
  const body = `Please confirm: ${summary}\n\nReply confirm, or cancel.`;
  return { state: { ...state, admin: { awaitingPin: false, pending } }, reply: body, interactive: replyButtons(body.slice(0, 1024), [{ id: "confirm", title: "Confirm" }, { id: "cancel", title: "Cancel" }]) };
}

/** Runs a confirmed change through the same services as the web admin. */
async function execute(pending: Pending, state: AssistantState, admin: Admin, input: { messageId: string }): Promise<Reply> {
  const done = (text: string) => menu(state, `✅ ${text}\n\n`);
  try {
    if (pending.entity === "listing") {
      const expectedUpdatedAt = pending.expectedUpdatedAt;
      if (pending.action === "approve") await verifyAndPublishListingForPlatform(admin.principal, pending.id, { expectedUpdatedAt, ...(pending.note ? { note: pending.note } : {}) });
      else if (pending.action === "changes") await requestListingChangesForPlatform(admin.principal, pending.id, { expectedUpdatedAt, note: pending.note });
      else await rejectListingForPlatform(admin.principal, pending.id, { expectedUpdatedAt, note: pending.note });
    } else if (pending.entity === "professional") {
      await reviewMarketplaceVerification(admin.user, pending.id, { status: pending.action === "approve" ? "VERIFIED" : "REJECTED", ...(pending.note ? { reason: pending.note } : {}), ...(pending.expectedStatus ? { expectedStatus: pending.expectedStatus } : {}) });
    } else if (pending.entity === "provider") {
      await reviewProviderIdentity(admin.user, pending.id, { status: pending.action === "approve" ? "VERIFIED" : pending.action === "changes" ? "REQUIRES_MORE_INFORMATION" : "REJECTED", ...(pending.note ? { reason: pending.note } : {}) });
    } else {
      const sent = await db.$transaction(async (tx) => {
        const conversation = await tx.conversation.findUniqueOrThrow({ where: { id: pending.id } });
        const text = pending.action === "reply" ? `${pending.note}\n\n— NesAfric team` : "Thank you for contacting NesAfric. You're back with the NesAfric assistant; reply menu any time.";
        const result = await queueOfficialText(tx, { phoneE164: `+${conversation.channelAddress}`, displayName: "Customer", text, externalMessageId: `admin-${pending.action}:${input.messageId}`, metadata: { sentByPlatformPrincipalId: admin.principal.id } });
        if (result.messageId === null) return result;
        await tx.conversation.update({ where: { id: conversation.id }, data: { status: pending.action === "reply" ? "HUMAN_ACTIVE" : "AI_ACTIVE" } });
        return result;
      });
      await recordPlatformAudit(admin.principal, pending.action === "reply" ? "platform_admin.whatsapp_support_replied" : "platform_admin.whatsapp_support_closed", "conversation", pending.id, officialWhatsAppOrganisationId() ?? undefined, { via: "WHATSAPP" });
      if (sent.messageId === null) return menu(state, `Not sent: ${sent.reason}\n\n`);
      return done(pending.action === "reply" ? `Sent to the customer in ${pending.ref}. The assistant stays quiet in that chat until you reply admin done ${pending.ref}.` : `${pending.ref} is back with the assistant.`);
    }
    await recordPlatformAudit(admin.principal, `platform_admin.whatsapp_${pending.action}`, pending.entity, pending.id, undefined, { via: "WHATSAPP", ref: pending.ref });
    return done(`Done: ${pending.summary.split("\n")[0]}.`);
  } catch (error) {
    if (error instanceof AppError && error.status < 500) return menu(state, `Not changed: ${error.message}\n\n`);
    throw error;
  }
}

/**
 * Tells WhatsApp admins that a customer asked for a person, or wrote into a chat a person is
 * handling. Best effort: free text inside an admin's 24-hour window, otherwise nothing (the
 * inbox, `admin support`, still lists it). One alert per customer message and admin.
 */
export async function alertAdminsAboutSupport(conversationId: string, messageId: string) {
  const admins = await db.platformPrincipal.findMany({ where: { status: "ACTIVE", whatsappPinHash: { not: null } }, select: { userId: true } });
  if (!admins.length) return;
  const identities = await db.channelIdentity.findMany({ where: { channel: "WHATSAPP", userId: { in: admins.map((admin) => admin.userId) }, verifiedAt: { not: null } }, select: { address: true } });
  const conversation = await db.conversation.findUnique({ where: { id: conversationId }, include: { participants: { take: 1, select: { displayName: true } } } });
  const message = await db.message.findUnique({ where: { id: messageId }, select: { body: true } });
  if (!conversation?.channelAddress || !message) return;
  const ref = adminRef("conversation", conversation.id);
  const text = `💬 Support: ${clip(conversation.participants[0]?.displayName ?? "A customer", 40)} (+${conversation.channelAddress}) in ${ref}:\n"${clip(message.body, 300)}"\n\nReply admin open ${ref} to see the chat, or admin reply ${ref} <message>.`;
  for (const { address } of identities) {
    if (address === `+${conversation.channelAddress}`) continue;
    await db.$transaction((tx) => queueOfficialText(tx, { phoneE164: address, displayName: "NesAfric admin", text, externalMessageId: `admin-alert:${messageId}:${address}`, fallback: async () => ({ messageId: null, reason: "No open conversation with this admin." }) }));
  }
}
