import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getOptionalPlatformPrincipal } from "@/platform/platform-admin/auth";

/** Lets the platform-admin UI shell know whether the signed-in user has any platform access at
 * all, and with which role, without exposing anything about other principals. */
export async function GET() {
  try {
    const user = await requireUser();
    const principal = await getOptionalPlatformPrincipal(user);
    if (!principal || principal.status !== "ACTIVE") return NextResponse.json({ isPlatformPrincipal: false });
    return NextResponse.json({ isPlatformPrincipal: true, role: principal.role });
  } catch (error) {
    return errorResponse(error);
  }
}
