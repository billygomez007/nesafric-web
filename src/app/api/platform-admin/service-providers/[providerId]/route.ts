import { NextResponse } from "next/server";
import { getProviderIdentityReviewDetail } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

export async function GET(_request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    return NextResponse.json(await getProviderIdentityReviewDetail(await requireUser(), (await params).providerId));
  } catch (error) {
    return errorResponse(error);
  }
}
