import { db } from "@/platform/database/client";
import { Prisma } from "@/platform/database/generated/client";
import { AppError } from "@/platform/errors";
import { hashPassword } from "@/platform/auth/passwords";
import { loginSchema, registerSchema } from "./schemas";
import { verifyPassword } from "@/platform/auth/passwords";
import { enqueueWelcomeEmail } from "@/modules/account-emails/service";

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

function googleDisplayName(value: unknown, email: string) {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return email.split("@")[0] || "NesAfric user";
}

/**
 * The one rule for signing in with a verified Google identity, used by the web and mobile flows:
 * the same (case-insensitive) email always resolves to the same `User` row, whether it was created
 * with a password, a code or Google. A new person gets exactly one row, with no password; an
 * existing unverified email is marked verified, because Google has just verified it.
 */
export async function findOrCreateGoogleUser(identity: { email: string; name?: unknown }) {
  const email = identity.email.trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return existing.emailVerifiedAt
      ? existing
      : db.user.update({ where: { id: existing.id }, data: { emailVerifiedAt: new Date() } });
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
