import { db } from "@/platform/database/client";
import { Prisma } from "@/platform/database/generated/client";
import { AppError } from "@/platform/errors";
import { hashPassword } from "@/platform/auth/passwords";
import { loginSchema, registerSchema } from "./schemas";
import { verifyPassword } from "@/platform/auth/passwords";
import { enqueueWelcomeEmail } from "@/modules/account-emails/service";

/**
 * Creates a password account with an UNVERIFIED email. No HTTP route reaches this any more
 * (`POST /api/auth/register` is retired); it remains for tests and scripts that need a password
 * account fixture. Accounts are created through a one-time code or Google, which prove the address.
 */
export async function registerUser(input: unknown) {
  const data = registerSchema.parse(input);
  const email = data.email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) throw new AppError("EMAIL_EXISTS", 409, "An account with this email already exists.");
  const user = await db.user.create({ data: { email, displayName: data.displayName, passwordHash: await hashPassword(data.password) } });
  await enqueueWelcomeEmail(user.id);
  return user;
}

/**
 * Legacy email + password check, kept for existing clients (`POST /api/auth/login`,
 * `POST /api/auth/mobile/session`). Accounts created with a code or with Google have no password
 * and get the same generic answer as a wrong password.
 */
export async function authenticateUser(input: unknown) {
  const data = loginSchema.parse(input);
  const user = await db.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, data.password))) {
    throw new AppError("INVALID_CREDENTIALS", 401, "Email or password is incorrect.");
  }
  return user;
}

/**
 * SECURITY INVARIANT (H-1): someone who never proved control of an email address keeps nothing once
 * its real owner proves it. Until an account's email is verified, whoever holds it only *claimed*
 * the address — the legacy password registration and email change let anyone do that. So the first
 * trusted proof (an email code, or Google) hands the owner a clean account:
 *
 * - the password set by the claimant is cleared (the owner signs in with the code or Google, and
 *   can keep doing so);
 * - every session issued before the proof is deleted — web cookies and app tokens alike;
 * - a phone number linked before the proof is detached, since the claimant could have linked their
 *   own phone as a way back in (phones are only ever linked verified, so this is the only way an
 *   unverified-email account can carry one).
 *
 * The flip is one conditional update (`emailVerifiedAt IS NULL`), so of concurrent proofs exactly
 * one revokes; the rest see an already-verified account and leave it alone. The caller issues the
 * owner's new session after this returns, so it is never caught by the revocation. An account whose
 * email is already verified is returned untouched: signing in again never costs a real owner their
 * password or other devices. Organisations, workspaces and data stay on the same row.
 */
export async function claimEmailOnFirstProof(userId: string, now = new Date()) {
  return db.$transaction(async (tx) => {
    const claimed = await tx.user.updateMany({
      where: { id: userId, emailVerifiedAt: null },
      data: { emailVerifiedAt: now, passwordHash: null, phoneE164: null, phoneVerifiedAt: null },
    });
    if (claimed.count === 1) await tx.session.deleteMany({ where: { userId } });
    return tx.user.findUniqueOrThrow({ where: { id: userId } });
  });
}

function googleDisplayName(value: unknown, email: string) {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return email.split("@")[0] || "NesAfric user";
}

/**
 * The one rule for signing in with a verified Google identity, used by the web and mobile flows:
 * the same (case-insensitive) email always resolves to the same `User` row, whether it was created
 * with a password, a code or Google. A new person gets exactly one row, with no password. An
 * existing unverified email is Google's proof of ownership: see `claimEmailOnFirstProof`.
 */
export async function findOrCreateGoogleUser(identity: { email: string; name?: unknown }) {
  const email = identity.email.trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return existing.emailVerifiedAt ? existing : claimEmailOnFirstProof(existing.id);
  }
  try {
    return await db.user.create({
      data: {
        email,
        displayName: googleDisplayName(identity.name, email),
        emailVerifiedAt: new Date(),
      },
    });
  } catch (error) {
    // A concurrent sign-in for the same new email created the row first: use that one.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const user = await db.user.findUnique({ where: { email } });
      if (user) return user;
    }
    throw error;
  }
}

/** The account fields safe to return to the account holder. Never the password hash. */
export function publicUser(user: { id: string; email: string | null; phoneE164: string | null; displayName: string }) {
  return { id: user.id, email: user.email, phone: user.phoneE164, displayName: user.displayName };
}
