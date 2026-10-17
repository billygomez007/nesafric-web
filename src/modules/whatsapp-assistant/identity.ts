import { requestOtp, verifyOtp } from "@/modules/identity/otp";
import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { normalizePhone } from "@/platform/identity/phone";
import type { ContactRow } from "./store";

/**
 * Links a WhatsApp contact to a NesAfric `User` only after the person proves control of the
 * number with the same SMS one-time code the website's sign-in uses (`requestOtp`/`verifyOtp`,
 * with its rate limits and attempt limits). Neither the sender's WhatsApp id nor any number typed
 * in a message is ever enough on its own:
 * - an existing account whose verified phone is this number is linked only after the code;
 * - otherwise a new account is created by `verifyOtp` with the number verified by that code,
 *   preserving the invariant that `User.phoneE164` is set only once verified by SMS.
 *
 * Accounts with platform-administration access are never linked: staff use the website. A link
 * grants nothing else by itself — every marketplace, provider and organisation action still goes
 * through the domain services' own permission checks.
 */

/** Thrown by a workflow step that needs an account the contact hasn't verified yet. */
export class AccountVerificationRequired extends Error {
  constructor(readonly displayName: string) {
    super("Account verification is required.");
    this.name = "AccountVerificationRequired";
  }
}

export function contactPhone(contact: Pick<ContactRow, "phoneE164" | "waId">) {
  return contact.phoneE164 ?? normalizePhone(`+${contact.waId}`);
}

/** The account this contact has verified, if any. Never inferred from a phone-number match. */
export async function linkedUser(contact: ContactRow) {
  if (!contact.userId) return null;
  return db.user.findUnique({ where: { id: contact.userId } });
}

/** The verified account for this contact, or `AccountVerificationRequired` so the engine can ask for the code. */
export async function ensureUserForContact(contact: ContactRow, displayName: string) {
  const user = await linkedUser(contact);
  if (user) return { user };
  throw new AccountVerificationRequired(displayName.trim() || contact.profileName?.trim() || "NesAfric user");
}

/** Sends the SMS code to the WhatsApp number. Rate limits and provider availability are the website's. */
export async function startAccountVerification(contact: ContactRow) {
  const phone = contactPhone(contact);
  if (!phone) throw new AppError("WHATSAPP_PHONE_UNSUPPORTED", 422, "This WhatsApp number can't be used for a NesAfric account.");
  return requestOtp({ mode: "register", channel: "sms", identifier: phone });
}

/** Checks the code and links the contact to the (existing or newly created) account it proves. */
export async function completeAccountVerification(contact: ContactRow, input: { challengeId: string; code: string; displayName: string }) {
  const phone = contactPhone(contact);
  if (!phone) throw new AppError("WHATSAPP_PHONE_UNSUPPORTED", 422, "This WhatsApp number can't be used for a NesAfric account.");
  const { user, created } = await verifyOtp({
    challengeId: input.challengeId,
    channel: "sms",
    identifier: phone,
    code: input.code,
    displayName: input.displayName.slice(0, 100).padEnd(2, "."),
  });
  const principal = await db.platformPrincipal.findUnique({ where: { userId: user.id }, select: { status: true } });
  if (principal) {
    throw new AppError("WHATSAPP_STAFF_ACCOUNT", 403, "This number belongs to a NesAfric staff account, which can't be used on WhatsApp. Please use the website.");
  }
  await db.whatsAppContact.update({ where: { id: contact.id }, data: { userId: user.id } });
  contact.userId = user.id;
  return { user, created };
}

/** Whether a NesAfric account already uses this number (used only to word an invitation to link it). */
export async function accountExistsForContact(contact: ContactRow) {
  const phone = contactPhone(contact);
  return phone ? Boolean(await db.user.findUnique({ where: { phoneE164: phone }, select: { id: true } })) : false;
}
