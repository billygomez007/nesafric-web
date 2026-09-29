import { NextResponse } from "next/server";

import { verifyOtpLink } from "@/modules/identity/otp";
import { publicUser } from "@/modules/identity/service";
import { accountState } from "@/platform/auth/account-lock";
import { currentSessionTokenHash, requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

/**
 * Adds a verified email or phone to the signed-in account, after a `mode: "link"` code from
 * `POST /api/auth/otp/request`. An address owned by another account is refused, never merged.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    // Bound to the state this request authenticated with; an email change signs out other
    // sessions in the same transaction (see verifyOtpLink and account-lock.ts).
    const updated = await verifyOtpLink(
      { userId: user.id, account: accountState(user), sessionTokenHash: await currentSessionTokenHash() },
      await request.json().catch(() => null),
    );
    return NextResponse.json(publicUser(updated), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
