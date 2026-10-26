import { createHash } from "node:crypto";
import { db } from "@/platform/database/client";
import type { ChannelIdentityVerification, Prisma } from "@/platform/database/generated/client";

type Client = Prisma.TransactionClient | typeof db;

/** One conversation per receiving number and sender, shared by inbound messages and anything NesAfric sends first. */
export const whatsappSessionKey = (organisationId: string, phoneNumberId: string, waId: string) => createHash("sha256").update(`${organisationId}:${phoneNumberId}:${waId.replace(/^\+/, "")}`).digest("hex");

/** WhatsApp sends `wa_id` without "+". Identity rows always store E.164 with it. */
export const whatsappAddress = (waId: string) => `+${waId.replace(/^\+/, "")}`;

/** The organisation whose WhatsApp channel is the official NesAfric number, when configured. */
export function officialWhatsAppOrganisationId(env: Record<string, string | undefined> = process.env) {
  const value = env.WHATSAPP_OFFICIAL_ORGANISATION_ID?.trim();
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

export const isOfficialWhatsAppOrganisation = (organisationId: string) => officialWhatsAppOrganisationId() === organisationId;

/** Notes that someone messaged from this number. Never links it to an account. */
export async function recordInboundIdentity(client: Client, waId: string, at: Date) {
  const address = whatsappAddress(waId);
  return client.channelIdentity.upsert({
    where: { channel_address: { channel: "WHATSAPP", address } },
    update: { lastInboundAt: at },
    create: { channel: "WHATSAPP", address, lastInboundAt: at },
  });
}

/** The verified account behind a WhatsApp number, or null. An unverified row grants nothing. */
export async function linkedWhatsAppUser(waId: string, client: Client = db) {
  const identity = await client.channelIdentity.findUnique({
    where: { channel_address: { channel: "WHATSAPP", address: whatsappAddress(waId) } },
    include: { user: { select: { id: true, displayName: true } } },
  });
  if (!identity?.userId || !identity.verifiedAt || !identity.user) return null;
  return { identityId: identity.id, user: identity.user };
}

/**
 * Links a number to the account that just proved possession of a code. Relinking to a different
 * account replaces the link; both the old and the new account are recorded in the audit trail.
 */
export async function linkWhatsAppIdentity(waId: string, userId: string, method: ChannelIdentityVerification, organisationId: string) {
  const address = whatsappAddress(waId);
  return db.$transaction(async (tx) => {
    const before = await tx.channelIdentity.findUnique({ where: { channel_address: { channel: "WHATSAPP", address } } });
    if (before?.userId && before.userId !== userId) await tx.onboardingDraft.updateMany({ where: { channel: "WHATSAPP", address, status: "IN_PROGRESS", userId: before.userId }, data: { status: "ABANDONED" } });
    const identity = await tx.channelIdentity.upsert({
      where: { channel_address: { channel: "WHATSAPP", address } },
      update: { userId, verifiedAt: new Date(), verificationMethod: method },
      create: { channel: "WHATSAPP", address, userId, verifiedAt: new Date(), verificationMethod: method },
    });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "channel_identity.linked", entityType: "channel_identity", entityId: identity.id, metadata: { channel: "WHATSAPP", method, previousUserId: before?.userId && before.userId !== userId ? before.userId : null } } });
    return identity;
  });
}

/**
 * Creates a NesAfric account for the person writing from this WhatsApp number and links the number
 * to it. Meta attests the sender, so the number is proven as an SMS code to it would prove it. Only
 * for a number no account uses yet: an existing account is never taken over this way (it is linked
 * with a code instead, `link`).
 */
export async function createWhatsAppAccount(waId: string, displayName: string, organisationId: string): Promise<{ created: true; user: { id: string; displayName: string } } | { created: false; reason: "NUMBER_IN_USE" }> {
  const address = whatsappAddress(waId);
  try {
    return await db.$transaction(async (tx) => {
      if (await tx.user.findFirst({ where: { phoneE164: address }, select: { id: true } })) return { created: false as const, reason: "NUMBER_IN_USE" as const };
      const now = new Date();
      const user = await tx.user.create({ data: { phoneE164: address, phoneVerifiedAt: now, displayName }, select: { id: true, displayName: true } });
      const identity = await tx.channelIdentity.upsert({
        where: { channel_address: { channel: "WHATSAPP", address } },
        update: { userId: user.id, verifiedAt: now, verificationMethod: "WHATSAPP_REPLY" },
        create: { channel: "WHATSAPP", address, userId: user.id, verifiedAt: now, verificationMethod: "WHATSAPP_REPLY" },
      });
      await tx.auditEvent.create({ data: { organisationId, actorUserId: user.id, action: "account.created_on_whatsapp", entityType: "user", entityId: user.id, metadata: { channel: "WHATSAPP" } } });
      await tx.auditEvent.create({ data: { organisationId, actorUserId: user.id, action: "channel_identity.linked", entityType: "channel_identity", entityId: identity.id, metadata: { channel: "WHATSAPP", method: "WHATSAPP_REPLY", previousUserId: null } } });
      return { created: true as const, user };
    });
  } catch (error) {
    // Another request created an account for this number at the same moment.
    if ((error as { code?: string })?.code === "P2002") return { created: false, reason: "NUMBER_IN_USE" };
    throw error;
  }
}

export async function unlinkWhatsAppIdentity(waId: string, organisationId: string) {
  const address = whatsappAddress(waId);
  return db.$transaction(async (tx) => {
    const identity = await tx.channelIdentity.findUnique({ where: { channel_address: { channel: "WHATSAPP", address } } });
    if (!identity?.userId) return false;
    await tx.channelIdentity.update({ where: { id: identity.id }, data: { userId: null, verifiedAt: null, verificationMethod: null } });
    // An unfinished onboarding belongs to the account that started it, not to whoever holds the number next.
    await tx.onboardingDraft.updateMany({ where: { channel: "WHATSAPP", address, status: "IN_PROGRESS" }, data: { status: "ABANDONED" } });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: identity.userId, action: "channel_identity.unlinked", entityType: "channel_identity", entityId: identity.id, metadata: { channel: "WHATSAPP" } } });
    return true;
  });
}

/** STOP / START. Opt-out blocks outbound notifications; it never deletes the identity or link. */
export async function setWhatsAppOptOut(client: Client, waId: string, optedOut: boolean) {
  const address = whatsappAddress(waId);
  await client.channelIdentity.upsert({
    where: { channel_address: { channel: "WHATSAPP", address } },
    update: { optedOutAt: optedOut ? new Date() : null },
    create: { channel: "WHATSAPP", address, optedOutAt: optedOut ? new Date() : null },
  });
}

export async function isWhatsAppOptedOut(address: string, client: Client = db) {
  const identity = await client.channelIdentity.findUnique({ where: { channel_address: { channel: "WHATSAPP", address: whatsappAddress(address) } }, select: { optedOutAt: true } });
  return Boolean(identity?.optedOutAt);
}
