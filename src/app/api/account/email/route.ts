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

    const passwordValid = await verifyPassword(user.passwordHash, data.currentPassword);
    if (!passwordValid) {
      throw new AppError("INVALID_CURRENT_PASSWORD", 401, "Your current password is incorrect.");
    }

    const email = data.email.toLowerCase();

    const existing = await db.user.findUnique({ where: { email } });
    if (existing && existing.id !== user.id) {
      throw new AppError("EMAIL_EXISTS", 409, "An account with this email already exists.");
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data: { email },
      select: { id: true, email: true, displayName: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    return errorResponse(error);
  }
}
