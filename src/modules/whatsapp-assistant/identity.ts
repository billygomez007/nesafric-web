import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { normalizePhone } from "@/platform/identity/phone";
import type { ContactRow } from "./store";

/**
 * Links a WhatsApp contact to a NesAfric `User`, only when a workflow genuinely needs an account
 * (registering a business, listing a property, requesting a service quote).
 *
 * A message that arrives on Meta's signature-verified webhook from `wa_id` proves the sender
 * controls that phone number — the same proof the website's SMS one-time code gives. So:
 * - an existing account whose verified phone is this number is linked to the contact;
 * - otherwise a new account is created with this number as its verified phone.
 *
 * The link never grants anything by itself: organisation, marketplace-team and provider
 * permissions are still checked by every domain service, and platform-administration access exists
 * only through `PlatformPrincipal`, which nothing here reads or writes.
 */
export async function linkedUser(contact: ContactRow) {
  if (!contact.userId) return null;
  return db.user.findUnique({ where: { id: contact.userId } });
}

export async function findUserForContact(contact: ContactRow) {
  const linked = await linkedUser(contact);
  if (linked) return linked;
  const phone = contact.phoneE164 ?? normalizePhone(`+${contact.waId}`);
  if (!phone) return null;
  const existing = await db.user.findUnique({ where: { phoneE164: phone } });
  if (!existing) return null;
  await db.whatsAppContact.update({ where: { id: contact.id }, data: { userId: existing.id } });
  contact.userId = existing.id;
  return existing;
}

export async function ensureUserForContact(contact: ContactRow, displayName: string) {
  const found = await findUserForContact(contact);
  if (found) return { user: found, created: false };
  const phone = contact.phoneE164 ?? normalizePhone(`+${contact.waId}`);
  if (!phone) throw new AppError("WHATSAPP_PHONE_UNSUPPORTED", 422, "This WhatsApp number cannot be used to create a NesAfric account.");
  const name = displayName.trim().slice(0, 160) || contact.profileName?.trim() || "NesAfric user";
  let user;
  try {
    user = await db.user.create({ data: { phoneE164: phone, phoneVerifiedAt: new Date(), displayName: name } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    user = await db.user.findUniqueOrThrow({ where: { phoneE164: phone } });
  }
  await db.whatsAppContact.update({ where: { id: contact.id }, data: { userId: user.id } });
  contact.userId = user.id;
  return { user, created: true };
}
