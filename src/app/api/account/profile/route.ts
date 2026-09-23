import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/platform/auth/session";
import { db } from "@/platform/database/client";
import { errorResponse } from "@/platform/errors";

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
});

export async function GET() {
  try {
    const user = await requireUser();

    return NextResponse.json({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      emailVerified: Boolean(user.emailVerifiedAt),
      createdAt: user.createdAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const data = updateProfileSchema.parse(await request.json());

    const updated = await db.user.update({
      where: { id: user.id },
      data: { displayName: data.displayName },
      select: {
        id: true,
        displayName: true,
        email: true,
        emailVerifiedAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      id: updated.id,
      displayName: updated.displayName,
      email: updated.email,
      emailVerified: Boolean(updated.emailVerifiedAt),
      createdAt: updated.createdAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
