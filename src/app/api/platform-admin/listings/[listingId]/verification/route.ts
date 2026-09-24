import { NextResponse } from "next/server";
import { reviewListingVerificationForPlatform } from "@/modules/platform-admin/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ listingId: string }> },
) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const { listingId } = await params;

    return NextResponse.json(
      await reviewListingVerificationForPlatform(
        principal,
        listingId,
        await request.json(),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
