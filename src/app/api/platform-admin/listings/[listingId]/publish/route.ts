import { NextResponse } from "next/server";
import { verifyAndPublishListingForPlatform } from "@/modules/platform-admin/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";

/** Verify & publish: the explicit platform decision that makes a reviewed listing public. */
export async function POST(request: Request, { params }: { params: Promise<{ listingId: string }> }) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const { listingId } = await params;
    return NextResponse.json(await verifyAndPublishListingForPlatform(principal, listingId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
