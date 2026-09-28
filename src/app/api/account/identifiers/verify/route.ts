import { NextResponse } from "next/server";

import { verifyOtpLink } from "@/modules/identity/otp";
import { publicUser } from "@/modules/identity/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

/**
 * Adds a verified email or phone to the signed-in account, after a `mode: "link"` code from
 * `POST /api/auth/otp/request`. An address owned by another account is refused, never merged.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const updated = await verifyOtpLink(user.id, await request.json().catch(() => null));
    return NextResponse.json(publicUser(updated), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
