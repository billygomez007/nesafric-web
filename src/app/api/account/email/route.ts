import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyPassword } from "@/platform/auth/passwords";
import { requireUser } from "@/platform/auth/session";
import { db } from "@/platform/database/client";
import { AppError, errorResponse } from "@/platform/errors";

const changeEmailSchema = z.object({
  email: z.string().trim().email().max(254),
  currentPassword: z.string().min(1).max(128),
});

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const data = changeEmailSchema.parse(await request.json());

    // Accounts without a password (code or Google sign-in) add or change their email by proving
    // ownership of the new address instead: `POST /api/auth/otp/request` (mode "link") then
    // `POST /api/account/identifiers/verify`.
    if (!user.passwordHash) {
      throw new AppError(
        "PASSWORD_NOT_SET",
        400,
        "This account signs in without a password. Verify the new email with a one-time code instead.",
      );
    }

    const passwordValid = await verifyPassword(
      user.passwordHash,
      data.currentPassword,
    );

    if (!passwordValid) {
      throw new AppError(
        "INVALID_CURRENT_PASSWORD",
        401,
        "Your current password is incorrect.",
      );
    }

    const email = data.email.toLowerCase();

    const existing = await db.user.findUnique({ where: { email } });
    if (existing && existing.id !== user.id) {
      throw new AppError(
        "EMAIL_EXISTS",
        409,
        "An account with this email already exists.",
      );
    }

    const emailChanged = email !== user.email?.toLowerCase();

    const updated = await db.user.update({
      where: { id: user.id },
      data: {
        email,
        ...(emailChanged ? { emailVerifiedAt: null } : {}),
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        emailVerifiedAt: true,
      },
    });

    return NextResponse.json({
      id: updated.id,
      email: updated.email,
      displayName: updated.displayName,
      emailVerified: Boolean(updated.emailVerifiedAt),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
