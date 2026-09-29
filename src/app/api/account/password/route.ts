import { NextResponse } from "next/server";
import { z } from "zod";

import { hashPassword, verifyPassword } from "@/platform/auth/passwords";
import { currentSessionTokenHash, newSessionData, requireUser, setSessionCookie } from "@/platform/auth/session";
import { db } from "@/platform/database/client";
import { AppError, errorResponse, unauthenticated } from "@/platform/errors";

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(12).max(128),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    path: ["newPassword"],
    message: "Choose a new password that is different from your current password.",
  });

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const sessionTokenHash = await currentSessionTokenHash();
    const data = changePasswordSchema.parse(await request.json());

    if (!user.passwordHash) {
      throw new AppError("PASSWORD_NOT_SET", 400, "This account signs in with a one-time code or Google and has no password to change.");
    }
    const passwordValid = await verifyPassword(user.passwordHash, data.currentPassword);
    if (!passwordValid) {
      throw new AppError("INVALID_CURRENT_PASSWORD", 401, "Your current password is incorrect.");
    }

    const passwordHash = await hashPassword(data.newPassword);
    const next = newSessionData(user.id);

    // Checking and hashing passwords takes a moment. If, meanwhile, the address's real owner proved
    // the email (`claimEmailOnFirstProof`: password cleared, sessions revoked), this request is
    // stale and must change nothing. So the whole change happens under a lock on the user row, and
    // only if the row is still exactly as it was authenticated: same password hash, same
    // verification state, and this request's own session still alive. Whichever of the two
    // transactions commits second sees the other's result (see also PasswordSessionGuard).
    await db.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ passwordHash: string | null; emailVerifiedAt: Date | null }>>`
        SELECT "passwordHash", "emailVerifiedAt" FROM "User" WHERE id = ${user.id}::uuid FOR UPDATE`;
      const unchanged =
        row
        && row.passwordHash === user.passwordHash
        && (row.emailVerifiedAt?.getTime() ?? null) === (user.emailVerifiedAt?.getTime() ?? null);
      const sessionAlive = sessionTokenHash
        ? (await tx.session.count({ where: { userId: user.id, tokenHash: sessionTokenHash, expiresAt: { gt: new Date() } } })) === 1
        : false;
      if (!unchanged || !sessionAlive) throw unauthenticated();

      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.session.create({ data: next.data });
    });

    await setSessionCookie(next.token);

    return NextResponse.json({ changed: true });
  } catch (error) {
    return errorResponse(error);
  }
}
