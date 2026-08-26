import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { getCommercialAnalytics } from "@/modules/platform-admin/analytics";

/** Deterministic commercial analytics (item 11): no fabricated revenue — every figure is a direct
 * aggregate over persisted subscription/plan/invoice rows. */
export async function GET() {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await getCommercialAnalytics(principal));
  } catch (error) {
    return errorResponse(error);
  }
}
