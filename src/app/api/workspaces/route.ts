import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { listUserWorkspaces } from "@/modules/marketplace-professionals/service";

/** Dual-workspace readiness (item 7): every PropertyOS management organisation and every
 * Marketplace professional profile this signed-in user identity can act within, as two
 * clearly separate collections. */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await listUserWorkspaces(user.id));
  } catch (error) {
    return errorResponse(error);
  }
}
