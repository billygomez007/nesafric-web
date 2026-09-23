import { NextResponse } from "next/server";
import { z } from "zod";

import { hashPassword, verifyPassword } from "@/platform/auth/passwords";
import { createSession, requireUser } from "@/platform/auth/session";
import { db } from "@/platform/database/client";
import { AppError, errorResponse } from "@/platform/errors";

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
    const data = changePasswordSchema.parse(await request.json());

    const passwordValid = await verifyPassword(user.passwordHash, data.currentPassword);
    if (!passwordValid) {
      throw new AppError("INVALID_CURRENT_PASSWORD", 401, "Your current password is incorrect.");
    }

    const passwordHash = await hashPassword(data.newPassword);

    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      db.session.deleteMany({
        where: { userId: user.id },
      }),
    ]);

    await createSession(user.id);

    return NextResponse.json({ changed: true });
  } catch (error) {
    return errorResponse(error);
  }
}
