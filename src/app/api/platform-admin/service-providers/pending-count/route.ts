import { NextResponse } from "next/server";
import { countPendingProviderIdentityReviews } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

export async function GET() {
  try {
    return NextResponse.json({ count: await countPendingProviderIdentityReviews(await requireUser()) });
  } catch (error) {
    return errorResponse(error);
  }
}
