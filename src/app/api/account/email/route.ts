import { NextResponse } from "next/server";
import { z } from "zod";

import { requestOtp } from "@/modules/identity/otp";
import { verifyPassword } from "@/platform/auth/passwords";
import { requireUser } from "@/platform/auth/session";
import { AppError, errorResponse } from "@/platform/errors";

const changeEmailSchema = z.object({
  email: z.string().trim().email().max(254),
  currentPassword: z.string().min(1).max(128),
});

/**
 * Step 1 of changing a password account's email. The account's email is NOT changed here: a new
 * address only becomes the account's email once its owner proves it (security batch 1). After the
 * current password checks out, a one-time code goes to the NEW address — with the one-time-code
 * service's own expiry, attempt and send limits — and step 2 is the same verified link every
 * account uses: `POST /api/account/identifiers/verify` with that code.
 *
 * The answer is the same whether or not the new address already has an account; that is only said
 * once the code proves the caller controls it (`IDENTIFIER_IN_USE` at step 2).
 */
export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const data = changeEmailSchema.parse(await request.json());

    // Accounts without a password (code or Google sign-in) go straight to the one-time code:
    // `POST /api/auth/otp/request` (mode "link") then `POST /api/account/identifiers/verify`.
    if (!user.passwordHash) {
      throw new AppError(
        "PASSWORD_NOT_SET",
        400,
        "This account signs in without a password. Verify the new email with a one-time code instead.",
      );
    }

    if (!(await verifyPassword(user.passwordHash, data.currentPassword))) {
      throw new AppError("INVALID_CURRENT_PASSWORD", 401, "Your current password is incorrect.");
    }

    const challenge = await requestOtp(
      { mode: "link", channel: "email", identifier: data.email },
      { headers: request.headers, userId: user.id },
    );
    return NextResponse.json(challenge, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
