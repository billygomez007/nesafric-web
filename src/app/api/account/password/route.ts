import { NextResponse } from "next/server";
import { z } from "zod";

import { accountState, withAccountUnchanged } from "@/platform/auth/account-lock";
import { hashPassword, verifyPassword } from "@/platform/auth/passwords";
import { currentSessionTokenHash, newSessionData, requireUser, setSessionCookie } from "@/platform/auth/session";
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

    // Checking and hashing passwords takes a moment. The change commits only under the account
    // lock, if the account is exactly as authenticated and this request's session still exists —
    // e.g. not after the real owner proved a squatted email (see account-lock.ts).
    await withAccountUnchanged(user.id, accountState(user), { sessionTokenHash, stale: unauthenticated }, async (tx) => {
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
