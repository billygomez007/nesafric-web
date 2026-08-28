import { NextResponse } from "next/server";
import { listPendingProviderIdentityReviews } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

/** Platform identity-verification queue — providers awaiting or previously flagged for review. */
export async function GET() {
  try {
    return NextResponse.json(await listPendingProviderIdentityReviews(await requireUser()));
  } catch (error) {
    return errorResponse(error);
  }
}
